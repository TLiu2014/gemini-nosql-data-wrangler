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
 */

const DEFAULT_BYTE_BUDGET = 32 * 1024;

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
