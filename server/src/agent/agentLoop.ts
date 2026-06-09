import { randomUUID } from "node:crypto";
import {
  Gemini,
  InMemoryRunner,
  LlmAgent,
  MCPToolset,
  type BaseTool,
  type StdioConnectionParams,
  type ToolUnion,
} from "@google/adk";
import type { Content } from "@google/genai";

import type { MongoMcpClient } from "../mcp/mongoClient.js";
import {
  extractDocsFromMcpAggregate,
  stripHeavyFieldsFromMcpResult,
} from "../mcp/responseUtils.js";
import type { ClientSocket } from "../websocket/clientSocket.js";
import type { LanguageMode } from "../websocket/protocol.js";
import { buildCustomTools, CUSTOM_TOOL_NAMES } from "./customTools.js";
import { buildSystemInstruction } from "./systemInstruction.js";

/**
 * Allow-list of MongoDB MCP tools we expose to the agent through ADK's
 * {@link MCPToolset}. The MCP server publishes ~16+ tools, including Atlas
 * admin operations we don't want in the agent's vocabulary.
 *
 * NOTE: `aggregate` is intentionally NOT in this list. The agent's only
 * path to executing a pipeline is our custom `run_pipeline` tool, which
 * wraps the underlying MongoDB call in `$facet` and dispatches per-stage
 * `push_results` events to populate the UI. Exposing `aggregate` directly
 * lets the model pick the simpler tool and skip the result-dispatch
 * machinery — every results tab ends up blank. The legacy `MongoMcpClient`
 * (used inside `run_pipeline`'s server-side `$facet`) still has access to
 * aggregate; the agent does not.
 */
/**
 * Kept deliberately small. `find`/`count` were removed: they let the model
 * "preview" or "verify" data with extra round-trips that duplicate what
 * `run_pipeline` already shows per-stage, which was the main source of the
 * slow, multi-call turns. The grounding tools (`list-*`, `collection-schema`)
 * stay available for genuinely unknown databases, but the system instruction
 * tells the agent NOT to call them for the known `sample_mflix` demo.
 */
const MCP_TOOLS_ALLOWLIST = [
  "list-databases",
  "list-collections",
  "collection-schema",
];

const APP_NAME = "gemini-nosql-data-wrangler";
const SESSION_USER_ID = "user";

export interface AgentLoopOptions {
  apiKey: string;
  model: string;
  /** Existing MongoMcpClient used for direct (non-agent) MCP calls: probing
   *  Atlas at startup, `run_pipeline`'s $facet wrapper, and the Mflix
   *  reference refresh. The agent's own tool surface goes through ADK's
   *  {@link MCPToolset} (separate connection) so the ADK orchestration is
   *  the canonical path Gemini sees. */
  mcp: MongoMcpClient;
  /** Connection string for the agent-side {@link MCPToolset}. We deliberately
   *  spawn a second `mongodb-mcp-server` process for the agent rather than
   *  sharing the existing transport — ADK owns the lifecycle of its toolset,
   *  and entangling the two clients risks tearing down the wrong session. */
  mongoUri: string | null;
  client: ClientSocket;
  languageMode: LanguageMode;
  atlasAvailable: boolean;
  atlasDetail?: string;
  enableSuggestedPrompts?: boolean;
}

/**
 * Drives one user turn end-to-end on top of the Google Agent Development Kit.
 *
 * Architecture:
 *   1. Lazy build of {@link LlmAgent} + {@link InMemoryRunner} on the first
 *      user message — this lets the WebSocket "connected" signal arrive at
 *      the UI before we pay the MCP-spawn cost.
 *   2. Four custom tools wired through {@link FunctionTool}: `update_canvas`,
 *      `push_results`, `run_pipeline`, `suggest_next_prompts`.
 *   3. MongoDB MCP tools exposed via {@link MCPToolset} (allow-listed).
 *   4. Per-turn tracing: `beforeToolCallback` / `afterToolCallback` emit
 *      `tool_call_start` / `tool_call_result` trace events to the WebSocket.
 *      Agent text comes from walking the {@link Event} stream and looking
 *      for non-empty `text` parts in non-partial events.
 *
 * This file replaces the hand-rolled ReAct loop that lived here pre-ADK.
 * That implementation is preserved on the `deprecated` git branch as a
 * fallback if we ever need to A/B between the two orchestrators.
 */
