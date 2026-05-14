import type { PipelineSchema } from "@/Schema";

/**
 * A canned pipeline that demonstrates the signature feature of the demo:
 * a MongoDB `$vectorSearch` against `sample_mflix.embedded_movies`. Loaded
 * onto the read-only canvas at startup when the "Sample Flow" toggle is on,
 * so the user has something visual to see before they talk to the agent.
 *
 * The agent is free to mutate or replace this flow via the `update_canvas`
 * tool — it's intentionally a starting point, not a fixed pipeline.
 */
export const SAMPLE_MFLIX_VECTOR_FLOW: PipelineSchema = {
  version: "1.0",
  pipeline: {
    name: "mflix_vector_search",
    createdAt: "2026-05-12T00:00:00.000Z",
    description:
      "Sample MongoDB Aggregation Pipeline — semantic search over sample_mflix.embedded_movies",
  },
  datasets: {},
  stages: [
    {
      id: "stage_1",
      name: "source",
      type: "MQL_SOURCE",
      depends_on: [],
      inputs: ["sample_mflix.embedded_movies"],
      output: "embedded_movies",
      operation: {
        stageType: "MQL_SOURCE",
        database: "sample_mflix",
        collection: "embedded_movies",
      },
    },
    {
      id: "stage_2",
      name: "vector_search",
      type: "MQL_VECTOR_SEARCH",
      depends_on: ["stage_1"],
      inputs: [],
      output: "matched_movies",
      operation: {
        stageType: "MQL_VECTOR_SEARCH",
        body: {
          index: "plot_vector_index",
          path: "plot_embedding",
          queryVector: "<computed from natural-language query>",
          numCandidates: 100,
          limit: 10,
        },
      },
    },
    {
      id: "stage_3",
      name: "project",
      type: "MQL_PROJECT",
      depends_on: ["stage_2"],
      inputs: [],
      output: "results",
      operation: {
        stageType: "MQL_PROJECT",
        body: {
          title: 1,
          year: 1,
          genres: 1,
          plot: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    },
  ],
  layout: {
    nodes: [
      { id: "stage_1", position: { x: 80, y: 80 } },
      { id: "stage_2", position: { x: 80, y: 240 } },
      { id: "stage_3", position: { x: 80, y: 400 } },
    ],
    edges: [
      { id: "e1-2", source: "stage_1", target: "stage_2" },
      { id: "e2-3", source: "stage_2", target: "stage_3" },
    ],
  },
};
