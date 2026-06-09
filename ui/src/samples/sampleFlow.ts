import type { PipelineSchema } from "@/Schema";

/**
 * Demo starting flow — two MQL_SOURCE stages (movies + comments) sitting side
 * by side. The rest of the pipeline (lookup, filter, group) is added by the
 * agent as the presenter talks to Gemini, so the audience watches the canvas
 * grow live.
 *
 * Equivalent in spirit to the SQL-demo flow used by sibling projects
 * (load 2 tables → join → filter → group), but with NoSQL semantics:
 *   $lookup (join), $match (filter), $group (aggregate).
 */
export const SAMPLE_MFLIX_DEMO_FLOW: PipelineSchema = {
  version: "1.0",
  pipeline: {
    name: "mflix_demo",
    createdAt: "2026-05-14T00:00:00.000Z",
    description:
      "Demo starting flow — sample_mflix.embedded_movies + sample_mflix.comments. Build the rest by talking to Gemini.",
  },
  datasets: {},
  stages: [
    {
      id: "stage_1",
      name: "movies_source",
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
      name: "comments_source",
      type: "MQL_SOURCE",
      depends_on: [],
      inputs: ["sample_mflix.comments"],
      output: "comments",
      operation: {
        stageType: "MQL_SOURCE",
        database: "sample_mflix",
        collection: "comments",
      },
    },
  ],
  layout: {
    nodes: [
      { id: "stage_1", position: { x: 80, y: 80 } },
      { id: "stage_2", position: { x: 380, y: 80 } },
    ],
    edges: [],
  },
};

/**
 * Pre-built director-filmography pipeline. Three stages: source → match
 * on directors → project the readable fields. The user can extend this
 * live by asking the agent to "now group by year and calculate average
 * IMDB rating".
 *
 * This sample executes against the real `sample_mflix.movies` collection
 * (text index on cast/fullplot/genres/title; `$match` on the directors
 * array works because Mongo matches array elements implicitly). No vector
 * index or external embedding service required.
 */
export const SAMPLE_MFLIX_VECTOR_FLOW: PipelineSchema = {
  version: "1.0",
  pipeline: {
    name: "nolan_filmography",
    createdAt: "2026-05-21T00:00:00.000Z",
    description:
      "Sample pipeline — Christopher Nolan filmography from sample_mflix.movies. Ask the agent to group / sort / aggregate from here.",
  },
  datasets: {},
  stages: [
    {
      id: "stage_1",
      name: "source",
      type: "MQL_SOURCE",
      depends_on: [],
      inputs: ["sample_mflix.movies"],
      output: "movies",
      operation: {
        stageType: "MQL_SOURCE",
        database: "sample_mflix",
        collection: "movies",
      },
    },
    {
      id: "stage_2",
      name: "match_director",
      type: "MQL_MATCH",
      depends_on: ["stage_1"],
      inputs: [],
      output: "nolan_movies",
      operation: {
        stageType: "MQL_MATCH",
        body: { directors: "Christopher Nolan" },
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
          "imdb.rating": 1,
          "awards.wins": 1,
        },
      },
    },
  ],
  layout: {
    nodes: [
      { id: "stage_1", position: { x: 80, y: 60 } },
      { id: "stage_2", position: { x: 80, y: 220 } },
      { id: "stage_3", position: { x: 80, y: 380 } },
    ],
    edges: [
      { id: "e1-2", source: "stage_1", target: "stage_2" },
      { id: "e2-3", source: "stage_2", target: "stage_3" },
    ],
  },
};
