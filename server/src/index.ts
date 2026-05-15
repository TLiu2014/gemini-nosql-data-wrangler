import http from "node:http";
import express from "express";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";

import { loadEnv } from "./config/env.js";
import { MongoMcpClient } from "./mcp/mongoClient.js";
import { refreshMflixCollections } from "./mcp/mflixRefresh.js";
import { resolveApiKey, resolveMongoUri } from "./auth/apiKey.js";
import { ClientSocket } from "./websocket/clientSocket.js";
import { GeminiStreamSession } from "./websocket/geminiStream.js";
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
   *   - Gemini Live session
   *
   * Both live for the duration of the WebSocket and are torn down on close.
   */
  let session: GeminiStreamSession | null = null;
  let mcp: MongoMcpClient | null = null;
  let atlasDetail: string | undefined;

  console.log("[ws] client connected");

  // Initial Atlas state: we don't know yet whether the user will pass a URI in
  // `init`, so report "disconnected" until they do.
  client.sendConnectionStatus("disconnected", undefined, "atlas");

  async function startSession(msg: ClientMessage & { type: "init" }) {
    if (session) return;

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
        atlasDetail = undefined;
        client.sendConnectionStatus("connected", undefined, "atlas");
      } catch (err) {
        console.error("[ws] mcp.connect() failed:", err);
        atlasDetail = String(err);
        client.sendConnectionStatus("error", atlasDetail, "atlas");
        await mcp.close().catch(() => undefined);
        mcp = null;
      }
    } else if ("error" in mongo && mongo.error) {
      atlasDetail = mongo.error;
      client.sendConnectionStatus("error", atlasDetail, "atlas");
    } else {
      atlasDetail = "No MongoDB URI configured — set one in Settings.";
      client.sendConnectionStatus("error", atlasDetail, "atlas");
    }

    // 3. Bring up Gemini. Use a no-op MCP if Atlas is down so the agent still works.
    const mcpForSession = mcp ?? new MongoMcpClient("mongodb://disabled");
    try {
      session = new GeminiStreamSession(
        apiKey.key,
        env.GEMINI_MODEL,
        mcpForSession,
        client,
        atlasDetail,
        msg.languageMode ?? "english",
      );
      await session.connect();
    } catch (err) {
      console.error("[ws] failed to start Gemini session:", err);
      client.sendConnectionStatus("error", String(err), "gemini");
      session = null;
    }
  }

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
      case "audio":
        session?.sendAudio(msg.data);
        break;
      case "interrupt":
        // Browser stops local playback; Gemini Live VAD picks it up.
        break;
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
    session?.disconnect();
    session = null;
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
