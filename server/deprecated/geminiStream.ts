import {
  GoogleGenAI,
  Modality,
  type FunctionCall,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
/* eslint-disable @typescript-eslint/no-unused-vars */

import type { MongoMcpClient } from "../mcp/mongoClient.js";
import {
  CUSTOM_TOOL_NAMES,
  getCustomToolDeclarations,
  isCustomToolName,
} from "../agent/customTools.js";
import { buildSystemInstruction } from "../agent/systemInstruction.js";
import { isLikelyEnglish } from "../lib/englishDetect.js";
import type { ClientSocket } from "./clientSocket.js";
import type { LanguageMode } from "./protocol.js";

/**
 * Cap for the cleaned text we forward to Gemini Live. The Live API rejects
 * oversized function responses with WS 1007 — 32 KB sits comfortably under
 * the limit. We let MCP return whatever it wants (so a full 20-row sample
 * comes back), then post-process: strip vector fields, then truncate if
 * the result is still too large.
 */
const GEMINI_TOOL_RESPONSE_BYTE_BUDGET = 32 * 1024;

/**
 * Fields we strip from MCP textual content before forwarding to Gemini.
 * These are typically multi-KB binary/vector payloads that the model
 * doesn't need and that routinely push responses over the per-message
 * size cap.
 */
const HEAVY_FIELD_NAMES = [
  "plot_embedding",
  "embedding",
  "vector",
  "queryVector",
];

/**
 * Strip vector/embedding fields from MCP textual content and (if still too
 * large) truncate so the final payload fits Gemini Live's tool-response
 * budget. We DO NOT pre-cap MCP itself: a 32 KB cap there meant MCP only
 * returned 1 of 20 docs, because each `embedded_movies` doc with its
 * 1536-float `plot_embedding` is ~30 KB raw. Letting MCP return everything
 * and stripping the heavy fields afterwards keeps the row count intact.
 */
function stripHeavyFieldsFromMcpResult(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as { content?: Array<{ type?: string; text?: string }> };
  if (!Array.isArray(r.content)) return raw;
  const newContent = r.content.map((c) => {
    if (c?.type !== "text" || typeof c.text !== "string") return c;
    let stripped = stripHeavyFieldsFromText(c.text);
    if (stripped.length > GEMINI_TOOL_RESPONSE_BYTE_BUDGET) {
      stripped =
        stripped.slice(0, GEMINI_TOOL_RESPONSE_BYTE_BUDGET) +
        `\n…[truncated to fit Gemini's tool-response budget; ${stripped.length - GEMINI_TOOL_RESPONSE_BYTE_BUDGET} more bytes elided]`;
    }
    return stripped === c.text ? c : { ...c, text: stripped };
  });
  return { ...raw, content: newContent };
}

function stripHeavyFieldsFromText(text: string): string {
  // Most MCP `aggregate`/`find` responses include free-form prose plus one or
  // more JSON objects/arrays. We don't try to parse the whole thing — instead
  // we walk through and elide the value of any `"<heavy>": ...` occurrences.
  // The regex handles both `[…floats…]` (vector arrays) and `{…binData…}`
  // (the BSON-stringified vector form).
  let out = text;
  for (const field of HEAVY_FIELD_NAMES) {
    const arrayForm = new RegExp(
      `"${field}"\\s*:\\s*\\[[^\\]]*\\]`,
      "g",
    );
    const objForm = new RegExp(
      `"${field}"\\s*:\\s*\\{[^{}]*\\}`,
      "g",
    );
    out = out
      .replace(arrayForm, `"${field}":"<elided ${field}>"`)
      .replace(objForm, `"${field}":"<elided ${field}>"`);
  }
  return out;
}

/**
 * Per-browser-connection Gemini Live ReAct loop.
 *
 * Responsibilities:
 *   - Open a Live session bound to `clientSocket` and `mcp`.
 *   - Forward inbound mic audio (from the browser) into the session.
 *   - Forward outbound model audio + transcripts back to the browser.
 *   - Dispatch tool calls:
 *       update_canvas / push_results → ClientSocket (instant UI update).
 *       Everything else → MongoMcpClient (real MongoDB operation).
 *   - Send tool responses back to Gemini so the ReAct loop continues.
 */
export class GeminiStreamSession {
  private session: Session | null = null;
  private readonly ai: GoogleGenAI;
  /** True while the model is currently producing an agent turn. Used to flip
   * agent.status between "speaking" and "idle" on turn boundaries. */
  private agentTurnInFlight = false;
  private currentUserMessageId: string | null = null;
  private currentAgentMessageId: string | null = null;
  private lastUserChunkAt = 0;
  private userMessageSeq = 0;
  private agentMessageSeq = 0;
  /**
   * In English mode, set true for the current turn the moment any non-Latin
   * inputTranscription chunk arrives. While true, we drop every outbound agent
   * artifact (transcript, audio, thinking) so the user neither sees nor hears
   * Gemini's response to non-English speech. Reset on each turn boundary.
   */
  private suppressCurrentAgentTurn = false;
  private static readonly USER_CHUNK_GAP_MS = 1400;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly mcp: MongoMcpClient,
    private readonly client: ClientSocket,
    private readonly atlasDetail: string | undefined,
    private readonly languageMode: LanguageMode = "english",
    /**
     * Invoked when Gemini Live drops the WS with code 1011 AFTER audio has
     * flowed in either direction — the typical Google-side transient. The
     * host (`index.ts`) handles this by recreating the session with the same
     * config so the user can keep talking.
     */
    private readonly onMidStreamDrop?: () => void,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async connect(): Promise<void> {
    const atlasAvailable = this.mcp.isConnected();
    const mcpDecls = atlasAvailable
      ? this.mcp.geminiFunctionDeclarations()
      : [];

    const systemInstruction = buildSystemInstruction({
      currentCanvas: this.client.getCurrentCanvas(),
      mcpToolNames: mcpDecls.map((d) => d.name),
      atlasAvailable,
      atlasDetail: this.atlasDetail,
      languageMode: this.languageMode,
    });

    const tools = [
      {
        functionDeclarations: [
          ...getCustomToolDeclarations(),
          ...mcpDecls,
        ],
      },
    ];

    console.log(
      `[gemini] opening Live session — model=${this.model}, atlas=${atlasAvailable ? "up" : "down"}, mcpTools=${mcpDecls.length} (${mcpDecls.map((d) => d.name).join(", ")}), customTools=${getCustomToolDeclarations().length}, sysInstrBytes=${systemInstruction.length}`,
    );
    this.client.sendConnectionStatus("connecting");

    // English mode pins TTS to en-US so a forgotten "respond in English" rule
    // still produces correct-sounding audio. International mode omits the
    // languageCode so Gemini's multilingual TTS can mirror the user's language.
    const speechConfig =
      this.languageMode === "english" ? { languageCode: "en-US" } : {};

    // Note: `inputAudioTranscription.languageCodes` would bias the ASR to
    // English at the source, but it's only available on the Vertex/Enterprise
    // path — the AI Studio Developer API rejects it. We fall back to the
    // downstream `isLikelyEnglish` filter for stragglers.

    this.session = await this.ai.live.connect({
      model: this.model,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        tools,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      } as unknown as Parameters<
        typeof this.ai.live.connect
      >[0]["config"],
      callbacks: {
        onopen: () => {
          console.log("[gemini] Live session opened");
          this.client.sendConnectionStatus("connected");
          this.client.sendAgentStatus("idle");
          // Nudge the model to introduce itself + warn about Atlas if applicable.
          // sendClientContent with turnComplete=true counts as a user turn,
          // so the model will produce an audio response right away. In English
          // mode we reinforce the language rule on the first turn — some Live
          // checkpoints are reluctant to switch back from the user's apparent
          // language once an exchange has started.
          const english = this.languageMode === "english";
          const englishHint = english
            ? " Always respond in English regardless of what language the user appears to speak."
            : "";
          const greeting = atlasAvailable
            ? `Greet the user briefly and ask what they would like to query from MongoDB.${englishHint}`
            : `Greet the user briefly (one short sentence). In a second sentence, tell them MongoDB Atlas isn't connected yet${this.atlasDetail ? ` (${this.atlasDetail})` : ""}, so you can't run real queries, and point them at the Settings cog (top-right) to paste their Atlas connection string. Close with ONE friendly question — but it MUST be about getting connected or what you can explain (e.g. "Want me to walk you through setting up Atlas?" or "Anything I can explain about the app while you find your connection string?"). DO NOT ask what they want to query — there is no database to query against. Keep it under 3 sentences total.${englishHint}`;
          try {
            this.session?.sendClientContent({
              turns: [{ role: "user", parts: [{ text: greeting }] }],
              turnComplete: true,
            });
          } catch (err) {
            console.warn("[gemini] failed to send greeting prompt:", err);
          }
        },
        onmessage: (msg) => {
          void this.handleServerMessage(msg);
        },
        onerror: (err) => {
          console.error("[gemini] Live error:", err);
          this.client.sendConnectionStatus("error", String(err));
          this.client.sendAgentStatus("error", "Live session error");
        },
        onclose: (ev) => {
          const code = (ev as { code?: number })?.code;
          const reason = (ev as { reason?: string })?.reason;
          console.log("[gemini] Live session closed:", code, reason);
          // Distinguish setup-time 1011 (payload invalid, fatal) from
          // mid-stream 1011 (Google-side transient, recoverable).
          let isMidStream1011 = false;
          if (code === 1011) {
            if (this.outboundAudioChunks > 0 || this.inboundAudioChunks > 0) {
              isMidStream1011 = true;
              console.error(
                "[gemini] 1011 mid-stream — session opened and exchanged audio " +
                  `(in=${this.inboundAudioChunks}, out=${this.outboundAudioChunks}) ` +
                  "before Gemini dropped it. Will attempt one auto-reconnect.",
              );
            } else {
              console.error(
                "[gemini] 1011 at setup — function declarations payload likely invalid. " +
                  "Inspect the most recent 'opening Live session' log line. Common causes: " +
                  "(a) too many tools, (b) JSON Schema keywords Gemini doesn't accept, " +
                  "(c) tool names violating the [a-zA-Z0-9_-]{1,64} pattern, " +
                  "(d) system instruction too large.",
              );
            }
          }
          this.sessionClosed = true;

          // Mid-stream 1011: hand off to the host for a transparent restart.
          // Don't surface this as an error to the UI — the host will send a
          // "connecting…" status of its own.
          if (isMidStream1011 && this.onMidStreamDrop) {
            try {
              this.onMidStreamDrop();
            } catch (err) {
              console.error("[gemini] onMidStreamDrop callback threw:", err);
            }
            return;
          }

          // 1000 = normal closure. Anything else (1006 transport drop, 1008
          // policy violation like an unknown model, etc.) is an error the user
          // should see in the UI rather than as a silent "disconnected" state.
          if (code && code !== 1000) {
            this.client.sendConnectionStatus(
              "error",
              reason || `Gemini Live closed with code ${code}`,
            );
            this.client.sendAgentStatus(
              "error",
              reason || `Live closed with code ${code}`,
            );
          } else {
            this.client.sendConnectionStatus("disconnected");
            this.client.sendAgentStatus("idle");
          }
        },
      },
    });
  }

  private inboundAudioChunks = 0;
  private outboundAudioChunks = 0;
  private sessionClosed = false;

  /** Forward a base64 PCM-16kHz chunk from the browser into the model. */
  sendAudio(base64Pcm16k: string): void {
    if (!this.session || this.sessionClosed) return;
    this.inboundAudioChunks++;
    if (this.inboundAudioChunks === 1) {
      console.log("[gemini] first inbound audio chunk from browser");
    } else if (this.inboundAudioChunks % 100 === 0) {
      console.log(`[gemini] inbound audio chunks: ${this.inboundAudioChunks}`);
    }
    try {
      // Use `audio:` rather than the legacy `media:` field. Newer Live models
      // (gemini-3.x-flash-live-preview) reject the deprecated `media_chunks`
      // wire format with WS 1007. `audio:` works for both 2.5 and 3.x.
      this.session.sendRealtimeInput({
        audio: { mimeType: "audio/pcm;rate=16000", data: base64Pcm16k },
      });
    } catch (err) {
      // Session may have been closed between our check and the send.
      this.sessionClosed = true;
      console.warn("[gemini] sendRealtimeInput failed; marking session closed:", err);
    }
  }

  disconnect(): void {
    try {
      this.session?.close();
    } catch (err) {
      console.warn("[gemini] error closing session:", err);
    }
    this.session = null;
  }

  // ───────────────────────── internals ─────────────────────────

  private async handleServerMessage(msg: LiveServerMessage): Promise<void> {
    const sc = msg.serverContent;
    const now = Date.now();

    // 1. User speech transcription. Forward each delta and stamp a messageId
    // so the UI can keep one utterance in one bubble.
    //
    // We used to force-suppress the agent's reply when the input looked
    // non-English (via `isLikelyEnglish`), but that had a high false-positive
    // rate on short English utterances — the agent would speak, we'd drop
    // its audio, and the user would hear nothing or hear stale audio carry
    // over to the next turn. The LANGUAGE_RULE in the system instruction
    // already tells the model to say "I didn't catch that" naturally for
    // unclear speech, so we trust the model. The UI still filters cosmetically.
    if (sc?.inputTranscription?.text) {
      if (
        !this.currentUserMessageId ||
        now - this.lastUserChunkAt > GeminiStreamSession.USER_CHUNK_GAP_MS
      ) {
        this.currentUserMessageId = `u-${++this.userMessageSeq}`;
      }
      this.lastUserChunkAt = now;

      this.client.sendTranscript({
        role: "user",
        text: sc.inputTranscription.text,
        messageId: this.currentUserMessageId,
      });
    }

    // 2. Agent speech transcription. First chunk flips status → speaking.
    if (sc?.outputTranscription?.text) {
      if (!this.agentTurnInFlight) {
        this.agentTurnInFlight = true;
        this.currentAgentMessageId = `a-${++this.agentMessageSeq}`;
        if (!this.suppressCurrentAgentTurn) {
          this.client.sendAgentStatus("speaking");
        }
      }
      if (!this.currentAgentMessageId) {
        this.currentAgentMessageId = `a-${++this.agentMessageSeq}`;
      }
      if (!this.suppressCurrentAgentTurn) {
        const agentText = this.filterAgentTranscript(sc.outputTranscription.text);
        if (agentText) {
          this.client.sendTranscript({
            role: "agent",
            text: agentText,
            messageId: this.currentAgentMessageId,
          });
        }
      }
    }

    // 3. Walk modelTurn parts: audio → playback; text parts → thinking.
    // Both are gated by the suppression flag.
    const parts = sc?.modelTurn?.parts ?? [];
    for (const part of parts) {
      const mime = part.inlineData?.mimeType ?? "";
      if (mime.startsWith("audio/") && part.inlineData?.data) {
        if (this.suppressCurrentAgentTurn) continue;
        this.outboundAudioChunks++;
        if (this.outboundAudioChunks === 1) {
          console.log("[gemini] first outbound audio chunk to browser");
        } else if (this.outboundAudioChunks % 100 === 0) {
          console.log(`[gemini] outbound audio chunks: ${this.outboundAudioChunks}`);
        }
        this.client.sendAgentAudio(part.inlineData.data);
        continue;
      }
      // Text parts in modelTurn are the model's reasoning, not its speech —
      // they aren't spoken aloud but are useful for debugging.
      if (part.text && !this.suppressCurrentAgentTurn) {
        this.client.sendThinking(part.text);
      }
    }

    // 4. Turn boundary — drop status back to idle, clear suppression.
    if (sc?.turnComplete || sc?.generationComplete) {
      console.log(
        `[gemini] turn boundary (${sc.turnComplete ? "turnComplete" : "generationComplete"}) — outbound=${this.outboundAudioChunks}, inbound=${this.inboundAudioChunks}`,
      );
      this.agentTurnInFlight = false;
      this.currentAgentMessageId = null;
      this.currentUserMessageId = null;
      this.suppressCurrentAgentTurn = false;
      this.client.sendAgentStatus("idle");
    }

    // 5. Interruption — the model is yielding the turn back to the user.
    if (sc?.interrupted) {
      console.log("[gemini] interrupted by user VAD");
      this.agentTurnInFlight = false;
      this.currentAgentMessageId = null;
      this.currentUserMessageId = null;
      this.suppressCurrentAgentTurn = false;
      this.client.sendAgentStatus("idle", "interrupted");
    }

    // 6. Tool calls — this is the core ReAct branch.
    const calls = msg.toolCall?.functionCalls ?? [];
    if (calls.length > 0) {
      await this.dispatchToolCalls(calls);
    }
  }

  private async dispatchToolCalls(calls: FunctionCall[]): Promise<void> {
    console.log(
      `[gemini] toolCall — ${calls.map((c) => c.name).join(", ")}`,
    );
    this.client.sendAgentStatus("tool-call", this.summarizeCalls(calls));

    const responses: Array<{
      id?: string;
      name: string;
      response: Record<string, unknown>;
    }> = [];

    for (const call of calls) {
      const name = call.name ?? "";
      const args = (call.args ?? {}) as Record<string, unknown>;
      try {
        if (isCustomToolName(name)) {
          responses.push({
            id: call.id,
            name,
            response: this.executeCustomTool(name, args),
          });
        } else if (this.mcp.isMcpToolName(name)) {
          if (!this.mcp.isConnected()) {
            responses.push({
              id: call.id,
              name,
              response: {
                error:
                  "MongoDB Atlas is currently unavailable. Tell the user the database isn't reachable and offer to help design the pipeline anyway.",
              },
            });
          } else {
            const argsPreview = (() => {
              try {
                const s = JSON.stringify(args);
                return s.length > 400 ? s.slice(0, 400) + "…(truncated)" : s;
              } catch {
                return "<unserializable>";
              }
            })();
            console.log(`[mcp] → ${name} args=${argsPreview}`);
            const startedAt = Date.now();
            const rawResult = await this.mcp.callTool(name, args);
            const ms = Date.now() - startedAt;
            // MCP can return multi-hundred-KB blobs for vector-bearing
            // collections. Strip vectors, then truncate to fit Gemini's
            // tool-response budget. Done after the call so MCP doesn't
            // pre-cap row count.
            const result = stripHeavyFieldsFromMcpResult(rawResult);
            const resultPreview = (() => {
              try {
                const s = JSON.stringify(result);
                return s.length > 400 ? s.slice(0, 400) + "…(truncated)" : s;
              } catch {
                return "<unserializable>";
              }
            })();
            const isError = !!(result as { isError?: boolean })?.isError;
            console.log(
              `[mcp] ← ${name} ${isError ? "ERROR" : "ok"} in ${ms}ms result=${resultPreview}`,
            );
            responses.push({
              id: call.id,
              name,
              response: { result },
            });
          }
        } else {
          responses.push({
            id: call.id,
            name,
            response: { error: `Unknown tool: ${name}` },
          });
        }
      } catch (err) {
        console.error(`[tool] ${name} failed:`, err);
        responses.push({
          id: call.id,
          name,
          response: { error: String(err) },
        });
      }
    }

    this.session?.sendToolResponse({ functionResponses: responses });
    // Once we hand control back, we expect the model to keep speaking/reasoning;
    // status returns to "thinking" until the next audio frame arrives.
    this.client.sendAgentStatus("thinking");
  }

  private executeCustomTool(
    name: string,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    if (name === CUSTOM_TOOL_NAMES.update_canvas) {
      const schema = args.schema;
      // Log enough to see whether the agent passed a real pipeline or a
      // half-empty placeholder. Truncated to keep the log readable.
      const preview = (() => {
        try {
          const s = JSON.stringify(schema);
          return s.length > 600 ? s.slice(0, 600) + "…(truncated)" : s;
        } catch {
          return String(schema);
        }
      })();
      const stageCount = Array.isArray(
        (schema as { stages?: unknown[] } | undefined)?.stages,
      )
        ? ((schema as { stages: unknown[] }).stages.length)
        : 0;
      console.log(
        `[tool] update_canvas — stages=${stageCount}, payload=${preview}`,
      );
      if (!schema || typeof schema !== "object") {
        console.warn(
          `[tool] update_canvas REJECTED — schema is not an object. args keys: ${Object.keys(args).join(", ")}`,
        );
        return { error: "update_canvas requires a `schema` object" };
      }
      this.client.sendCanvasUpdate(schema);
      return { ok: true };
    }
    if (name === CUSTOM_TOOL_NAMES.push_results) {
      const stageId = typeof args.stageId === "string" ? args.stageId : null;
      const rows = Array.isArray(args.rows) ? args.rows : null;
      console.log(
        `[tool] push_results — stageId=${stageId}, rowCount=${rows?.length ?? "n/a"}`,
      );
      if (!stageId || !rows) {
        console.warn(
          `[tool] push_results REJECTED — args keys: ${Object.keys(args).join(", ")}, stageId type=${typeof args.stageId}, rows is array=${Array.isArray(args.rows)}`,
        );
        return { error: "push_results requires `stageId` (string) and `rows` (array)" };
      }
      this.client.sendResults({
        stageId,
        label: typeof args.label === "string" ? args.label : undefined,
        rows,
      });
      return { ok: true, count: rows.length };
    }
    return { error: `Unhandled custom tool: ${name}` };
  }

  private summarizeCalls(calls: FunctionCall[]): string {
    const names = calls.map((c) => c.name).filter(Boolean) as string[];
    if (names.length === 0) return "calling tool";
    if (names.length === 1) return `calling ${names[0]}`;
    return `calling ${names.length} tools: ${names.join(", ")}`;
  }

  private filterAgentTranscript(text: string): string | null {
    const chunk = text.trimEnd();
    if (!chunk.trim()) return null;
    if (this.languageMode !== "english") return chunk;
    // English-only mode: suppress chunks where the agent slipped into
    // another language (script-level or Latin-script romance/asian-language
    // mis-utterance), so the UI doesn't show cross-language bleed-through.
    // Pure-punctuation streaming deltas (", ", "…") carry no signal — let
    // them through.
    if (!/[A-Za-z]/.test(chunk)) return chunk;
    if (!isLikelyEnglish(chunk)) return null;
    return chunk;
  }
}