export class AgentLoop {
  private readonly llm: Gemini;
  private runner: InMemoryRunner | null = null;
  private mcpToolset: MCPToolset | null = null;
  /** ADK session id. Reassigned by {@link reset} to wipe Gemini's memory for
   *  a fresh chat while keeping the WebSocket + spawned MCP process alive. */
  private sessionId = randomUUID();
  /** Most recent canvas JSON the agent committed to. Read by the
   *  instruction provider so each turn sees fresh state. */
  private currentCanvas: string | null = null;
  /** Prevents two user turns from racing each other's sendMessage calls. */
  private inFlight = false;
  /** Per-tool start timestamps so the after-callback can compute duration.
   *  Keyed by tool name; values are pushed/popped as a stack so re-entrant
   *  calls (rare, but possible with parallel tool calls) stay matched. */
  private readonly toolStartStack = new Map<string, number[]>();
  /** Wall-clock of the last user-visible activity in the current turn (turn
   *  start, or the moment the most recent tool call returned). Used to time
   *  the "thinking" gap that precedes each agent text reply so the UI can
   *  show a "Thought for Xs" pill. */
  private lastActivityAt = 0;
  /**
   * Per-turn memo of the FIRST successful `run_pipeline` execution. Cleared
   * at the start of every user turn. A single turn should only ever hit
   * MongoDB once — the agent occasionally fires `run_pipeline` two or three
   * times (a redundant "re-check", or a second attempt against the wrong
   * collection that returns 0 docs and makes it apologize). When that
   * happens we short-circuit: skip the extra round-trip entirely and hand
   * back the already-successful result so the agent sees success, stops, and
   * the populated results tabs aren't disturbed.
   */
  private runPipelineMemo:
    | Awaited<ReturnType<AgentLoop["runPipelineFacet"]>>
    | null = null;

  constructor(private readonly opts: AgentLoopOptions) {
    this.llm = new Gemini({
      model: opts.model,
      apiKey: opts.apiKey,
    });
  }

