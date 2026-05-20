import { Type, type FunctionDeclaration } from "@google/genai";

/**
 * Tools the agent can call to drive the UI directly. These are NOT routed to
 * the MongoDB MCP server — `geminiStream.ts` dispatches them locally to
 * `clientSocket` so the browser sees instant canvas/result updates.
 *
 * Anything Gemini calls that isn't one of these names should fall through to
 * the MCP client (list-databases, aggregate, find, etc.).
 */
export const CUSTOM_TOOL_NAMES = {
  update_canvas: "update_canvas",
  push_results: "push_results",
  run_pipeline: "run_pipeline",
} as const;

export type CustomToolName =
  (typeof CUSTOM_TOOL_NAMES)[keyof typeof CUSTOM_TOOL_NAMES];

export function isCustomToolName(name: string): name is CustomToolName {
  return (
    name === CUSTOM_TOOL_NAMES.update_canvas ||
    name === CUSTOM_TOOL_NAMES.push_results ||
    name === CUSTOM_TOOL_NAMES.run_pipeline
  );
}

export function getCustomToolDeclarations(): FunctionDeclaration[] {
  return [
    {
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
            // We intentionally leave the inner shape loose — Gemini gets the
            // structure from the system instruction's CURRENT CANVAS block.
          },
        },
        required: ["schema"],
      },
    },
    {
      name: CUSTOM_TOOL_NAMES.push_results,
      description:
        "Show the rows returned by a MongoDB aggregation in the bottom Results panel of the UI. Call this immediately after a successful `aggregate` tool call.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          stageId: {
            type: Type.STRING,
            description:
              "The id of the pipeline stage these rows correspond to. Must match a stage.id from the most recent update_canvas call (e.g. \"stage_3\").",
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
    },
    {
      name: CUSTOM_TOOL_NAMES.run_pipeline,
      description:
        "Execute the canvas pipeline against MongoDB and populate EVERY stage's results tab with a preview, in a single round-trip. Internally uses a $facet aggregation so the pipeline still sees the full collection (no early $limit); only the per-stage display is capped at `preview_limit` rows. Use this in place of `aggregate` + `push_results` whenever you've just updated the canvas — the user expects each stage tab to show data, and this tool fills them all.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          database: {
            type: Type.STRING,
            description: "Database name (e.g. \"sample_mflix\").",
          },
          collection: {
            type: Type.STRING,
            description: "Source collection name (e.g. \"movies\"). The pipeline is applied to this collection.",
          },
          pipeline: {
            type: Type.ARRAY,
            items: { type: Type.OBJECT },
            description:
              "MongoDB aggregation stages applied AFTER the source. Does NOT include any source/$source step (Mongo doesn't have one). E.g. for canvas [Source → $match → $group], pass [{ $match: ... }, { $group: ... }].",
          },
          stage_ids: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              "Canvas stage ids, in order. MUST have length = pipeline.length + 1. Index 0 is the SOURCE stage (gets the raw collection top-K). Index i (i >= 1) is the stage AFTER applying pipeline[i-1]. The final entry gets the unbounded final result of the full pipeline.",
          },
          preview_limit: {
            type: Type.NUMBER,
            description:
              "How many rows to show per stage tab in the UI (display only — the pipeline itself sees all records). Defaults to 20. Use a small value (10-50) so the UI stays snappy.",
          },
        },
        required: ["database", "collection", "pipeline", "stage_ids"],
      },
    },
  ];
}
