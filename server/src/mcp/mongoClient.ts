import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

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

  /** Tool schemas as Gemini-flavored `FunctionDeclaration` objects. */
  geminiFunctionDeclarations(): {
    name: string;
    description: string;
    parameters: unknown;
  }[] {
    return this.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      // MCP tools advertise JSON Schema; Gemini accepts the same shape.
      parameters: t.inputSchema,
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
