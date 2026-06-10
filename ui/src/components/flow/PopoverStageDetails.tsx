import { useEffect, useRef } from "react";
import { NodeToolbar, Position, useReactFlow, type Node } from "@xyflow/react";

import { StageDetailsView } from "@/components/config/StageDetailsView";
import { useNodeToolbarPosition } from "./NodeToolbarPositionContext";
import type { StageNodeData } from "@/types/Pipeline";

const POPOVER_W = 340;
const POPOVER_H = 520;
const POPOVER_OFFSET = 16;
const NODE_FALLBACK_W = 220;
const NODE_FALLBACK_H = 110;
const FOCUS_DURATION_MS = 300;

interface PopoverStageDetailsProps {
  node: Node<StageNodeData>;
  onClose: () => void;
}

/**
 * Read-only counterpart to {@link PopoverStageEditor}. Same NodeToolbar shell
 * + view-centering behavior, but renders {@link StageDetailsView} instead of
 * the editable form. Shown in view-only mode when the user double-clicks a
 * node or clicks its eye icon.
 */
export function PopoverStageDetails({ node, onClose }: PopoverStageDetailsProps) {
  const position = useNodeToolbarPosition();
  const reactFlow = useReactFlow();
  const nodeId = node.id;

  // Pan the canvas so the node + popover are both in view when it opens.
  useEffect(() => {
    const internal = reactFlow.getInternalNode(nodeId);
    if (!internal) return;

    const w = internal.measured?.width ?? NODE_FALLBACK_W;
    const h = internal.measured?.height ?? NODE_FALLBACK_H;
    const nodeX = internal.internals.positionAbsolute.x;
    const nodeY = internal.internals.positionAbsolute.y;

    let cx = nodeX + w / 2;
    let cy = nodeY + h / 2;

    switch (position) {
      case Position.Right:
        cx += (POPOVER_W + POPOVER_OFFSET) / 2;
        break;
      case Position.Left:
        cx -= (POPOVER_W + POPOVER_OFFSET) / 2;
        break;
      case Position.Top:
        cy -= (POPOVER_H + POPOVER_OFFSET) / 2;
        break;
      case Position.Bottom:
        cy += (POPOVER_H + POPOVER_OFFSET) / 2;
        break;
    }

    const { zoom } = reactFlow.getViewport();
    reactFlow.setCenter(cx, cy, { zoom, duration: FOCUS_DURATION_MS });
  }, [nodeId, position, reactFlow]);

  // Capture viewport at mount and restore on unmount so closing the popover
  // puts the canvas back where it was before the open-time pan.
  const savedViewportRef = useRef<{ x: number; y: number; zoom: number } | null>(null);
  useEffect(() => {
    if (savedViewportRef.current === null) {
      savedViewportRef.current = reactFlow.getViewport();
    }
    return () => {
      const v = savedViewportRef.current;
      if (v) reactFlow.setViewport(v, { duration: FOCUS_DURATION_MS });
    };
  }, [reactFlow]);

  return (
    <NodeToolbar
      nodeId={nodeId}
      isVisible
      position={position}
      offset={POPOVER_OFFSET}
      className="!pointer-events-auto !flex !flex-col [&>*]:min-h-0"
    >
      <div
        className="nowheel box-border flex min-h-0 w-[340px] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
        style={{ maxHeight: "85vh" }}
      >
        <StageDetailsView node={node} onClose={onClose} />
      </div>
    </NodeToolbar>
  );
}
