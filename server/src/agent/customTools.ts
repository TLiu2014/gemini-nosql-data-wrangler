import { FunctionTool } from "@google/adk";
import { Type, type Schema } from "@google/genai";
import type { ClientSocket } from "../websocket/clientSocket.js";

/**
 * Tools the agent can call to drive the UI or coordinate per-stage MongoDB
 * previews. These are NOT routed to the MongoDB MCP server — they execute
 * locally inside the Node process and dispatch directly to the WebSocket
 * client (`update_canvas`, `push_results`, `suggest_next_prompts`) or call
 * back into the MCP server with a $facet wrapper (`run_pipeline`).
 *
 * In the pre-ADK build these were `FunctionDeclaration[]` paired with a
 * hand-rolled switch inside the ReAct loop. With ADK we hand them to the
 * `LlmAgent` as `FunctionTool` instances; ADK validates args, dispatches,
 * and pipes the return value back to the model.
 */

export const CUSTOM_TOOL_NAMES = {
  update_canvas: "update_canvas",
  push_results: "push_results",
  run_pipeline: "run_pipeline",
  suggest_next_prompts: "suggest_next_prompts",
} as const;

export type CustomToolName =
  (typeof CUSTOM_TOOL_NAMES)[keyof typeof CUSTOM_TOOL_NAMES];

/**
 * Dependencies injected into the custom tool factories. The agent loop owns
 * these: the WebSocket client (for emitting canvas/results/trace events), a
 * setter for the current canvas snapshot (read by the system-instruction
 * builder), and a `runPipelineFacet` callback that wraps MCP `aggregate` in
 * the `$facet` machinery so every stage tab gets populated in one call.
 */
export interface CustomToolDeps {
  client: ClientSocket;
  setCurrentCanvas: (schema: unknown) => void;
  /**
   * Execute the canvas pipeline via $facet against MongoDB and dispatch
   * per-stage `push_results` events. Implemented in agentLoop.ts so the MCP
   * client lifecycle stays there.
   */
  runPipelineFacet: (args: {
    database: string;
    collection: string;
    pipeline: unknown[];
    stageIds: string[];
    previewLimit: number;
  }) => Promise<{
    previewed: Array<{ stageId: string; rows: number }>;
    final_stage_id: string;
    final_row_count: number;
    final_rows_sample: unknown[];
    execution_mode: "facet" | "sequential_fallback";
  }>;
}

/**
 * Build the four custom tools as ADK `FunctionTool` instances. Each one's
 * `execute` callback closes over the deps so the agent loop doesn't need to
 * thread state through the call chain.
 */
