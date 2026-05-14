/**
 * Stage node connection points: each side has a target (in) and source (out),
 * offset so two handles on the same side do not overlap.
 */
export const STAGE_EDGE_HANDLE_IDS = {
  topIn: "top-in",
  topOut: "top-out",
  bottomIn: "bottom-in",
  bottomOut: "bottom-out",
  leftIn: "left-in",
  leftOut: "left-out",
  rightIn: "right-in",
  rightOut: "right-out",
} as const;

export type StageEdgeHandleId =
  (typeof STAGE_EDGE_HANDLE_IDS)[keyof typeof STAGE_EDGE_HANDLE_IDS];

/** Edges without handles (e.g. loaded JSON): classic vertical DAG wiring. */
export const DEFAULT_EDGE_TARGET_HANDLE_ID = STAGE_EDGE_HANDLE_IDS.topIn;
export const DEFAULT_EDGE_SOURCE_HANDLE_ID = STAGE_EDGE_HANDLE_IDS.bottomOut;
