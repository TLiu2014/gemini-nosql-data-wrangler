/**
 * Wire-format mirror of `ui/src/types/ws.ts`. We deliberately re-declare the
 * shapes here instead of importing from `ui/` so the server can be built and
 * deployed independently of the frontend workspace.
 *
 * Keep this file in sync with the UI counterpart.
 */

/* ───────────── Client → Server ───────────── */

export type LanguageMode = "english" | "international";

export type ClientMessage =
  | {
      type: "init";
      apiKey?: string;
      mongoUri?: string;
      languageMode?: LanguageMode;
    }
  | { type: "audio"; data: string }
  | { type: "interrupt" };

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

/** Append-on-arrival transcript chunk. */
export interface TranscriptMessage {
  type: "transcript";
  role: "user" | "agent";
  text: string;
  /** Stable ID for one utterance/turn; chunks with same ID belong together. */
  messageId?: string;
  ts: number;
}

/** Append-on-arrival agent thinking/reasoning chunk. */
export interface ThinkingMessage {
  type: "thinking";
  text: string;
  ts: number;
}

export interface AgentAudioMessage {
  type: "audio";
  data: string;
}

export interface AgentStatusMessage {
  type: "agent.status";
  state: AgentState;
  detail?: string;
}

export interface ConnectionStatusMessage {
  type: "connection.status";
  component?: ConnectionComponent;
  state: ConnectionState;
  detail?: string;
}

export interface CanvasUpdateMessage {
  type: "canvas.update";
  schema: unknown; // PipelineSchema — opaque to the server
}

export interface ResultsMessage {
  type: "results";
  stageId: string;
  label?: string;
  rows: unknown[];
  executedAt: string;
}

export type ServerMessage =
  | TranscriptMessage
  | ThinkingMessage
  | AgentAudioMessage
  | AgentStatusMessage
  | ConnectionStatusMessage
  | CanvasUpdateMessage
  | ResultsMessage;
