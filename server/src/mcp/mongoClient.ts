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
 * Inline JSON Schema `$ref` pointers using the schema's own `definitions` /
 * `$defs` maps. `mongodb-mcp-server` (and any zod-to-json-schema producer
 * with its default settings) emits schemas like
 *   { $ref: "#/definitions/Foo", definitions: { Foo: { type: "object", ... } } }
 * where the meaningful shape lives under `definitions`. We have to inline
 * those before sanitizing or the allow-list strips `$ref` and `definitions`
 * both, leaving an empty `{type: "object", properties: {}}` and the agent
 * loses its parameter contract.
 */
function inlineJsonSchemaRefs(
  schema: unknown,
  defs: Record<string, unknown> = {},
  seen = new Set<string>(),
): unknown {
  if (schema === null || typeof schema !== "object") return schema;
  const s = schema as Record<string, unknown>;

  // Merge any definitions declared here into the lookup table before
  // descending. This handles definitions declared at any depth, not just
  // the document root.
  let definitions = defs;
  if (s.definitions && typeof s.definitions === "object") {
    definitions = { ...definitions, ...(s.definitions as Record<string, unknown>) };
  }
  if (s.$defs && typeof s.$defs === "object") {
    definitions = { ...definitions, ...(s.$defs as Record<string, unknown>) };
  }

  // Resolve a `$ref` against the in-scope definitions. We support the two
  // forms zod-to-json-schema produces: `#/definitions/X` and `#/$defs/X`.
  if (typeof s.$ref === "string") {
    const match = s.$ref.match(/^#\/(?:definitions|\$defs)\/(.+)$/);
    if (match && !seen.has(s.$ref)) {
      const target = definitions[match[1]];
      if (target !== undefined) {
        const nextSeen = new Set(seen);
        nextSeen.add(s.$ref);
        return inlineJsonSchemaRefs(target, definitions, nextSeen);
      }
    }
    // Unresolvable or cyclic — leave as-is; sanitize will strip $ref.
  }

  if (Array.isArray(s)) {
    return (s as unknown[]).map((item) =>
      inlineJsonSchemaRefs(item, definitions, seen),
    );
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "definitions" || k === "$defs") continue; // already merged
    out[k] = inlineJsonSchemaRefs(v, definitions, seen);
  }
  return out;
}

/**
 * Per-tool last-mile simplification. Some MCP tool schemas describe complex
 * discriminated unions (e.g. `aggregate.pipeline.items` uses nested `anyOf`
 * to model `$vectorSearch` vs other stages). Gemini Live's tool-calling
 * layer can technically encode that, but `gemini-3.x-flash-live-preview`
 * cannot reliably *generate* args that satisfy it — the model emits args
 * that fail validation, surfaces the error in its own audio output as
 * "Internal Error: JSON parsing error", and loops without calling the
 * tool. MongoDB MCP still validates MongoDB syntax server-side, so we lose
 * nothing safety-wise by giving Gemini a more permissive shape.
 */
function relaxComplexUnionsForGemini(
  toolName: string,
  schema: unknown,
): unknown {
  if (!schema || typeof schema !== "object") return schema;
  if (toolName !== "aggregate") return schema;
  const s = schema as {
    properties?: Record<string, unknown>;
  };
  const props = s.properties;
  if (!props || typeof props !== "object") return schema;
  const pipeline = props.pipeline as
    | { type?: string; items?: unknown }
    | undefined;
  if (!pipeline || pipeline.type !== "array") return schema;
  return {
    ...schema,
    properties: {
      ...props,
      pipeline: {
        ...pipeline,
        // Permissive item shape — any object passes. The model now only
        // needs to construct a plain JSON array of objects, which it can
        // do reliably. MongoDB validates the stage shapes downstream.
        items: { type: "object" },
      },
    },
  };
}