  /** Lazily build the runner. Reused across user turns within one session. */
  private async ensureRunner(): Promise<InMemoryRunner> {
    if (this.runner) return this.runner;

    const tools: ToolUnion[] = [];

    // 1) Our four custom tools, with the deps they close over.
    const customTools = buildCustomTools({
      client: this.opts.client,
      setCurrentCanvas: (schema: unknown) => {
        try {
          this.currentCanvas = JSON.stringify(schema);
        } catch {
          /* swallow — currentCanvas is best-effort */
        }
      },
      runPipelineFacet: (args) => this.runPipelineFacet(args),
    });

    const enableSuggested = this.opts.enableSuggestedPrompts !== false;
    for (const tool of customTools) {
      // Drop suggest_next_prompts entirely when the user has the setting off.
      // The model literally can't call a tool it doesn't see, so we save the
      // tokens + latency of a per-turn no-op call.
      if (
        !enableSuggested &&
        tool.name === CUSTOM_TOOL_NAMES.suggest_next_prompts
      ) {
        continue;
      }
      tools.push(tool);
    }

    // 2) MongoDB MCP tools through ADK's MCPToolset (only when Atlas is
    //    reachable AND we have a real URI — otherwise the agent runs in
    //    "design-only" mode and the system instruction tells it so).
    if (this.opts.atlasAvailable && this.opts.mongoUri) {
      this.mcpToolset = new MCPToolset(
        this.buildStdioParams(this.opts.mongoUri),
        MCP_TOOLS_ALLOWLIST,
      );
      tools.push(this.mcpToolset);
    }

    const agent = new LlmAgent({
      name: "gemini_data_wrangler",
      description:
        "Voice/text agent that builds MongoDB Aggregation Pipelines from natural language requests.",
      model: this.llm,
      // System instruction is rebuilt each invocation so the model always
      // sees the CURRENT CANVAS block reflecting the latest update_canvas.
      instruction: () =>
        buildSystemInstruction({
          currentCanvas: this.currentCanvas,
          mcpToolNames: this.opts.atlasAvailable ? MCP_TOOLS_ALLOWLIST : [],
          atlasAvailable: this.opts.atlasAvailable,
          atlasDetail: this.opts.atlasDetail,
          languageMode: this.opts.languageMode,
          enableSuggestedPrompts: enableSuggested,
        }),
      tools,
      beforeToolCallback: ({ tool, args }) => {
        const startedAt = Date.now();
        const stack = this.toolStartStack.get(tool.name) ?? [];
        stack.push(startedAt);
        this.toolStartStack.set(tool.name, stack);

        const argsPreview = (() => {
          try {
            const s = JSON.stringify(args);
            return s.length > 160 ? s.slice(0, 160) + "…" : s;
          } catch {
            return "<unserializable>";
          }
        })();
        console.log(`[agent] → ${tool.name} args=${argsPreview}`);

        this.opts.client.sendTrace({
          kind: "tool_call_start",
          label: tool.name,
          payload: args,
        });
        return undefined;
      },
      afterToolCallback: ({ tool, response }) => {
        const stack = this.toolStartStack.get(tool.name) ?? [];
        const startedAt = stack.shift();
        const durationMs =
          startedAt != null ? Date.now() - startedAt : undefined;

        // For MCP responses, run our heavy-field strip so the model's
        // tool-response budget doesn't get blown by big vector fields.
        // Custom tools always return small structured responses, so we
        // skip the strip on those.
        const isMcpTool = isLikelyMcpToolName(tool.name);
        const payload = isMcpTool
          ? stripHeavyFieldsFromMcpResult(response)
          : response;

        const isError =
          this.responseLooksLikeError(payload) ||
          this.responseLooksLikeError(response);

        console.log(
          `[agent] ← ${tool.name} ${isError ? "ERROR" : "ok"}${
            durationMs != null ? ` in ${durationMs}ms` : ""
          }`,
        );

        this.opts.client.sendTrace({
          kind: "tool_call_result",
          label: tool.name,
          payload,
          isError,
          durationMs,
        });

        // Reset the "thinking" clock: any reasoning the model does AFTER this
        // tool result (before its next text reply) is timed from here.
        this.lastActivityAt = Date.now();

        // Returning undefined means "use the original response unchanged".
        // For MCP tools we want the model to see the stripped version too
        // (otherwise huge `plot_embedding` arrays burn its context budget),
        // so we return the cleaned object.
        return isMcpTool && payload !== response
          ? (payload as Record<string, unknown>)
          : undefined;
      },
    });

    this.runner = new InMemoryRunner({ agent, appName: APP_NAME });

    // Create the session once. Subsequent turns reuse it so Gemini keeps
    // conversation memory across requests.
    await this.runner.sessionService.createSession({
      appName: APP_NAME,
      userId: SESSION_USER_ID,
      sessionId: this.sessionId,
    });

    const toolNames = (
      await Promise.all(
        tools.map(async (t) => {
          if ("name" in t && typeof (t as BaseTool).name === "string") {
            return [(t as BaseTool).name];
          }
          // Toolset — pull its tools' names.
          if (typeof (t as MCPToolset).getTools === "function") {
            const inner = await (t as MCPToolset).getTools();
            return inner.map((it) => it.name);
          }
          return [];
        }),
      )
    ).flat();

    console.log(
      `[agent] session ready — model=${this.opts.model}, tools=${toolNames.join(", ")}`,
    );

    return this.runner;
  }

