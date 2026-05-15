import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * The MCP server exposes ~16+ tools including Atlas administration ones we
 * don't need (org/project/cluster management, user management). Limit to the
 * data-operation surface so Gemini Live's session setup stays small enough
 * to negotiate cleanly.
 */
const MCP_TOOLS_ALLOWLIST = new Set([
  "list-databases",
  "list-collections",
  "collection-schema",
  "find",
  "count",
  "aggregate",
]);

/**
 * Allow-list of JSON Schema / OpenAPI keywords that Gemini Live's function
 * declaration parser accepts. Anything else is stripped recursively.
 *
 * Background: JSON Schema is a superset of what Gemini wants. Keywords like
 * `$schema`, `additionalProperties`, `propertyNames`, `dependencies`, `if`/
 * `then`/`else`, `not`, etc. cause WebSocket close code 1007 (Invalid JSON
 * payload). We learned this the hard way — each pass through the API revealed
 * a new rejected keyword. Switching to an allow-list is the safer cut.
 */
const ALLOWED_SCHEMA_KEYS = new Set([
  // structure
  "type",
  "properties",
  "required",
  "items",
  "enum",
  "description",
  "title",
  "nullable",
  "anyOf",
  // numeric constraints
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  // string constraints
  "minLength",
  "maxLength",
  "pattern",
  "format",
  // array constraints
  "minItems",
  "maxItems",
  "uniqueItems",
  // object constraints
  "minProperties",
  "maxProperties",
  // defaults & deprecation (Gemini accepts these)
  "default",
]);

/**
 * Recursively normalize a JSON Schema for Gemini Live function declarations.
 * - Keeps only allow-listed keywords.
 * - Lower-cases the `type` field defensively.
 * - Collapses array `type` (e.g. ["string", "null"]) to its first non-null
 *   value (Gemini's `type` is a scalar enum, not an array).
 */
function sanitizeJsonSchemaForGemini(schema: unknown): unknown {
  if (schema === null || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) {
    return schema.map(sanitizeJsonSchemaForGemini);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (!ALLOWED_SCHEMA_KEYS.has(k)) continue;
    if (k === "type" && Array.isArray(v)) {
      const first = v.find((t) => t !== "null");
      if (first) out.type = String(first).toLowerCase();
      continue;
    }
    if (k === "type" && typeof v === "string") {
      out.type = v.toLowerCase();
      continue;
    }
    out[k] = sanitizeJsonSchemaForGemini(v);
  }
  return out;
}

/**
 * Wraps the official `mongodb-mcp-server` as a stdio subprocess. The MCP server
 * doesn't keep per-client state we care about (we run it read-only), so one
 * shared instance is fine for all browser sessions on this Node process.
 *
 * Lifetime: created in index.ts at startup, never restarted.
 */
export class MongoMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: Tool[] = [];
  private connectPromise: Promise<void> | null = null;

  constructor(private readonly connectionString: string) {}

  /**
   * Idempotent. Multiple callers can `await connect()` during startup and the
   * subprocess will only be spawned once.
   */
  async connect(): Promise<void> {
    if (this.client) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = (async () => {
      this.transport = new StdioClientTransport({
        command: "npx",
        args: ["-y", "mongodb-mcp-server@latest", "--readOnly"],
        env: {
          ...process.env,
          MDB_MCP_CONNECTION_STRING: this.connectionString,
        },
      });

      this.client = new Client(
        { name: "gemini-nosql-data-wrangler", version: "0.1.0" },
        { capabilities: {} },
      );

      await this.client.connect(this.transport);
      const listed = await this.client.listTools();
      this.tools = listed.tools;
      console.log(
        `[mcp] connected to mongodb-mcp-server, ${this.tools.length} tools available: ${this.tools
          .map((t) => t.name)
          .join(", ")}`,
      );
    })();

    return this.connectPromise;
  }

  /**
   * Tool schemas as Gemini-flavored `FunctionDeclaration` objects.
   *
   * Two important normalizations:
   *   1. Filter to a small allow-list of data-operation tools — the full MCP
   *      list (16+ tools, including `atlas-*` admin tools) overwhelms Gemini
   *      Live's session-setup and triggers close code 1011 "Internal error".
   *   2. Sanitize each tool's JSON Schema to strip keywords Gemini's
   *      function-declaration parser doesn't accept (`$schema`,
   *      `additionalProperties`, `$ref`, `definitions`, etc.).
   */
  geminiFunctionDeclarations(): {
    name: string;
    description: string;
    parameters: unknown;
  }[] {
    const allowed = this.tools.filter((t) =>
      MCP_TOOLS_ALLOWLIST.has(t.name),
    );
    return allowed.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      parameters: sanitizeJsonSchemaForGemini(t.inputSchema),
    }));
  }

  isMcpToolName(name: string): boolean {
    return this.tools.some((t) => t.name === name);
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  /** Forward a Gemini tool call to the MCP server and return the raw result. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.client) throw new Error("MCP client not connected");
    const result = await this.client.callTool({ name, arguments: args });
    return result;
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
    this.transport = null;
  }
}
