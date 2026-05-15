import type { PipelineSchema } from "@/Schema";

/**
 * Wire-format messages exchanged between the React UI and the Node.js backend.
 * The backend is the only writer of the canvas — the UI is read-only and just
 * renders whatever `canvas.update` payloads arrive.
 *
 * Keep this file in sync with `server/src/websocket/protocol.ts` (Phase 2).
 */

/* ───────────── Client → Server ───────────── */

export type ClientMessage =
  | {
      type: "init";
      apiKey?: string;
      mongoUri?: string;
      /** "english" (default) or "international" — see useSettings.ts for semantics. */
      languageMode?: "english" | "international";
    }
  | { type: "audio"; data: string } // base64-encoded Int16 PCM @ 16 kHz, mono
  | { type: "interrupt" }
  /** Ask the server to refresh the Mflix-collections reference panel from the
   *  live Atlas connection. Requires Atlas to be connected; otherwise the
   *  server replies with `{type: "mflix.collections", error}`. */
  | { type: "mflix.refresh"; database?: string };

/** Which backend component a `connection.status` message refers to. */
export type ConnectionComponent = "gemini" | "atlas";

/* ───────────── Server → Client ───────────── */

export type AgentState =
  | "idle"
  | "thinking"
  | "speaking"
  | "tool-call"
  | "error";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/**
 * Each transcript message is a CHUNK to append, not a snapshot. Chunks with
 * the same `messageId` belong to the same bubble/turn.
 */
export interface TranscriptMessage {
  type: "transcript";
  role: "user" | "agent";
  text: string;
  /** Stable ID for one utterance/turn; chunks with same ID belong together. */
  messageId?: string;
  ts: number;
}

/**
 * Chunk of the model's internal reasoning text (not spoken aloud). Appended
 * to the most recent agent bubble; never creates a bubble on its own.
 */
export interface ThinkingMessage {
  type: "thinking";
  text: string;
  ts: number;
}

export interface AgentAudioMessage {
  type: "audio";
  data: string; // base64-encoded Int16 PCM @ 24 kHz, mono (Gemini Live output rate)
}

export interface AgentStatusMessage {
  type: "agent.status";
  state: AgentState;
  /** Short human-readable detail, e.g. "calling aggregate(sample_mflix.embedded_movies)" */
  detail?: string;
}

export interface ConnectionStatusMessage {
  type: "connection.status";
  /** Defaults to "gemini" if omitted (back-compat). */
  component?: ConnectionComponent;
  state: ConnectionState;
  detail?: string;
}

export interface CanvasUpdateMessage {
  type: "canvas.update";
  schema: PipelineSchema;
}

export interface ResultsMessage {
  type: "results";
  /** The stage ID whose execution produced these rows (matches a `SerializedStage.id` in the canvas). */
  stageId: string;
  /** Display name for the results tab. */
  label?: string;
  rows: unknown[];
  executedAt: string;
}

/**
 * Reply to a `mflix.refresh` request. Counts and example documents are
 * best-effort and may be omitted per collection if a tool call failed.
 */
export interface MflixCollectionsMessage {
  type: "mflix.collections";
  database: string;
  collections: Array<{
    name: string;
    estimatedCount?: number;
    exampleDocument?: unknown;
    error?: string;
  }>;
  error?: string;
}

/** Server-sent message types. */
export type ServerMessage =
  | TranscriptMessage
  | ThinkingMessage
  | AgentAudioMessage
  | AgentStatusMessage
  | ConnectionStatusMessage
  | CanvasUpdateMessage
  | ResultsMessage
  | MflixCollectionsMessage;