export function buildCustomTools(deps: CustomToolDeps): FunctionTool<Schema>[] {
  const tools: FunctionTool<Schema>[] = [];

  tools.push(
    new FunctionTool<Schema>({
      name: CUSTOM_TOOL_NAMES.update_canvas,
      description:
        "Replace the pipeline shown on the user's read-only React Flow canvas with the supplied PipelineSchema. Always pass the FULL current pipeline (don't send deltas). The schema field shape is the same JSON the UI's Pipeline JSON tab renders.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          schema: {
            type: Type.OBJECT,
            description:
              "A complete PipelineSchema: { version, pipeline, datasets, stages, layout }. The `stages` array carries MongoDB aggregation stages (MQL_SOURCE, MQL_MATCH, MQL_VECTOR_SEARCH, MQL_PROJECT, MQL_SORT, MQL_LIMIT, MQL_GROUP, MQL_LOOKUP, MQL_UNWIND). The `layout` field carries node positions/edges so the canvas renders deterministically.",
          },
        },
        required: ["schema"],
      },
      execute: async (input: unknown) => {
        const args = (input ?? {}) as { schema?: unknown };
        const schema = args.schema;
        if (!schema || typeof schema !== "object") {
          return { error: "update_canvas requires a `schema` object" };
        }
        deps.client.sendCanvasUpdate(schema);
        deps.setCurrentCanvas(schema);
        return { ok: true };
      },
    }),
  );

  tools.push(
    new FunctionTool<Schema>({
      name: CUSTOM_TOOL_NAMES.push_results,
      description:
        "Show the rows returned by a MongoDB aggregation in the bottom Results panel of the UI. Call this immediately after a successful `aggregate` tool call.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          stageId: {
            type: Type.STRING,
            description:
              'The id of the pipeline stage these rows correspond to. Must match a stage.id from the most recent update_canvas call (e.g. "stage_3").',
          },
          label: {
            type: Type.STRING,
            description:
              "Optional tab label for the results panel. Defaults to the stage id.",
          },
          rows: {
            type: Type.ARRAY,
            items: { type: Type.OBJECT },
            description: "Rows returned by MongoDB. Pass them through as-is.",
          },
        },
        required: ["stageId", "rows"],
      },
      execute: async (input: unknown) => {
        const args = (input ?? {}) as {
          stageId?: unknown;
          rows?: unknown;
          label?: unknown;
        };
        const stageId =
          typeof args.stageId === "string" ? args.stageId : null;
        const rows = Array.isArray(args.rows) ? args.rows : null;
        if (!stageId || !rows) {
          return {
            error:
              "push_results requires `stageId` (string) and `rows` (array)",
          };
        }
        deps.client.sendResults({
          stageId,
          label: typeof args.label === "string" ? args.label : undefined,
          rows,
        });
        return { ok: true, count: rows.length };
      },
    }),
  );

  tools.push(
    new FunctionTool<Schema>({
      name: CUSTOM_TOOL_NAMES.run_pipeline,
      description:
        "Execute the canvas pipeline against MongoDB and populate EVERY stage's results tab with a preview, in a single round-trip. Internally uses a $facet aggregation so the pipeline still sees the full collection (no early $limit); only the per-stage display is capped at `preview_limit` rows. Use this in place of `aggregate` + `push_results` whenever you've just updated the canvas — the user expects each stage tab to show data, and this tool fills them all.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          database: {
            type: Type.STRING,
            description: 'Database name (e.g. "sample_mflix").',
          },
          collection: {
            type: Type.STRING,
            description:
              'Source collection name (e.g. "movies"). The pipeline is applied to this collection.',
          },
          pipeline: {
            type: Type.ARRAY,
            items: { type: Type.OBJECT },
            description:
              "MongoDB aggregation stages applied AFTER the source. Does NOT include any source/$source step. E.g. for canvas [Source → $match → $group], pass [{ $match: ... }, { $group: ... }].",
          },
          stage_ids: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              "Canvas stage ids, in order. MUST have length = pipeline.length + 1. Index 0 is the SOURCE stage; index i (i >= 1) is the stage AFTER applying pipeline[i-1].",
          },
          preview_limit: {
            type: Type.NUMBER,
            description:
              "How many rows to show per stage tab in the UI (display only — the pipeline itself sees all records). Defaults to 20.",
          },
        },
        required: ["database", "collection", "pipeline", "stage_ids"],
      },
      execute: async (input: unknown) => {
        const args = (input ?? {}) as {
          database?: unknown;
          collection?: unknown;
          pipeline?: unknown;
          stage_ids?: unknown;
          preview_limit?: unknown;
        };
        const database =
          typeof args.database === "string" ? args.database : null;
        const collection =
          typeof args.collection === "string" ? args.collection : null;
        const pipeline = Array.isArray(args.pipeline) ? args.pipeline : null;
        const stageIds = Array.isArray(args.stage_ids)
          ? (args.stage_ids.filter((s) => typeof s === "string") as string[])
          : null;
        const previewLimit =
          typeof args.preview_limit === "number" && args.preview_limit > 0
            ? Math.floor(args.preview_limit)
            : 20;

        if (!database || !collection || !pipeline || !stageIds) {
          return {
            error:
              "run_pipeline requires database (string), collection (string), pipeline (array), stage_ids (array of strings).",
          };
        }
        if (stageIds.length !== pipeline.length + 1) {
          return {
            error: `stage_ids.length (${stageIds.length}) must equal pipeline.length + 1 (${pipeline.length + 1}). Index 0 is the source stage; index i (i >= 1) is the stage after applying pipeline[i-1].`,
          };
        }

        try {
          const result = await deps.runPipelineFacet({
            database,
            collection,
            pipeline,
            stageIds,
            previewLimit,
          });
          return { ok: true, ...result };
        } catch (err) {
          return { error: String(err) };
        }
      },
    }),
  );

  tools.push(
    new FunctionTool<Schema>({
      name: CUSTOM_TOOL_NAMES.suggest_next_prompts,
      description:
        "Suggest 2–3 short follow-up requests the user might want to make next, given the current canvas state. The UI renders these as clickable chips below the most recent agent message; clicking one fills the user's input box (it does NOT auto-send, so the user can edit before submitting). Call this once near the end of every turn, AFTER run_pipeline has populated results.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          prompts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                label: {
                  type: Type.STRING,
                  description:
                    'Very short chip label (1-4 words) describing the suggested action, e.g. "Group by year" or "Add lookup".',
                },
                prompt: {
                  type: Type.STRING,
                  description:
                    'The actual full sentence that would be sent as the user\'s next message if they click the chip, e.g. "Group these by year and calculate average IMDB rating."',
                },
              },
              required: ["label", "prompt"],
            },
            description:
              "Ordered list of 2-3 suggested follow-ups. Tailor them to what the user would naturally want to do next from the current canvas — extending the pipeline (group, sort, project), branching, filtering further, or comparing/aggregating differently. Keep prompts grounded in fields the canvas already references.",
          },
        },
        required: ["prompts"],
      },
      execute: async (input: unknown) => {
        const args = (input ?? {}) as { prompts?: unknown };
        const rawPrompts = Array.isArray(args.prompts) ? args.prompts : null;
        if (!rawPrompts) {
          return { error: "suggest_next_prompts requires a `prompts` array" };
        }
        const prompts: Array<{ label: string; prompt: string }> = [];
        for (const p of rawPrompts) {
          if (!p || typeof p !== "object") continue;
          const obj = p as Record<string, unknown>;
          const label =
            typeof obj.label === "string" ? obj.label.trim() : "";
          const prompt =
            typeof obj.prompt === "string" ? obj.prompt.trim() : "";
          if (!label || !prompt) continue;
          prompts.push({ label, prompt });
          if (prompts.length >= 3) break;
        }
        deps.client.sendTrace({ kind: "suggested_prompts", prompts });
        return { ok: true, count: prompts.length };
      },
    }),
  );

  return tools;
}