  /**
   * Drive one user turn end-to-end. Caller passes either a text message or
   * a base64-encoded audio clip (we forward as an `inlineData` Part — the
   * model transcribes and reasons in one shot).
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
    this.inFlight = true;
    const turnStartedAt = Date.now();
    this.lastActivityAt = turnStartedAt;
    // Fresh turn — allow exactly one real run_pipeline execution.
    this.runPipelineMemo = null;

    const inputKind = typeof input === "string" ? "text" : "audio";
    const inputPreview =
      typeof input === "string"
        ? input.slice(0, 60)
        : `${input.audio.mimeType} (${input.audio.data.length}b base64)`;
    console.log(`[agent] turn start (${inputKind}): ${inputPreview}`);

    // Visible "Thinking…" milestone — the chat panel renders it inline
    // before the first tool call lands.
    this.opts.client.sendTrace({
      kind: "info",
      label: "thinking",
      text: "Thinking…",
    });

    try {
      const runner = await this.ensureRunner();
      const newMessage: Content =
        typeof input === "string"
          ? { role: "user", parts: [{ text: input }] }
          : {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: input.audio.mimeType,
                    data: input.audio.data,
                  },
                },
              ],
            };

      let agentTextEmitted = "";
      for await (const event of runner.runAsync({
        userId: SESSION_USER_ID,
        sessionId: this.sessionId,
        newMessage,
      })) {
        // Skip partial streaming chunks — we emit a single agent_text per
        // unique non-partial text content to match the pre-ADK behavior.
        if (event.partial) continue;
        const parts = event.content?.parts ?? [];
        const collected = parts
          .map((p) => ("text" in p && typeof p.text === "string" ? p.text : ""))
          .filter(Boolean)
          .join("");
        if (!collected) continue;
        // ADK may emit the same final text content as both a "running" and
        // "final" event. Don't double-emit identical text.
        if (collected === agentTextEmitted) continue;
        agentTextEmitted = collected;

        // Safety net for a model misbehavior we've seen: the agent sometimes
        // pastes the `suggest_next_prompts` arguments straight into its final
        // text reply ("Found those westerns. { \"label\": ..., \"prompt\":
        // ... }, ..."). The chips already render from the tool-call payload,
        // so dumping the JSON in the prose is pure noise. Strip it
        // post-hoc — the system instruction also tells the model not to do
        // this, but the regex is the belt to the prompt's suspenders.
        const sanitized = stripSuggestionLeakage(collected);
        if (!sanitized) continue;

        // Emit a "thinking" pill in front of the reply that captures how long
        // the model reasoned since the last activity (turn start, or the most
        // recent tool result). Skip sub-perceptual gaps so the timeline isn't
        // littered with "Thought for 0.0s" pills.
        const thinkingMs = Date.now() - this.lastActivityAt;
        if (thinkingMs >= 300) {
          this.opts.client.sendTrace({
            kind: "info",
            label: "thinking",
            durationMs: thinkingMs,
          });
        }
        this.opts.client.sendTrace({ kind: "agent_text", text: sanitized });
        this.lastActivityAt = Date.now();
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
   * `run_pipeline`'s server-side implementation. Builds a single `$facet`
   * aggregation that runs every stage prefix in one round-trip, dispatches
   * `push_results` per stage, and returns a small summary to the agent.
   *
   * The fast path is one `$facet` aggregate. If that errors (malformed
   * prefix, single branch exceeded 16MB, etc.) we fall back to N parallel
   * prefix-aggregates so the tabs that DO succeed still populate.
   */
  private async runPipelineFacet(args: {
    database: string;
    collection: string;
    pipeline: unknown[];
    stageIds: string[];
    previewLimit: number;
  }): Promise<{
    previewed: Array<{ stageId: string; rows: number }>;
    final_stage_id: string;
    final_row_count: number;
    final_rows_sample: unknown[];
    execution_mode: "facet" | "sequential_fallback";
  }> {
    const { database, pipeline, stageIds, previewLimit } = args;
    let { collection } = args;

    // Per-turn guard: a healthy turn runs the pipeline once. If the agent
    // already ran it this turn, don't hit MongoDB again — return the cached
    // successful result so a redundant or wrong second attempt can't blank
    // the tabs or trick the agent into "I couldn't find anything".
    if (this.runPipelineMemo) {
      console.warn(
        `[agent] run_pipeline called again this turn — returning cached result, skipping MongoDB (requested ${database}.${collection}, ${stageIds.length} stages)`,
      );
      return this.runPipelineMemo;
    }

    // Rewrite any `$vectorSearch` / `$search` stage the model emitted into the
    // equivalent `$match + $text` query. There's no embedding service or Atlas
    // Search node in this environment, so those stages either error or return
    // 0 docs — the #1 cause of "I'm having trouble finding…". Converting them
    // in place (1:1, so stage_ids stay aligned) makes the query actually run.
    const { pipeline: workingPipeline, converted } =
      rewriteVectorSearchToText(pipeline);
    if (converted) {
      console.warn(
        "[agent] run_pipeline: rewrote $vectorSearch/$search stage(s) into $match+$text",
      );
    }

    // `$text` only works on the `movies` collection (the only one with a text
    // index). The agent is told to switch the collection for vibes queries,
    // but it sometimes leaves it as `embedded_movies` (the canvas source) or
    // another collection, which has no text index → 0 docs. Correct it here.
    const usesTextSearch = converted || pipelineUsesTextSearch(workingPipeline);
    if (usesTextSearch && collection !== "movies") {
      console.warn(
        `[agent] run_pipeline: text query targeted ${collection} (no text index) — redirecting to movies`,
      );
      collection = "movies";
    }

    let perStageRows: Map<string, unknown[]>;
    let executionMode: "facet" | "sequential_fallback" = "facet";

    // `$text` cannot run inside a `$facet` sub-pipeline ("query requires text
    // score metadata, but it is not available"), so for text-search pipelines
    // skip the doomed $facet round-trip entirely and go straight to the
    // parallel per-stage aggregates. Saves a guaranteed-failing query.
    if (usesTextSearch) {
      executionMode = "sequential_fallback";
      perStageRows = await this.runSequentialPrefixAggregates(
        database,
        collection,
        workingPipeline,
        stageIds,
        previewLimit,
      );
    } else {
      const facetBranches: Record<string, unknown[]> = {};
      for (let i = 0; i < stageIds.length; i++) {
        const prefix = workingPipeline.slice(0, i);
        facetBranches[`s${i}`] = [...prefix, { $limit: previewLimit }];
      }

      const facetResult = await this.tryFacetPipeline(database, collection, [
        { $facet: facetBranches },
      ]);

      if (facetResult.ok) {
        perStageRows = new Map();
        for (let i = 0; i < stageIds.length; i++) {
          const branch = facetResult.facetDoc[`s${i}`];
          perStageRows.set(stageIds[i], Array.isArray(branch) ? branch : []);
        }
      } else {
        executionMode = "sequential_fallback";
        console.warn(
          `[agent] run_pipeline: $facet failed (${facetResult.errorMessage}); falling back to sequential prefix aggregates`,
        );
        perStageRows = await this.runSequentialPrefixAggregates(
          database,
          collection,
          workingPipeline,
          stageIds,
          previewLimit,
        );
      }
    }

    const previewed: Array<{ stageId: string; rows: number }> = [];
    for (const stageId of stageIds) {
      const rows = perStageRows.get(stageId) ?? [];
      this.opts.client.sendResults({ stageId, rows });
      previewed.push({ stageId, rows: rows.length });
    }
    console.log(
      `[agent] run_pipeline (${executionMode}) on ${database}.${collection}: ${previewed
        .map((p) => `${p.stageId}=${p.rows}`)
        .join(", ")}`,
    );

    const finalRows = perStageRows.get(stageIds[stageIds.length - 1]) ?? [];
    const SUMMARY_ROW_CAP = 5;
    const result = {
      previewed,
      execution_mode: executionMode,
      final_stage_id: stageIds[stageIds.length - 1],
      final_row_count: finalRows.length,
      final_rows_sample: finalRows.slice(0, SUMMARY_ROW_CAP),
    };
    // Memoize so any further run_pipeline call this turn short-circuits.
    this.runPipelineMemo = result;
    return result;
  }

