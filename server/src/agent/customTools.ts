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
} as const;

export type CustomToolName =
  (typeof CUSTOM_TOOL_NAMES)[keyof typeof CUSTOM_TOOL_NAMES];

export function isCustomToolName(name: string): name is CustomToolName {
  return name === CUSTOM_TOOL_NAMES.update_canvas || name === CUSTOM_TOOL_NAMES.push_results;
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
  ];
}
