import {
  GoogleGenAI,
  type Chat,
  type FunctionCall,
  type FunctionDeclaration,
} from "@google/genai";

import type { MongoMcpClient } from "../mcp/mongoClient.js";
import { stripHeavyFieldsFromMcpResult } from "../mcp/responseUtils.js";
import type { ClientSocket } from "../websocket/clientSocket.js";
import type { LanguageMode } from "../websocket/protocol.js";
import { buildSystemInstruction } from "./systemInstruction.js";
import {
  CUSTOM_TOOL_NAMES,
  getCustomToolDeclarations,
  isCustomToolName,
} from "./customTools.js";
// HOLD: separated transcription model. Switching `echoUserSpeech` to a
// stronger model didn't materially improve transcription quality — see
// the discussion thread for the alternatives we're considering.
// import { TRANSCRIPTION_MODEL } from "./models.js";

/**
 * Hard cap on tool-call iterations per user turn. A well-behaved agent
 * needs 2-4 (update_canvas → aggregate → push_results, sometimes a
 * collection-schema lookup). Looping past 8 means the agent is stuck
 * retrying — better to surface a turn_complete than spin forever.
 */
const MAX_TOOL_ITERATIONS = 8;

/**
 * Phrases Gemini's transcription tends to invent when given silence,
 * music, or background noise. Add new ones here as we observe them. The
 * sentinel `__SILENCE__` is what we explicitly ask the model to output
 * when there's no speech.
 */
const NOISE_TRANSCRIPTION_PATTERNS: RegExp[] = [
  /^__silence__$/i,
  /^\.+$/, // just periods
  /^[\s\W]+$/, // only whitespace + punctuation
  /^(thanks?( for watching)?|thank you|bye+|okay)\.?$/i, // common hallucinations
  /^(music|silence|background music|\(music\))\.?$/i,
];

function looksLikeNoiseTranscription(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length < 3) return true; // single-letter / "uh" / etc.
  return NOISE_TRANSCRIPTION_PATTERNS.some((re) => re.test(trimmed));
}

export interface AgentLoopOptions {
  apiKey: string;
  model: string;
  mcp: MongoMcpClient;
  client: ClientSocket;
  languageMode: LanguageMode;
  atlasAvailable: boolean;
  atlasDetail?: string;
}

/**
 * Explicit ReAct loop driven by `gemini-3.1-flash-preview` (or any
 * `chats.create`-compatible model). Replaces the Live API streaming
 * session deprecated in Phase 1.
 *
 * Flow per user turn:
 *   1. UI sends { type: "user.text", text }.
 *   2. `sendUserMessage()` forwards to the chat session.
 *   3. Loop until the model returns no function calls:
 *      - Emit `tool_call_start` trace for each function call.
 *      - Execute (custom tool → ClientSocket / MCP tool → MongoDB).
 *      - Emit `tool_call_result` trace with payload + duration.
 *      - Send function responses back to the model.
 *   4. Emit any final `agent_text` and a `turn_complete` trace.
 *
 * The Chat object persists for the lifetime of one WS connection, so
 * Gemini retains conversation memory across turns. We do NOT rebuild the
 * system instruction mid-session — the model tracks canvas state via its
 * own `update_canvas` calls in the chat history.
 */
export class AgentLoop {
  private readonly ai: GoogleGenAI;
  private chat: Chat | null = null;
  /** Most recent canvas the agent committed to, used only for trace echoing. */
  private currentCanvas: string | null = null;
  /** Prevents two user turns from racing each other's sendMessage calls. */
  private inFlight = false;

  constructor(private readonly opts: AgentLoopOptions) {
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
  }

  /** Lazily build the chat session. Reused across user turns. */
  private ensureChat(): Chat {
    if (this.chat) return this.chat;

    const mcpToolNames = this.opts.atlasAvailable
      ? this.opts.mcp.geminiFunctionDeclarations().map((d) => d.name)
      : [];

    const systemInstruction = buildSystemInstruction({
      currentCanvas: this.currentCanvas,
      mcpToolNames,
      atlasAvailable: this.opts.atlasAvailable,
      atlasDetail: this.opts.atlasDetail,
      languageMode: this.opts.languageMode,
    });

    // MCP declarations come back with `parameters: unknown` because the
    // sanitizer can't statically narrow JSON Schema → Gemini's Schema type.
    // The runtime shape is valid; cast to satisfy the SDK signature.
    const functionDeclarations: FunctionDeclaration[] = [
      ...(this.opts.atlasAvailable
        ? (this.opts.mcp.geminiFunctionDeclarations() as unknown as FunctionDeclaration[])
        : []),
      ...getCustomToolDeclarations(),
    ];

    // Note: we used to emit a `session.ready` info trace here listing the
    // model + tool names. The UI surfaces that in the sidebar's status bar
    // (via `connection.status` detail) instead, so we drop it from the
    // trace timeline where it was just noise.
    console.log(
      `[agent] session ready — model=${this.opts.model}, tools=${functionDeclarations.map((d) => d.name).join(", ")}`,
    );

    this.chat = this.ai.chats.create({
      model: this.opts.model,
      config: {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        tools: [{ functionDeclarations }],
      },
    });
    return this.chat;
  }

