import { type MutableRefObject, createContext, useContext } from "react";

export interface StageNodeCallbacks {
  /**
   * Called when the user clicks a node's output-table link. The library does
   * not interpret this — typical wiring is to switch a "Data Schema" tab to
   * the matching stage.
   */
  onShowOutput?: (stageId: string) => void;
  /**
   * Called when the user clicks the per-node edit (pencil) icon. Distinct
   * from a plain node click — clients use this to open an edit form even
   * when single-click selection is suppressed (e.g. popover edit mode).
   */
  onEdit?: (stageId: string) => void;
  /** When true, editing/deleting controls are hidden throughout the canvas. */
  readOnly?: boolean;
  /**
   * Ref to the only node whose handles are valid during a view-only reconnect
   * drag. Null outside a drag or in edit mode. Passed as a ref so StageNode
   * always reads the synchronously-set value from handleReconnectStart.
   */
  validReconnectNodeIdRef?: MutableRefObject<string | null>;
  /**
   * Ref to the node that would create a self-loop during any reconnect drag —
   * always an invalid target. Null outside an active drag.
   */
  selfLoopReconnectNodeIdRef?: MutableRefObject<string | null>;
}

export const StageNodeContext = createContext<StageNodeCallbacks>({});

export function useStageNodeCallbacks(): StageNodeCallbacks {
  return useContext(StageNodeContext);
}