  private async tryFacetPipeline(
    database: string,
    collection: string,
    facetPipeline: unknown[],
  ): Promise<
    | { ok: true; facetDoc: Record<string, unknown> }
    | { ok: false; errorMessage: string }
  > {
    if (!this.opts.mcp.isConnected()) {
      return { ok: false, errorMessage: "MongoDB MCP not connected" };
    }
    return await this.callMcpWithTrace<{
      ok: true;
      facetDoc: Record<string, unknown>;
    } | { ok: false; errorMessage: string }>(
      "aggregate",
      { database, collection, pipeline: facetPipeline },
      (cleaned) => {
        const docs = extractFirstFacetDoc(cleaned);
        if (!docs) {
          return { ok: false, errorMessage: "no doc returned from $facet" };
        }
        return { ok: true, facetDoc: docs };
      },
      (errorMessage) => ({ ok: false, errorMessage }),
    );
  }

  private async runSequentialPrefixAggregates(
    database: string,
    collection: string,
    pipeline: unknown[],
    stageIds: string[],
    previewLimit: number,
  ): Promise<Map<string, unknown[]>> {
    const out = new Map<string, unknown[]>();
    const promises = stageIds.map(async (stageId, i) => {
      const prefix = pipeline.slice(0, i);
      const prefixPipeline = [...prefix, { $limit: previewLimit }];
      const rows = await this.callMcpWithTrace<unknown[]>(
        "aggregate",
        { database, collection, pipeline: prefixPipeline },
        (cleaned) => extractDocsFromMcpAggregate(cleaned),
        () => [],
      );
      out.set(stageId, rows);
    });
    await Promise.all(promises);
    return out;
  }

