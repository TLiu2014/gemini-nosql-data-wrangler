/**
 * Helpers for shaping MongoDB MCP tool responses before we hand them back
 * to Gemini. Two jobs:
 *   - Strip giant binary/vector fields (`plot_embedding`, etc.) — they
 *     blow past Gemini's tool-response payload limits.
 *   - Truncate the cleaned text to a hard byte budget so a worst-case
 *     response can't crash the request.
 *
 * The strip is intentionally regex-based, not JSON-parse-based: MCP
 * responses are a mix of free-form prose and embedded JSON, and we want
 * to survive both.
 *
 * Budget note: Gemini 3 Flash's tool-response payload limits are large
 * enough that 32 KB was overly conservative — it caused `$facet` results
 * (5 stages × 20 docs × ~600 bytes each ≈ 60 KB) to get truncated, which
 * invalidated the JSON and left every result tab empty. 256 KB is well
 * within Gemini's actual limits and large enough for any realistic facet
 * preview at the default `preview_limit = 20`.
 */

const DEFAULT_BYTE_BUDGET = 256 * 1024;

const HEAVY_FIELD_NAMES = [
  "plot_embedding",
  "embedding",
  "vector",
  "queryVector",
];

export function stripHeavyFieldsFromMcpResult(
  raw: unknown,
  byteBudget: number = DEFAULT_BYTE_BUDGET,
): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as { content?: Array<{ type?: string; text?: string }> };
  if (!Array.isArray(r.content)) return raw;
  const newContent = r.content.map((c) => {
    if (c?.type !== "text" || typeof c.text !== "string") return c;
    let stripped = stripHeavyFieldsFromText(c.text);
    if (stripped.length > byteBudget) {
      stripped =
        stripped.slice(0, byteBudget) +
        `\n…[truncated to fit byte budget; ${stripped.length - byteBudget} more bytes elided]`;
    }
    return stripped === c.text ? c : { ...c, text: stripped };
  });
  return { ...raw, content: newContent };
}

function stripHeavyFieldsFromText(text: string): string {
  let out = text;
  for (const field of HEAVY_FIELD_NAMES) {
    const arrayForm = new RegExp(`"${field}"\\s*:\\s*\\[[^\\]]*\\]`, "g");
    const objForm = new RegExp(`"${field}"\\s*:\\s*\\{[^{}]*\\}`, "g");
    out = out
      .replace(arrayForm, `"${field}":"<elided ${field}>"`)
      .replace(objForm, `"${field}":"<elided ${field}>"`);
  }
  return out;
}

/**
 * Parse the document rows out of an MCP `aggregate` / `find` response. The
 * server returns a `content` array of text entries: one or more narrative
 * lines ("The aggregation resulted in N documents.", warning preambles)
 * followed by either each document as its own text entry, or all
 * documents concatenated as a JSON array.
 *
 * `mongodb-mcp-server` v3+ wraps the docs inside an
 * `<untrusted-user-data-UUID>…</untrusted-user-data-UUID>` block with a
 * long preamble warning the model not to follow embedded instructions. We
 * unwrap that block first so the inner JSON can be parsed. Older versions
 * (and other MCP-style servers) emit the JSON at the start of the entry
 * with no wrapper — both shapes are handled.
 *
 * We're permissive: anything that JSON-parses to an object or array
 * contributes its docs to the output; non-JSON text is skipped.
 */
export function extractDocsFromMcpAggregate(raw: unknown): unknown[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as { content?: Array<{ type?: string; text?: string }> };
  if (!Array.isArray(r.content)) return [];
  const docs: unknown[] = [];
  for (const entry of r.content) {
    if (entry?.type !== "text" || typeof entry.text !== "string") continue;
    const text = entry.text.trim();
    if (!text) continue;

    // Candidate JSON fragments to try parsing. By default we try the whole
    // entry; if the entry is wrapped in <untrusted-user-data-UUID> tags
    // (mongodb-mcp-server v3+) we also try the unwrapped inner content,
    // which is where the actual JSON documents live.
    const candidates: string[] = [];
    const unwrapped = unwrapUntrustedData(text);
    if (unwrapped) candidates.push(unwrapped);
    candidates.push(text);

    let parsed = false;
    for (const candidate of candidates) {
      const head = candidate[0];
      if (head !== "{" && head !== "[") continue;
      try {
        const json = JSON.parse(candidate);
        if (Array.isArray(json)) docs.push(...json);
        else if (json && typeof json === "object") docs.push(json);
        parsed = true;
        break;
      } catch {
        /* try the next candidate, then fall through to recovery */
      }
    }
    if (parsed) continue;

    // Recovery path: the fragment got truncated (byte budget hit, or the
    // MCP server emitted a partial doc), or the entry contains JSON
    // embedded in surrounding prose we don't recognize. Walk the entire
    // text looking for balanced `{…}` objects; any that JSON-parse are
    // collected.
    for (const slice of recoverJsonObjects(text)) {
      docs.push(slice);
    }
  }
  return docs;
}

/**
 * Pull the inner content out of mongodb-mcp-server v3+'s
 * `<untrusted-user-data-UUID>…</untrusted-user-data-UUID>` wrapper. Returns
 * null when no wrapper is present, so the caller can fall back to parsing
 * the raw entry verbatim.
 */
function unwrapUntrustedData(text: string): string | null {
  const match = text.match(
    /<untrusted-user-data-[^>]+>([\s\S]*?)<\/untrusted-user-data-[^>]+>/,
  );
  return match ? match[1].trim() : null;
}

/** Walk a possibly-truncated text and extract any well-formed top-level
 *  JSON objects. Bails after the first malformed run (no point burning
 *  CPU on garbage). */
function recoverJsonObjects(text: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (parsed && typeof parsed === "object") out.push(parsed);
        } catch {
          /* truncated tail — stop scanning, we won't find another valid object after this */
          return out;
        }
        start = -1;
      }
      continue;
    }
  }
  return out;
}
