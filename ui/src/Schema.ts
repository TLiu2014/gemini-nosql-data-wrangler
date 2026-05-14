import type { Edge, Node } from "@xyflow/react";
import type {
  StageConfig,
  StageNodeData,
  StageType,
} from "@/types/Pipeline";

/**
 * Pipeline schema designed for data engineers.
 *
 *   `pipeline`  — top-level metadata
 *   `datasets`  — input data schemas (column names + inferred types)
 *   `stages`    — ordered DAG of transformations: each stage declares its
 *                 inputs, output table, dependencies, and operation params
 *   `layout`    — secondary, UI-only: node positions + edges to round-trip
 *                 the canvas. Safe to drop if you only care about the data.
 */
export interface PipelineSchema {
  version: "1.0";
  pipeline: {
    name: string;
    createdAt: string;
    description?: string;
  };
  datasets: Record<string, DatasetSchema>;
  stages: SerializedStage[];
  layout: PipelineLayout;
}

export interface DatasetSchema {
  columns: Array<{ name: string; type: ColumnType }>;
}

export type ColumnType =
  | "integer"
  | "float"
  | "string"
  | "boolean"
  | "date"
  | "timestamp"
  | "unknown";

export interface SerializedStage {
  id: string;
  name: string;
  type: StageType;
  depends_on: string[];
  inputs: string[];
  output: string;
  operation: StageConfig;
}

export interface PipelineLayout {
  nodes: Array<{ id: string; position: { x: number; y: number } }>;
  edges: Array<{ id: string; source: string; target: string }>;
}

export interface SerializeOptions {
  name: string;
  description?: string;
}

/**
 * Serialize a React Flow graph into the data-engineer-readable PipelineSchema.
 * `inputs` for each stage are derived from `operation` (FILTER.table, JOIN.left/rightTable,
 * etc.) so the JSON makes sense without inspecting the canvas.
 */
export function serializePipeline(
  nodes: Node<StageNodeData>[],
  edges: Edge[],
  options: SerializeOptions,
): PipelineSchema {
  const stages = orderNodesTopologically(nodes, edges).map((node) =>
    toSerializedStage(node, edges),
  );

  return {
    version: "1.0",
    pipeline: {
      name: options.name,
      createdAt: new Date().toISOString(),
      ...(options.description ? { description: options.description } : {}),
    },
    datasets: collectDatasets(stages),
    stages,
    layout: {
      nodes: nodes.map((n) => ({ id: n.id, position: n.position })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
      })),
    },
  };
}

function toSerializedStage(
  node: Node<StageNodeData>,
  edges: Edge[],
): SerializedStage {
  const dependsOn = edges
    .filter((e) => e.target === node.id)
    .map((e) => e.source);

  const inputs = collectStageInputs(node.data.config);
  const fallbackOutput = `${node.data.stageType.toLowerCase()}_${node.data.stageIndex}`;

  return {
    id: node.id,
    name: slugify(node.data.label) || fallbackOutput,
    type: node.data.stageType,
    depends_on: dependsOn,
    inputs,
    output: node.data.outputTableName ?? fallbackOutput,
    operation: node.data.config,
  };
}

function collectStageInputs(config: StageConfig): string[] {
  switch (config.stageType) {
    case "LOAD":
      return [];
    case "FILTER":
    case "GROUP":
    case "SORT":
    case "SELECT":
      return config.table ? [config.table] : [];
    case "JOIN":
      return [config.leftTable, config.rightTable].filter(Boolean) as string[];
    case "UNION":
      return [...config.tables];
    case "CUSTOM":
      return [];
    case "MQL_SOURCE":
      return config.collection ? [`${config.database}.${config.collection}`] : [];
    case "MQL_MATCH":
    case "MQL_VECTOR_SEARCH":
    case "MQL_PROJECT":
    case "MQL_SORT":
    case "MQL_LIMIT":
    case "MQL_GROUP":
    case "MQL_LOOKUP":
    case "MQL_UNWIND":
      // Upstream comes from depends_on (edges), not config.
      return [];
  }
}

function collectDatasets(
  stages: SerializedStage[],
): Record<string, DatasetSchema> {
  const datasets: Record<string, DatasetSchema> = {};
  for (const stage of stages) {
    if (stage.type !== "LOAD") continue;
    const op = stage.operation;
    if (op.stageType !== "LOAD") continue;
    const tableName = op.tableName || stage.output;
    datasets[tableName] = { columns: [] };
  }
  return datasets;
}