  /**
   * Internal wrapper around `mcp.callTool`. Does NOT emit trace events —
   * the call happens inside `run_pipeline`'s server-side implementation,
   * which is itself the user-visible tool. Emitting a synthetic
   * `tool_call_start("aggregate")` here just made the trace timeline
   * noisier without adding information the user could act on.
   *
   * Server-side `console.log`s still record the call for debugging.
   *
   * `parseOk` runs against the stripped MCP response on success.
   * `parseFail` runs with an error message on failure (timeout, MCP
   * error, etc.). Both produce the function's typed return value.
   */
  private async callMcpWithTrace<T>(
    mcpToolName: string,
    args: Record<string, unknown>,
    parseOk: (cleaned: unknown) => T,
    parseFail: (errorMessage: string) => T,
  ): Promise<T> {
    const startedAt = Date.now();
    console.log(`[agent] (internal) → ${mcpToolName}`);

    let raw: unknown;
    try {
      raw = await this.opts.mcp.callTool(mcpToolName, args);
    } catch (err) {
      const message = String(err);
      console.warn(
        `[agent] (internal) ← ${mcpToolName} threw in ${Date.now() - startedAt}ms: ${message}`,
      );
      return parseFail(message);
    }

    const durationMs = Date.now() - startedAt;
    const cleaned = stripHeavyFieldsFromMcpResult(raw);
    const isErr = !!(cleaned as { isError?: boolean })?.isError;
    console.log(
      `[agent] (internal) ← ${mcpToolName} ${isErr ? "ERROR" : "ok"} in ${durationMs}ms`,
    );

    if (isErr) {
      const text = JSON.stringify(cleaned).slice(0, 200);
      return parseFail(`MCP isError: ${text}`);
    }
    return parseOk(cleaned);
  }

  /** Build the StdioConnectionParams ADK's MCPToolset needs to spawn a
   *  fresh `mongodb-mcp-server` for the agent's tool surface. Same args we
   *  pass from {@link MongoMcpClient} so the two stay in sync. */
  private buildStdioParams(connectionString: string): StdioConnectionParams {
    return {
      type: "StdioConnectionParams",
      serverParams: {
        command: "npx",
        args: ["-y", "mongodb-mcp-server@latest", "--readOnly"],
        env: {
          ...process.env,
          MDB_MCP_CONNECTION_STRING: connectionString,
        } as Record<string, string>,
      },
    };
  }

  private responseLooksLikeError(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    if (v.isError === true) return true;
    if (typeof v.error === "string" && v.error.length > 0) return true;
    return false;
  }

  /**
   * Start a fresh chat in-place: spin up a new ADK session (so Gemini has no
   * memory of the prior flow) and clear the canvas snapshot + per-turn state.
   * Keeps the runner, tools, and spawned MCP process so the next message is
   * answered immediately — no reconnect cost.
   */
  async reset(): Promise<void> {
    this.currentCanvas = null;
    this.runPipelineMemo = null;
    this.inFlight = false;
    this.toolStartStack.clear();
    this.sessionId = randomUUID();
    if (this.runner) {
      await this.runner.sessionService.createSession({
        appName: APP_NAME,
        userId: SESSION_USER_ID,
        sessionId: this.sessionId,
      });
    }
    console.log("[agent] chat reset — new session, canvas cleared");
  }

  /** Dispose the agent's MCP toolset. Called when the WS disconnects so we
   *  don't leak `mongodb-mcp-server` subprocesses. */
  async dispose(): Promise<void> {
    try {
      await this.mcpToolset?.close();
    } catch (err) {
      console.warn("[agent] dispose: MCPToolset close failed:", err);
    }
    this.mcpToolset = null;
    this.runner = null;
  }
}

