import type { WebSocket } from "ws";
import type {
  AgentState,
  ConnectionComponent,
  ConnectionState,
  ServerMessage,
} from "./protocol.js";

/**
 * Thin per-connection wrapper around the browser WebSocket. Encapsulates the
 * outbound message shapes so `geminiStream.ts` doesn't construct JSON by hand,
 * and tracks the current canvas snapshot (we read it back when rebuilding the
 * system instruction on the next turn).
 */
export class ClientSocket {
  private currentCanvas: string | null = null;

  constructor(private readonly ws: WebSocket) {}

  /** Send if the socket is still open; silently drop otherwise. */
  private send(msg: ServerMessage): void {
    if (this.ws.readyState !== 1 /* OPEN */) return;
    this.ws.send(JSON.stringify(msg));
  }

  sendConnectionStatus(
    state: ConnectionState,
    detail?: string,
    component: ConnectionComponent = "gemini",
  ): void {
    this.send({ type: "connection.status", component, state, detail });
  }

  sendAgentStatus(state: AgentState, detail?: string): void {
    this.send({ type: "agent.status", state, detail });
  }

  sendAgentAudio(base64Pcm24k: string): void {
    this.send({ type: "audio", data: base64Pcm24k });
  }

  sendTranscript(args: {
    role: "user" | "agent";
    text: string;
    messageId?: string;
  }): void {
    this.send({
      type: "transcript",
      role: args.role,
      text: args.text,
      messageId: args.messageId,
      ts: Date.now(),
    });
  }

  sendThinking(text: string): void {
    this.send({ type: "thinking", text, ts: Date.now() });
  }

  sendCanvasUpdate(schema: unknown): void {
    this.currentCanvas = JSON.stringify(schema, null, 2);
    this.send({ type: "canvas.update", schema });
  }

  sendResults(args: {
    stageId: string;
    label?: string;
    rows: unknown[];
  }): void {
    this.send({
      type: "results",
      stageId: args.stageId,
      label: args.label,
      rows: args.rows,
      executedAt: new Date().toISOString(),
    });
  }

  sendTrace(args: {
    kind:
      | "tool_call_start"
      | "tool_call_result"
      | "agent_text"
      | "user_text"
      | "turn_complete"
      | "info"
      | "error";
    label?: string;
    payload?: unknown;
    isError?: boolean;
    text?: string;
    durationMs?: number;
  }): void {
    this.send({
      type: "trace",
      kind: args.kind,
      label: args.label,
      payload: args.payload,
      isError: args.isError,
      text: args.text,
      durationMs: args.durationMs,
      ts: Date.now(),
    });
  }

  sendMflixCollections(args: {
    database: string;
    collections: Array<{
      name: string;
      estimatedCount?: number;
      exampleDocument?: unknown;
      error?: string;
    }>;
    error?: string;
  }): void {
    this.send({
      type: "mflix.collections",
      database: args.database,
      collections: args.collections,
      error: args.error,
    });
  }

  getCurrentCanvas(): string | null {
    return this.currentCanvas;
  }
}
