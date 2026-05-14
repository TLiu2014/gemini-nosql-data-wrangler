export type StageType =
  // Legacy SQL-flavored types (kept for back-compat with transform-flow-ui's
  // serialization and inference — never emitted by our Mongo agent).
  | "LOAD"
  | "FILTER"
  | "JOIN"
  | "UNION"
  | "GROUP"
  | "SORT"
  | "SELECT"
  | "CUSTOM"
  // MongoDB Aggregation Pipeline stages — what the Gemini agent actually emits.
  | "MQL_SOURCE"
  | "MQL_MATCH"
  | "MQL_VECTOR_SEARCH"
  | "MQL_PROJECT"
  | "MQL_SORT"
  | "MQL_LIMIT"
  | "MQL_GROUP"
  | "MQL_LOOKUP"
  | "MQL_UNWIND";

export type FilterOperator = "=" | "!=" | ">" | "<" | ">=" | "<=" | "LIKE" | "IN";
export type JoinType = "INNER" | "LEFT" | "RIGHT" | "FULL OUTER";
export type SortDirection = "ASC" | "DESC";
export type AggregateFn = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";

export interface LoadConfig {
  stageType: "LOAD";
  tableName: string;
  source?: string;
}

export interface FilterConfig {
  stageType: "FILTER";
  table: string;
  column: string;
  operator: FilterOperator;
  value: string;
}

export interface JoinConfig {
  stageType: "JOIN";
  joinType: JoinType;
  leftTable: string;
  rightTable: string;
  leftKey: string;
  rightKey: string;
}

export interface UnionConfig {
  stageType: "UNION";
  tables: string[];
  unionAll: boolean;
}

export interface GroupAggregation {
  fn: AggregateFn;
  column: string;
  alias: string;
}

export interface GroupConfig {
  stageType: "GROUP";
  table: string;
  groupBy: string[];
  aggregations: GroupAggregation[];
}

export interface SortOrder {
  column: string;
  direction: SortDirection;
}

export interface SortConfig {
  stageType: "SORT";
  table: string;
  orderBy: SortOrder[];
}

export interface SelectConfig {
  stageType: "SELECT";
  table: string;
  columns: string[];
}

export interface CustomConfig {
  stageType: "CUSTOM";
  sql: string;
}

/**
 * MongoDB source stage — picks a `database.collection` to feed the pipeline.
 * Renders as the first node in the canvas; subsequent stages operate on its output.
 */
export interface MqlSourceConfig {
  stageType: "MQL_SOURCE";
  database: string;
  collection: string;
}

/**
 * Generic MongoDB aggregation stage. `body` is the raw stage payload (e.g.
 * `{ year: { $lt: 1980 } }` for `$match`). The canvas renders the stage but
 * does not introspect the body — execution is the backend's job.
 */
export interface MqlStageConfig {
  stageType:
    | "MQL_MATCH"
    | "MQL_VECTOR_SEARCH"
    | "MQL_PROJECT"
    | "MQL_SORT"
    | "MQL_LIMIT"
    | "MQL_GROUP"
    | "MQL_LOOKUP"
    | "MQL_UNWIND";
  body: Record<string, unknown>;
}

export type StageConfig =
  | LoadConfig
  | FilterConfig
  | JoinConfig
  | UnionConfig
  | GroupConfig
  | SortConfig
  | SelectConfig
  | CustomConfig
  | MqlSourceConfig
  | MqlStageConfig;

export type ExecutionState = "pending" | "running" | "success" | "error";

export interface StageNodeData {
  stageType: StageType;
  label: string;
  stageIndex: number;
  outputTableName?: string;
  executionState?: ExecutionState;
  config: StageConfig;
  [key: string]: unknown;
}

export const STAGE_COLORS: Record<StageType, string> = {
  // legacy
  LOAD: "#34a853",
  FILTER: "#f59e0b",
  JOIN: "#3b82f6",
  UNION: "#a855f7",
  GROUP: "#ec4899",
  SORT: "#06b6d4",
  SELECT: "#14b8a6",
  CUSTOM: "#6b7280",
  // MongoDB
  MQL_SOURCE: "#34a853",        // green leaf — emits data
  MQL_MATCH: "#f59e0b",         // amber — same family as legacy FILTER
  MQL_VECTOR_SEARCH: "#9333ea", // vivid purple — AI semantic search
  MQL_PROJECT: "#14b8a6",
  MQL_SORT: "#06b6d4",
  MQL_LIMIT: "#64748b",
  MQL_GROUP: "#ec4899",
  MQL_LOOKUP: "#3b82f6",
  MQL_UNWIND: "#0ea5e9",
};

export const STAGE_LABELS: Record<StageType, string> = {
  LOAD: "Load",
  FILTER: "Filter",
  JOIN: "Join",
  UNION: "Union",
  GROUP: "Group By",
  SORT: "Sort",
  SELECT: "Select",
  CUSTOM: "Custom SQL",
  MQL_SOURCE: "Source",
  MQL_MATCH: "$match",
  MQL_VECTOR_SEARCH: "$vectorSearch",
  MQL_PROJECT: "$project",
  MQL_SORT: "$sort",
  MQL_LIMIT: "$limit",
  MQL_GROUP: "$group",
  MQL_LOOKUP: "$lookup",
  MQL_UNWIND: "$unwind",
};

export function defaultConfigFor(stageType: StageType): StageConfig {
  switch (stageType) {
    case "LOAD":
      return { stageType, tableName: "input", source: "" };
    case "FILTER":
      return { stageType, table: "", column: "", operator: "=", value: "" };
    case "JOIN":
      return {
        stageType,
        joinType: "INNER",
        leftTable: "",
        rightTable: "",
        leftKey: "",
        rightKey: "",
      };
    case "UNION":
      return { stageType, tables: [], unionAll: false };
    case "GROUP":
      return { stageType, table: "", groupBy: [], aggregations: [] };
    case "SORT":
      return { stageType, table: "", orderBy: [] };
    case "SELECT":
      return { stageType, table: "", columns: [] };
    case "CUSTOM":
      return { stageType, sql: "" };
    case "MQL_SOURCE":
      return { stageType, database: "sample_mflix", collection: "" };
    case "MQL_MATCH":
    case "MQL_VECTOR_SEARCH":
    case "MQL_PROJECT":
    case "MQL_SORT":
    case "MQL_LIMIT":
    case "MQL_GROUP":
    case "MQL_LOOKUP":
    case "MQL_UNWIND":
      return { stageType, body: {} };
  }
}