/* ───────────────────── helpers ───────────────────── */

function isLikelyMcpToolName(name: string): boolean {
  return MCP_TOOLS_ALLOWLIST.includes(name);
}

/**
 * Does this aggregation pipeline use the `$text` operator anywhere? Such
 * pipelines can't run inside `$facet` (text-score metadata isn't available
 * there) and require the `movies` collection's text index. We detect it by a
 * deep scan for a `$text` key rather than only checking the first stage,
 * since the agent sometimes nests it under `$and`/`$or`.
 */
function pipelineUsesTextSearch(pipeline: unknown[]): boolean {
  const scan = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(scan);
    if (value && typeof value === "object") {
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        if (key === "$text") return true;
        if (scan(v)) return true;
      }
    }
    return false;
  };
  return scan(pipeline);
}

/**
 * Pull a human-readable search phrase out of a `$vectorSearch` / `$search`
 * stage spec. The model puts the text under various keys depending on which
 * operator it thinks it's using.
 */
function extractSearchText(spec: unknown): string | null {
  if (!spec || typeof spec !== "object") return null;
  const s = spec as Record<string, unknown>;
  // Common flat shapes: $vectorSearch with a text query the model invented.
  for (const key of ["queryText", "query", "queryString", "text", "search"]) {
    const v = s[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  // Atlas Search `$search: { text: { query, path } }`.
  const text = s.text;
  if (text && typeof text === "object") {
    const q = (text as Record<string, unknown>).query;
    if (typeof q === "string" && q.trim()) return q.trim();
  }
  return null;
}

/**
 * Rewrite any `$vectorSearch` / `$search` stage into an equivalent
 * `$match: { $text: { $search: "<phrase>" } }`. This environment has neither
 * an embedding service nor an Atlas Search node, so those stages can't run —
 * the demos are designed to execute via the `movies` text index instead. The
 * rewrite is 1:1 (one stage in → one stage out) so the caller's `stage_ids`
 * stay aligned with the pipeline. Stages that aren't search stages pass
 * through untouched.
 */
function rewriteVectorSearchToText(pipeline: unknown[]): {
  pipeline: unknown[];
  converted: boolean;
} {
  let converted = false;
  const out = pipeline.map((stage) => {
    if (!stage || typeof stage !== "object") return stage;
    const s = stage as Record<string, unknown>;
    const searchKey = "$vectorSearch" in s ? "$vectorSearch" : "$search" in s ? "$search" : null;
    if (!searchKey) return stage;
    converted = true;
    const phrase = extractSearchText(s[searchKey]);
    // If we can't recover a phrase, fall back to a pass-through match so the
    // pipeline still runs (returns rows) rather than erroring on the bad
    // stage. Better to show unfiltered results than an empty panel.
    return phrase
      ? { $match: { $text: { $search: phrase } } }
      : { $match: {} };
  });
  return { pipeline: out, converted };
}

function extractFirstFacetDoc(
  raw: unknown,
): Record<string, unknown> | null {
  const docs = extractDocsFromMcpAggregate(raw);
  if (docs.length === 0) return null;
  const first = docs[0];
  if (!first || typeof first !== "object") return null;
  return first as Record<string, unknown>;
}

/**
 * Remove any `suggest_next_prompts`-shaped JSON the model leaked into its
 * text reply. Matches `{ "label": "…", "prompt": "…" }` objects (with
 * optional whitespace, trailing commas, and outer `[…]` brackets) and
 * deletes them, then collapses the leftover whitespace so the remaining
 * one-liner reply reads cleanly. Safe on inputs that don't contain the
 * pattern — they pass through unchanged.
 */
export function stripSuggestionLeakage(text: string): string {
  const suggestionObject =
    /\{\s*"label"\s*:\s*"[^"]*"\s*,\s*"prompt"\s*:\s*"[^"]*"\s*\}\s*,?/g;
  let cleaned = text.replace(suggestionObject, "");
  // Mop up any orphan brackets/commas left behind when we excised the
  // objects from inside an array literal, and squash the run of blank
  // lines that often surrounds the leaked block.
  cleaned = cleaned
    .replace(/\[\s*\]/g, "")
    .replace(/,\s*(?=[\]\n])/g, "")
    .replace(/^\s*[\[\],]+\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned;
}