  /**
   * Drive one user turn end-to-end. The ReAct loop runs synchronously
   * inside this call — function calls, tool executions, and any follow-up
   * model rounds are all sequential. Trace events go out as we go so the
   * UI doesn't sit blank waiting for `await` to return.
   *
   * Accepts either a text message (typed) or a push-to-talk audio clip
   * (base64 + mimeType). Audio rides as an `inlineData` Part — the model
   * transcribes and reasons in one shot.
   */
  async sendUserMessage(
    input: string | { audio: { mimeType: string; data: string } },
  ): Promise<void> {
    if (this.inFlight) {
      this.opts.client.sendTrace({
        kind: "error",
        text: "A previous turn is still running — wait for it to finish.",
        isError: true,
      });
      return;
    }
    const turnStartedAt = Date.now();
    this.inFlight = true;
    const chat = this.ensureChat();

    const inputKind = typeof input === "string" ? "text" : "audio";
    const inputPreview =
      typeof input === "string"
        ? input.slice(0, 60)
        : `${input.audio.mimeType} (${input.audio.data.length}b base64)`;
    console.log(`[agent] turn start (${inputKind}): ${inputPreview}`);

    try {
      let message;
      if (typeof input === "string") {
        message = input;
      } else {
        // The browser-side Web Speech API (`useWebSpeech` hook) now feeds
        // the visible transcript directly into the trace timeline — much
        // higher fidelity than a Gemini `generateContent` transcription
        // side-call. Audio still goes to the agent for reasoning.
        // Server-side `echoUserSpeech` is kept as a fallback but not
        // invoked here; see the chat discussion for why.
        // const heardSpeech = await this.echoUserSpeech(input.audio);
        // if (!heardSpeech) return;
        message = [
          {
            inlineData: {
              mimeType: input.audio.mimeType,
              data: input.audio.data,
            },
          },
        ];
      }
      let response = await chat.sendMessage({ message });

      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        const text = response.text;
        if (text && text.trim()) {
          console.log(
            `[agent] iter ${iter}: emitting agent_text (${text.length} chars)`,
          );
          this.opts.client.sendTrace({ kind: "agent_text", text });
        }

        const calls = response.functionCalls ?? [];
        if (calls.length === 0) {
          console.log(`[agent] iter ${iter}: no more tool calls — turn done`);
          break;
        }

        const fnResponses = await this.dispatchCalls(calls);

        // Send tool responses back to continue the ReAct loop.
        response = await chat.sendMessage({
          message: fnResponses.map((fr) => ({
            functionResponse: {
              id: fr.id,
              name: fr.name,
              response: fr.response,
            },
          })),
        });

        if (iter === MAX_TOOL_ITERATIONS - 1 && (response.functionCalls?.length ?? 0) > 0) {
          this.opts.client.sendTrace({
            kind: "error",
            text: `Stopping after ${MAX_TOOL_ITERATIONS} tool-call iterations — the agent looks stuck.`,
            isError: true,
          });
        }
      }
    } catch (err) {
      console.error("[agent] turn failed:", err);
      this.opts.client.sendTrace({
        kind: "error",
        text: String(err),
        isError: true,
      });
    } finally {
      const turnDurationMs = Date.now() - turnStartedAt;
      console.log(`[agent] turn complete in ${turnDurationMs}ms`);
      this.inFlight = false;
      this.opts.client.sendTrace({
        kind: "turn_complete",
        durationMs: turnDurationMs,
      });
    }
  }

  /**
   * One-shot transcription of a push-to-talk clip, separate from the main
   * ReAct chat session, so we can echo "what the user said" into the trace
   * timeline. Best-effort — if transcription fails we just skip the echo;
   * the main `sendMessage()` with the audio Part still runs.
   */
  /**
   * Transcribe the user's audio clip and emit a `user_text` trace.
   * Returns true if the clip contained real speech (so the caller can
   * proceed with the main chat call), false if it looks like silence /
   * noise / a hallucination (caller should skip the chat call).
   */
  private async echoUserSpeech(audio: {
    mimeType: string;
    data: string;
  }): Promise<boolean> {
    try {
      // HOLD: previously used a separate `TRANSCRIPTION_MODEL` here for
      // higher-fidelity ASR. It didn't materially improve quality, so we're
      // back to using the agent's model until we pick a better approach
      // (browser-side STT, Live API ASR, dedicated speech model, etc.).
      const result = await this.ai.models.generateContent({
        model: this.opts.model,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: audio.mimeType, data: audio.data } },
              {
                text:
                  "Transcribe this audio verbatim. Preserve disfluencies, do not correct grammar, do not paraphrase. Output only the words spoken, with no commentary, no quotes, no labels. " +
                  "If the audio contains no clear speech (silence, noise, music, breathing), output exactly the single token: __SILENCE__ — do not invent or paraphrase content.",
              },
            ],
          },
        ],
      });
      const text = (result.text ?? "").trim();
      if (!text) return false;
      if (looksLikeNoiseTranscription(text)) {
        console.log(`[agent] dropping noise transcription: ${text}`);
        return false;
      }
      this.opts.client.sendTrace({ kind: "user_text", text });
      return true;
    } catch (err) {
      console.warn("[agent] transcription side-call failed:", err);
      // If transcription fails, assume the audio is real and let the main
      // chat call handle it — don't silently drop user input.
      return true;
    }
  }

  /** Execute each function call, emit traces, return responses for the next round. */
  private async dispatchCalls(
    calls: FunctionCall[],
  ): Promise<
    Array<{ id?: string; name: string; response: Record<string, unknown> }>
  > {
    const responses: Array<{
      id?: string;
      name: string;
      response: Record<string, unknown>;
    }> = [];

    console.log(
      `[agent] dispatching ${calls.length} tool call(s): ${calls.map((c) => c.name).join(", ")}`,
    );

    for (const call of calls) {
      const name = call.name ?? "";
      const args = (call.args ?? {}) as Record<string, unknown>;

      const argsPreview = (() => {
        try {
          const s = JSON.stringify(args);
          return s.length > 200 ? s.slice(0, 200) + "…" : s;
        } catch {
          return "<unserializable>";
        }
      })();
      console.log(`[agent] → ${name} args=${argsPreview}`);

      this.opts.client.sendTrace({
        kind: "tool_call_start",
        label: name,
        payload: args,
      });

      const startedAt = Date.now();
      const outcome = await this.executeTool(name, args);
      const durationMs = Date.now() - startedAt;

      const responsePreview = (() => {
        try {
          const s = JSON.stringify(outcome.response);
          return s.length > 200 ? s.slice(0, 200) + "…" : s;
        } catch {
          return "<unserializable>";
        }
      })();
      console.log(
        `[agent] ← ${name} ${outcome.isError ? "ERROR" : "ok"} in ${durationMs}ms result=${responsePreview}`,
      );

      this.opts.client.sendTrace({
        kind: "tool_call_result",
        label: name,
        payload: outcome.response,
        isError: !!outcome.isError,
        durationMs,
      });

      responses.push({ id: call.id, name, response: outcome.response });
    }

    return responses;
  }

  private async executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ response: Record<string, unknown>; isError?: boolean }> {
    if (isCustomToolName(name)) {
      return this.executeCustomTool(name, args);
    }
    if (this.opts.mcp.isMcpToolName(name)) {
      if (!this.opts.mcp.isConnected()) {
        return {
          response: {
            error:
              "MongoDB Atlas is not connected. Ask the user to configure the connection string in Settings.",
          },
          isError: true,
        };
      }
      try {
        const raw = await this.opts.mcp.callTool(name, args);
        const cleaned = stripHeavyFieldsFromMcpResult(raw);
        const isErr = !!(cleaned as { isError?: boolean })?.isError;
        return { response: { result: cleaned }, isError: isErr };
      } catch (err) {
        return { response: { error: String(err) }, isError: true };
      }
    }
    return {
      response: { error: `Unknown tool: ${name}` },
      isError: true,
    };
  }

  private executeCustomTool(
    name: string,
    args: Record<string, unknown>,
  ): { response: Record<string, unknown>; isError?: boolean } {
    if (name === CUSTOM_TOOL_NAMES.update_canvas) {
      const schema = args.schema;
      if (!schema || typeof schema !== "object") {
        return {
          response: { error: "update_canvas requires a `schema` object" },
          isError: true,
        };
      }
      this.opts.client.sendCanvasUpdate(schema);
      try {
        this.currentCanvas = JSON.stringify(schema);
      } catch {
        /* swallow — currentCanvas is only used for downstream trace echoes */
      }
      return { response: { ok: true } };
    }
    if (name === CUSTOM_TOOL_NAMES.push_results) {
      const stageId = typeof args.stageId === "string" ? args.stageId : null;
      const rows = Array.isArray(args.rows) ? args.rows : null;
      if (!stageId || !rows) {
        return {
          response: {
            error:
              "push_results requires `stageId` (string) and `rows` (array)",
          },
          isError: true,
        };
      }
      this.opts.client.sendResults({
        stageId,
        label: typeof args.label === "string" ? args.label : undefined,
        rows,
      });
      return { response: { ok: true, count: rows.length } };
    }
    return {
      response: { error: `Unhandled custom tool: ${name}` },
      isError: true,
    };
  }
}