function orderNodesTopologically(
  nodes: Node<StageNodeData>[],
  edges: Edge[],
): Node<StageNodeData>[] {
  const indegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const edge of edges) {
    if (!indegree.has(edge.source) || !indegree.has(edge.target)) continue;
    adj.get(edge.source)!.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of indegree) if (deg === 0) queue.push(id);
  queue.sort((a, b) => indexOrZero(nodes, a) - indexOrZero(nodes, b));

  const ordered: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    ordered.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }

  // Cycle fallback: append any remaining nodes in original order.
  if (ordered.length < nodes.length) {
    const seen = new Set(ordered);
    for (const n of nodes) if (!seen.has(n.id)) ordered.push(n.id);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  return ordered.map((id) => byId.get(id)!).filter(Boolean);
}

function indexOrZero(nodes: Node<StageNodeData>[], id: string): number {
  return nodes.findIndex((n) => n.id === id);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export interface DeserializedPipeline {
  name: string;
  nodes: Node<StageNodeData>[];
  edges: Edge[];
}

/** Inverse of serializePipeline (best-effort; `layout` carries positions). */
export function deserializePipeline(schema: PipelineSchema): DeserializedPipeline {
  const positions = new Map(
    schema.layout.nodes.map((n) => [n.id, n.position]),
  );
  const nodes: Node<StageNodeData>[] = schema.stages.map((stage, i) => ({
    id: stage.id,
    type: "stageNode",
    position: positions.get(stage.id) ?? { x: 80, y: 80 + i * 140 },
    data: {
      stageType: stage.type,
      label: stage.name,
      stageIndex: i + 1,
      outputTableName: stage.output,
      config: stage.operation,
    },
  }));

  return {
    name: schema.pipeline.name,
    nodes,
    edges: schema.layout.edges.map((e) => ({ ...e })),
  };
}

/**
 * Lightweight runtime check that a parsed object looks like a PipelineSchema.
 * Returns null when valid, or a short error message otherwise. Useful for
 * validating user-pasted JSON before calling deserializePipeline.
 */
export function validatePipelineSchema(value: unknown): string | null {
  if (!value || typeof value !== "object") return "Expected an object";
  const v = value as Record<string, unknown>;
  if (v.version !== "1.0") return `Unsupported version: ${String(v.version)}`;
  if (!v.pipeline || typeof v.pipeline !== "object")
    return "Missing or invalid `pipeline`";
  if (!Array.isArray(v.stages)) return "Missing or invalid `stages` array";
  if (!v.layout || typeof v.layout !== "object") return "Missing `layout`";
  const layout = v.layout as Record<string, unknown>;
  if (!Array.isArray(layout.nodes) || !Array.isArray(layout.edges))
    return "`layout.nodes` and `layout.edges` must be arrays";
  return null;
}

/* ------------------------------------------------------------------------- *
 * Output schema inference
 *
 * The UI module never executes data, so we can only *infer* output columns
 * from the operation parameters. inferOutputSchemas walks stages in order and
 * threads each input's columns through the operation to produce a best-effort
 * output schema. Useful for a "Data Schema" panel without a real engine.
 * ------------------------------------------------------------------------- */

export interface InferredColumn {
  name: string;
  type: ColumnType;
  /** Origin: "{datasetOrTable}.{column}" when traceable, else stage.output. */
  source?: string;
}

export interface StageOutputSchema {
  stageId: string;
  output: string;
  columns: InferredColumn[];
  /** false for LOAD (taken directly from datasets), true for derived stages. */
  inferred: boolean;
  /** Set when inference couldn't determine columns (e.g. CUSTOM, missing input). */
  unknown?: boolean;
}

/** Map keyed by stage.id. Iteration order matches schema.stages order. */
export type InferredSchemaMap = Map<string, StageOutputSchema>;

export function inferOutputSchemas(schema: PipelineSchema): InferredSchemaMap {
  const result: InferredSchemaMap = new Map();
  for (const stage of schema.stages) {
    result.set(stage.id, computeStageOutput(stage, schema, result));
  }
  return result;
}

function computeStageOutput(
  stage: SerializedStage,
  schema: PipelineSchema,
  prior: InferredSchemaMap,
): StageOutputSchema {
  const op = stage.operation;
  switch (op.stageType) {
    case "LOAD": {
      const tableName = op.tableName || stage.output;
      const dataset = schema.datasets[tableName];
      return {
        stageId: stage.id,
        output: stage.output,
        columns: (dataset?.columns ?? []).map((c) => ({
          ...c,
          source: `${tableName}.${c.name}`,
        })),
        inferred: false,
      };
    }
    case "FILTER":
    case "SORT": {
      const cols = lookupColumnsByTableName(op.table, schema, prior);
      return {
        stageId: stage.id,
        output: stage.output,
        columns: cols,
        inferred: true,
      };
    }
    case "SELECT": {
      const cols = lookupColumnsByTableName(op.table, schema, prior);
      const keep = new Set(op.columns);
      const projected = cols.filter((c) => keep.has(c.name));
      const missing = op.columns
        .filter((name) => !cols.some((c) => c.name === name))
        .map<InferredColumn>((name) => ({ name, type: "unknown" }));
      return {
        stageId: stage.id,
        output: stage.output,
        columns: [...projected, ...missing],
        inferred: true,
      };
    }
    case "JOIN": {
      const left = lookupColumnsByTableName(op.leftTable, schema, prior);
      const right = lookupColumnsByTableName(op.rightTable, schema, prior);
      // Drop the right-side join key to mimic typical SQL projections.
      const rightProjected = right.filter((c) => c.name !== op.rightKey);
      // Disambiguate name collisions with an underscore suffix.
      const leftNames = new Set(left.map((c) => c.name));
      const merged = [
        ...left,
        ...rightProjected.map((c) =>
          leftNames.has(c.name) ? { ...c, name: `${c.name}_right` } : c,
        ),
      ];
      return {
        stageId: stage.id,
        output: stage.output,
        columns: merged,
        inferred: true,
      };
    }
    case "UNION": {
      const first = op.tables[0]
        ? lookupColumnsByTableName(op.tables[0], schema, prior)
        : [];
      return {
        stageId: stage.id,
        output: stage.output,
        columns: first,
        inferred: true,
      };
    }
    case "GROUP": {
      const cols = lookupColumnsByTableName(op.table, schema, prior);
      const grouped = op.groupBy.map<InferredColumn>(
        (name) =>
          cols.find((c) => c.name === name) ?? { name, type: "unknown" },
      );
      const aggregated = op.aggregations.map<InferredColumn>((a) => ({
        name: a.alias || `${a.fn.toLowerCase()}_${a.column}`,
        type: aggregateOutputType(a.fn),
      }));
      return {
        stageId: stage.id,
        output: stage.output,
        columns: [...grouped, ...aggregated],
        inferred: true,
      };
    }
    case "CUSTOM":
      return {
        stageId: stage.id,
        output: stage.output,
        columns: [],
        inferred: true,
        unknown: true,
      };
    case "MQL_SOURCE":
    case "MQL_MATCH":
    case "MQL_VECTOR_SEARCH":
    case "MQL_PROJECT":
    case "MQL_SORT":
    case "MQL_LIMIT":
    case "MQL_GROUP":
    case "MQL_LOOKUP":
    case "MQL_UNWIND":
      // MongoDB stages — we don't infer schemas without executing.
      return {
        stageId: stage.id,
        output: stage.output,
        columns: [],
        inferred: true,
        unknown: true,
      };
  }
}

function lookupColumnsByTableName(
  tableName: string,
  schema: PipelineSchema,
  prior: InferredSchemaMap,
): InferredColumn[] {
  if (!tableName) return [];
  // Prefer a prior stage's output (most recent wins for same name).
  let fromStage: InferredColumn[] | null = null;
  for (const inf of prior.values()) {
    if (inf.output === tableName) fromStage = inf.columns;
  }
  if (fromStage) return fromStage;

  const dataset = schema.datasets[tableName];
  if (dataset) {
    return dataset.columns.map((c) => ({
      ...c,
      source: `${tableName}.${c.name}`,
    }));
  }
  return [];
}

function aggregateOutputType(fn: string): ColumnType {
  switch (fn) {
    case "COUNT":
      return "integer";
    case "SUM":
    case "AVG":
    case "MIN":
    case "MAX":
      return "float";
    default:
      return "unknown";
  }
}
