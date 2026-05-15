import type { MongoMcpClient } from "./mongoClient.js";

/**
 * Refreshes the "Mflix collections" reference panel by calling MCP tools
 * directly (out-of-band from the Gemini Live agent loop). Used by the UI's
 * "Refresh from Atlas" button so the panel can show what's actually in the
 * cluster instead of a static fallback list.
 *
 * Returns one entry per collection in the requested database, with best-effort
 * count and example document. Failures on a single collection don't fail the
 * whole call — the failing entry carries an `error` string.
 */
export interface MflixCollectionInfo {
  name: string;
  estimatedCount?: number;
  exampleDocument?: unknown;
  error?: string;
}

export interface MflixRefreshResult {
  database: string;
  collections: MflixCollectionInfo[];
}

export async function refreshMflixCollections(
  mcp: MongoMcpClient,
  database: string,
): Promise<MflixRefreshResult> {
  const listResult = await mcp.callTool("list-collections", { database });
  const names = extractCollectionNames(listResult);

  const collections = await Promise.all(
    names.map(async (name): Promise<MflixCollectionInfo> => {
      const [countOutcome, sampleOutcome] = await Promise.allSettled([
        mcp.callTool("count", { database, collection: name }),
        mcp.callTool("find", { database, collection: name, limit: 1 }),
      ]);
      const estimatedCount =
        countOutcome.status === "fulfilled"
          ? extractCount(countOutcome.value)
          : undefined;
      const exampleDocument =
        sampleOutcome.status === "fulfilled"
          ? extractFirstDoc(sampleOutcome.value)
          : undefined;
      const failedAll =
        estimatedCount === undefined && exampleDocument === undefined;
      return {
        name,
        estimatedCount,
        exampleDocument,
        error: failedAll ? "Failed to fetch metadata for this collection." : undefined,
      };
    }),
  );

  return { database, collections };
}

/* ───────────── MCP result helpers ─────────────
 * MCP tool results follow the shape `{ content: [{ type: "text", text }, ...] }`.
 * The text content varies by tool — sometimes JSON, sometimes a human sentence
 * with an embedded JSON array. Extractors below are deliberately permissive.
 */

function extractText(raw: unknown): string {
  const r = raw as { content?: Array<{ type?: string; text?: string }> };
  if (!r?.content) return "";
  return r.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}

function extractCollectionNames(raw: unknown): string[] {
  const text = extractText(raw);
  if (!text) return [];

  // The mongodb-mcp-server emits one Markdown line per collection of the form
  // "Name: <coll> | Type: <view|collection>". Each line ends with a newline.
  // Strip the prefix and pull the collection name out.
  const namePrefix = /^Name:\s+([^\s|]+)/gm;
  const fromLines = new Set<string>();
  for (const m of text.matchAll(namePrefix)) {
    fromLines.add(m[1]);
  }
  if (fromLines.size > 0) return [...fromLines];

  // Fallbacks for other response shapes we might encounter.
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => (typeof entry === "string" ? entry : entry?.name))
        .filter((s): s is string => typeof s === "string");
    }
  } catch {
    /* not JSON */
  }
  const bracketed = text.match(/\[([^\]]+)\]/);
  if (bracketed) {
    return bracketed[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return [];
}

function extractCount(raw: unknown): number | undefined {
  const text = extractText(raw);
  if (!text) return undefined;
  // Count tool emits text like "Found 21349 documents in the collection" or
  // the number on its own line. Take the first integer.
  const m = text.match(/\b(\d{1,15})\b/);
  return m ? Number(m[1]) : undefined;
}

function extractFirstDoc(raw: unknown): unknown {
  const text = extractText(raw);
  if (!text) return undefined;
  // find returns each document on its own line/section. Try a full JSON parse
  // first (best case: it's a JSON array), then fall back to extracting the
  // first {...} block.
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed[0];
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    /* not pure JSON — keep scanning */
  }
  const firstObj = text.match(/\{[\s\S]*?\n\}/);
  if (firstObj) {
    try {
      return JSON.parse(firstObj[0]);
    } catch {
      return firstObj[0];
    }
  }
  return undefined;
}
