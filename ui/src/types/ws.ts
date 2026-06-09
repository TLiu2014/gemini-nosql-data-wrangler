import type { PipelineSchema } from "@/Schema";

/**
 * Wire-format messages exchanged between the React UI and the Node.js backend.
 * The backend is the only writer of the canvas — the UI is read-only and just
 * renders whatever `canvas.update` payloads arrive.
 *
 * Keep this file in sync with `server/src/websocket/protocol.ts` (Phase 2).
 */

/* ───────────── Client → Server ───────────── */

/** Gemini Live model identifiers the UI can select between. */
export type GeminiModelChoice =
  | "gemini-2.5-flash-native-audio-preview-09-2025"
  | "gemini-3.1-flash-live-preview";

export type ClientMessage =
  | {
      type: "init";
      apiKey?: string;
      mongoUri?: string;
      /** "english" (default) or "international" — see useSettings.ts for semantics. */
      languageMode?: "english" | "international";
      /** Optional model override. Falls back to whatever the server is configured with. */
      geminiModel?: GeminiModelChoice;
      /** When false, the server skips the `suggest_next_prompts` tool and
       *  its system-instruction nudge — no token / latency cost per turn.
       *  UI also hides all suggestion chips. Default true. */
      enableSuggestedPrompts?: boolean;
    }
  | { type: "audio"; data: string } // DEPRECATED — Live API streaming voice path
  | { type: "interrupt" } // DEPRECATED
  /** User typed a chat message. Server dispatches it to the ReAct agent loop. */
  | { type: "user.text"; text: string }
  /**
   * Push-to-talk audio clip — base64-encoded blob from MediaRecorder.
   * Sent as a single message after the user releases the mic button.
   * Server forwards as an inline-data Part to Gemini (multimodal).
   */
  | { type: "user.audio"; mimeType: string; data: string }
  /** Ask the server to refresh the Mflix-collections reference panel from the
   *  live Atlas connection. Requires Atlas to be connected; otherwise the
   *  server replies with `{type: "mflix.collections", error}`. */
  | { type: "mflix.refresh"; database?: string }
  /** Start a fresh chat without dropping the WebSocket: the server resets the
   *  agent's conversation memory + canvas snapshot so Gemini treats the next
   *  message as a new flow. The UI clears its own timeline/canvas/results. */
  | { type: "chat.reset" };

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

/**
 * Phase 2 trace event from the ReAct agent loop. The UI's trace panel
 * renders these as a developer-style log.
 */
export interface TraceMessage {
  type: "trace";
  kind:
    | "tool_call_start"
    | "tool_call_result"
    | "agent_text"
    | "user_text"
    | "turn_complete"
    | "info"
    | "error"
    | "suggested_prompts";
  label?: string;
  payload?: unknown;
  /** UI-only: when a `tool_call_result` is merged with its earlier
   *  `tool_call_start` into a single entry, this carries the start's args. */
  args?: unknown;
  isError?: boolean;
  text?: string;
  durationMs?: number;
  /** For `suggested_prompts`: 2–3 clickable follow-up chips for the next
   *  user turn. The chat panel finds the most-recent occurrence since the
   *  last user message and renders it as a strip below the timeline. */
  prompts?: Array<{ label: string; prompt: string }>;
  ts: number;
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
  | MflixCollectionsMessage
  | TraceMessage;