/**
 * Recursively normalize a JSON Schema for Gemini Live function declarations.
 * - Keeps only allow-listed keywords.
 * - Lower-cases the `type` field defensively.
 * - Collapses array `type` (e.g. ["string", "null"]) to its first non-null
 *   value (Gemini's `type` is a scalar enum, not an array).
 * - Filters `required` so it only references properties that actually
 *   survived sanitization. Gemini rejects the whole declaration (WS 1007)
 *   if `required` names a property that isn't in `properties` — which can
 *   happen when a property was defined via a keyword we stripped (e.g. via
 *   `$ref`, `oneOf`, etc.).
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
    // `properties` is a name→schema map. The keys are arbitrary identifiers
    // (e.g. "database", "collection"), NOT JSON Schema keywords — so we must
    // preserve every key and only recursively sanitize its value.
    if (k === "properties" && v && typeof v === "object" && !Array.isArray(v)) {
      const props: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(
        v as Record<string, unknown>,
      )) {
        props[propName] = sanitizeJsonSchemaForGemini(propSchema);
      }
      out.properties = props;
      continue;
    }
    // `enum` / `default` / `required` carry literal values (or property
    // names), not nested schemas — pass them through verbatim.
    if (k === "enum" || k === "default" || k === "required") {
      out[k] = v;
      continue;
    }
    out[k] = sanitizeJsonSchemaForGemini(v);
  }
  if (Array.isArray(out.required)) {
    const propKeys =
      out.properties && typeof out.properties === "object"
        ? new Set(Object.keys(out.properties as Record<string, unknown>))
        : new Set<string>();
    const filtered = (out.required as unknown[]).filter(
      (r): r is string => typeof r === "string" && propKeys.has(r),
    );
    if (filtered.length > 0) out.required = filtered;
    else delete out.required;
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
    const declarations = allowed.map((t) => {
      const inlined = inlineJsonSchemaRefs(t.inputSchema);
      const sanitized = relaxComplexUnionsForGemini(
        t.name,
        sanitizeJsonSchemaForGemini(inlined),
      );
      if (process.env.LOG_MCP_SCHEMAS === "1") {
        console.log(
          `[mcp] schema for ${t.name}: raw=${JSON.stringify(t.inputSchema)}`,
        );
        console.log(
          `[mcp] schema for ${t.name}: inlined=${JSON.stringify(inlined)}`,
        );
        console.log(
          `[mcp] schema for ${t.name}: sanitized=${JSON.stringify(sanitized)}`,
        );
      }
      return {
        name: t.name,
        description: t.description ?? "",
        parameters: sanitized,
      };
    });
    return declarations;
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

  /**
   * Verify the configured MongoDB URI actually works by calling the smallest
   * possible MCP tool (`list-databases`). The MCP subprocess can start fine
   * and expose its tool list even when the connection string is bogus — it
   * only discovers that on the first real query. Without this probe, the UI
   * shows "Atlas: connected" while in reality every aggregate/find will fail
   * 30s later with a timeout.
   *
   * `timeoutMs` bounds how long we wait — defaults to 8s, which is enough
   * for a healthy Atlas cluster but stops the user from waiting through the
   * full ~30s MongoDB driver timeout when the URI is plain wrong.
   */
  async probe(timeoutMs = 8000): Promise<
    { ok: true } | { ok: false; error: string }
  > {
    if (!this.client) return { ok: false, error: "MCP client not connected" };
    try {
      const probeCall = this.client.callTool({
        name: "list-databases",
        arguments: {},
      });
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `MongoDB probe timed out after ${timeoutMs}ms — the URI is likely unreachable or the IP isn't on the Atlas allowlist.`,
              ),
            ),
          timeoutMs,
        ),
      );
      const result = (await Promise.race([probeCall, timeout])) as {
        isError?: boolean;
        content?: Array<{ text?: string }>;
      };
      if (result?.isError) {
        const text =
          result.content
            ?.map((c) => c.text)
            .filter((t): t is string => !!t)
            .join(" ") ?? "Unknown MCP error";
        return { ok: false, error: text };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
    this.transport = null;
  }
}
