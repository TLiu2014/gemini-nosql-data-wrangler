import http from "node:http";
import express from "express";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";

import { loadEnv } from "./config/env.js";
import { MongoMcpClient } from "./mcp/mongoClient.js";
import { refreshMflixCollections } from "./mcp/mflixRefresh.js";
import { resolveApiKey, resolveMongoUri } from "./auth/apiKey.js";
import { ClientSocket } from "./websocket/clientSocket.js";
import { AgentLoop } from "./agent/agentLoop.js";
// DEPRECATED: Earlier voice-streaming agent (Gemini Live API) and the
// hand-rolled ReAct loop that briefly replaced it both live on the
// `deprecated` git branch. The current `AgentLoop` is built on the Google
// Agent Development Kit (`@google/adk`).
import type { ClientMessage } from "./websocket/protocol.js";

const env = loadEnv();

const app = express();
app.get("/health", (_req, res) => {
  res.json({ status: "ok", model: env.GEMINI_MODEL });
});

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  if (req.url !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws: WsWebSocket) => {
  const client = new ClientSocket(ws);

  /**
   * Per-connection state. Each browser session gets its own:
   *   - MongoDB MCP subprocess (spawned only if a URI is resolved)
   *   - Agent loop (Phase 2 — currently inert)
   *
   * Both live for the duration of the WebSocket and are torn down on close.
   */
  let agent: AgentLoop | null = null;
  let mcp: MongoMcpClient | null = null;
  let atlasDetail: string | undefined;

  console.log("[ws] client connected");

  client.sendConnectionStatus("disconnected", undefined, "atlas");

  async function startSession(msg: ClientMessage & { type: "init" }) {
    // 1. Resolve credentials. The Gemini key is required; the Mongo URI is not.
    const apiKey = resolveApiKey(msg.apiKey, env.GEMINI_API_KEY);
    if ("error" in apiKey) {
      client.sendConnectionStatus("error", apiKey.error, "gemini");
      return;
    }

    const mongo = resolveMongoUri(msg.mongoUri, env.MONGODB_URI);

    // 2. Bring up MCP if we have a URI. Failures here don't block Gemini.
    if (mongo.uri) {
      client.sendConnectionStatus("connecting", undefined, "atlas");
      mcp = new MongoMcpClient(mongo.uri);
      try {
        await mcp.connect();
      } catch (err) {
        console.error("[ws] mcp.connect() failed:", err);
        atlasDetail = String(err);
        client.sendConnectionStatus("error", atlasDetail, "atlas");
        await mcp.close().catch(() => undefined);
        mcp = null;
      }

      if (mcp) {
        client.sendConnectionStatus(
          "connecting",
          "Verifying MongoDB connection…",
          "atlas",
        );
        const probe = await mcp.probe();
        if (probe.ok) {
          console.log("[mcp] MongoDB probe ok — Atlas reachable");
          atlasDetail = undefined;
          client.sendConnectionStatus("connected", undefined, "atlas");
        } else {
          console.error("[mcp] MongoDB probe failed:", probe.error);
          atlasDetail = probe.error;
          client.sendConnectionStatus("error", atlasDetail, "atlas");
          await mcp.close().catch(() => undefined);
          mcp = null;
        }
      }
    } else if ("error" in mongo && mongo.error) {
      atlasDetail = mongo.error;
      client.sendConnectionStatus("error", atlasDetail, "atlas");
    } else {
      atlasDetail = "No MongoDB URI configured — set one in Settings.";
      client.sendConnectionStatus("error", atlasDetail, "atlas");
    }

    // 3. Build the ADK-based agent. Uses a no-op MCP for direct calls
    //    (run_pipeline's $facet wrapper, Mflix refresh) so the agent still
    //    works in canvas-only mode when Atlas is disconnected. The agent's
    //    tool surface (MCPToolset) is omitted entirely in that case.
    const modelForSession = msg.geminiModel || env.GEMINI_MODEL;
    const languageForSession = msg.languageMode ?? "english";
    // Default to true if absent — older clients that don't ship this field
    // still get the chip-suggestion behavior they used to have.
    const enableSuggestedPrompts = msg.enableSuggestedPrompts !== false;
    const mcpForAgent = mcp ?? new MongoMcpClient("mongodb://disabled");
    agent = new AgentLoop({
      apiKey: apiKey.key,
      model: modelForSession,
      mcp: mcpForAgent,
      mongoUri: mcp ? mongo.uri ?? null : null,
      client,
      languageMode: languageForSession,
      atlasAvailable: !!mcp,
      atlasDetail,
      enableSuggestedPrompts,
    });
    // Surface the model name + a coarse tool count to the UI. With ADK,
    // tool discovery is lazy (the MCPToolset spawns its process on first
    // use), so we estimate: 4 custom tools + 6 MCP tools when Atlas is up.
    const customCount = enableSuggestedPrompts ? 4 : 3;
    const mcpCount = mcp ? 6 : 0;
    client.sendConnectionStatus(
      "connected",
      `${modelForSession} · ${customCount + mcpCount} tools`,
      "gemini",
    );
    client.sendAgentStatus("idle");
  }

  /* DEPRECATED — Live API auto-reconnect logic. Phase 2 (text ReAct loop)
   * does not need this because individual sendMessage() calls fail-fast
   * and don't keep an audio WS open between turns.
   *
   * const MAX_AUTO_RECONNECTS = 2;
   * let autoReconnects = 0;
   * async function buildGeminiSession(...) { ... }
   */

  ws.on("message", async (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      console.warn("[ws] dropped non-JSON message from client");
      return;
    }

    switch (msg.type) {
      case "init":
        await startSession(msg);
        break;
      // DEPRECATED — audio/interrupt are no-ops now.
      case "audio":
      case "interrupt":
        break;
      case "user.text": {
        if (!agent) {
          client.sendTrace({
            kind: "error",
            text: "Agent isn't initialized yet — send `init` first.",
            isError: true,
          });
          break;
        }
        void agent.sendUserMessage(msg.text);
        break;
      }
      case "user.audio": {
        if (!agent) {
          client.sendTrace({
            kind: "error",
            text: "Agent isn't initialized yet — send `init` first.",
            isError: true,
          });
          break;
        }
        void agent.sendUserMessage({
          audio: { mimeType: msg.mimeType, data: msg.data },
        });
        break;
      }
      case "mflix.refresh": {
        const database = msg.database ?? "sample_mflix";
        if (!mcp || !mcp.isConnected()) {
          client.sendMflixCollections({
            database,
            collections: [],
            error:
              "MongoDB Atlas isn't connected — set a connection string in Settings and reconnect.",
          });
          break;
        }
        try {
          const out = await refreshMflixCollections(mcp, database);
          client.sendMflixCollections(out);
        } catch (err) {
          console.error("[ws] mflix.refresh failed:", err);
          client.sendMflixCollections({
            database,
            collections: [],
            error: String(err),
          });
        }
        break;
      }
    }
  });

  ws.on("close", async () => {
    console.log("[ws] client disconnected");
    if (agent) {
      // Dispose the ADK MCPToolset so we don't leak `mongodb-mcp-server`
      // subprocesses across reconnects.
      await agent.dispose().catch(() => undefined);
      agent = null;
    }
    if (mcp) {
      await mcp.close().catch(() => undefined);
      mcp = null;
    }
  });
});

httpServer.listen(env.PORT, () => {
  console.log(
    `[startup] HTTP + WS listening on :${env.PORT} (model=${env.GEMINI_MODEL})`,
  );
  if (!env.MONGODB_URI) {
    console.log(
      "[startup] MONGODB_URI not set — clients must supply their own connection string in Settings.",
    );
  }
  if (!env.GEMINI_API_KEY) {
    console.log(
      "[startup] GEMINI_API_KEY not set — clients must supply their own key in Settings.",
    );
  }
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[shutdown] received ${signal}`);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
