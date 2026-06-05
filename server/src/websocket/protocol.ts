/**
 * Wire-format mirror of `ui/src/types/ws.ts`. We deliberately re-declare the
 * shapes here instead of importing from `ui/` so the server can be built and
 * deployed independently of the frontend workspace.
 *
 * Keep this file in sync with the UI counterpart.
 */

/* ───────────── Client → Server ───────────── */

export type LanguageMode = "english" | "international";

/**
 * Gemini Live model identifiers the UI can select between. Keep the union
 * narrow (don't accept arbitrary strings) so the UI's radio buttons map
 * 1:1 to verified-working models.
 */
export type GeminiModelChoice =
  | "gemini-2.5-flash-native-audio-preview-09-2025"
  | "gemini-3.1-flash-live-preview";

export type ClientMessage =
  | {
      type: "init";
      apiKey?: string;
      mongoUri?: string;
      languageMode?: LanguageMode;
      /** Optional override for the Gemini Live model. Falls back to env.GEMINI_MODEL. */
      geminiModel?: GeminiModelChoice;
      /** When false, the agent's `suggest_next_prompts` tool is not exposed
       *  and the system instruction's "suggest follow-ups" section is
       *  dropped — saves tokens + latency for users who don't want chips.
       *  Default true. */
      enableSuggestedPrompts?: boolean;
    }
  | { type: "audio"; data: string } // DEPRECATED — Live API streaming voice path
  | { type: "interrupt" } // DEPRECATED
  /** User typed a chat message. Phase 2 ReAct loop dispatches this to the agent. */
  | { type: "user.text"; text: string }
  /**
   * User push-to-talk audio clip — base64-encoded blob from MediaRecorder.
   * Sent as a single message after the user releases the mic button. The
   * server forwards it as an inline-data Part to Gemini, which transcribes
   * and reasons in one shot.
   */
  | { type: "user.audio"; mimeType: string; data: string }
  /** Refresh the Mflix collections reference panel from the live Atlas connection. */
  | { type: "mflix.refresh"; database?: string };

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

/**
 * Reply to `mflix.refresh`. When `error` is set the UI shows that to the user
 * and keeps its static fallback list. Otherwise `collections` is the freshly
 * fetched list — count and exampleDocument are best-effort and may be omitted
 * per collection if the relevant tool call failed.
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
 * Phase 2 trace event — emitted from the ReAct agent loop so the UI's
 * developer-style trace panel can show what the agent is doing.
 *
 *   tool_call_start  → "🛠️ Calling tool: <name>(<args>)"
 *   tool_call_result → "👁️ Observing: <preview>" (or error)
 *   agent_text       → model's final text reply for a turn
 *   turn_complete    → end of one user turn
 *   info             → free-form info line (system instruction snapshots, etc.)
 *   error            → loop-level errors (model failed, schema validation, …)
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
  /** Human-readable label, e.g. tool name. */
  label?: string;
  /** Tool args (start) or result (end). */
  payload?: unknown;
  /** True when `payload` represents an error rather than a normal result. */
  isError?: boolean;
  /** Free-form text — agent reply, info line, error message. */
  text?: string;
  /** Wall-clock duration for tool_call_result (ms). */
  durationMs?: number;
  /** For `suggested_prompts`: clickable follow-up suggestions for the next
   *  user turn. The UI renders these as chips below the last agent message
   *  until the user sends their next request. */
  prompts?: Array<{ label: string; prompt: string }>;
  ts: number;
}

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
