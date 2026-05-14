import { useEffect } from "react";
import {
  NodeToolbar,
  Position,
  useReactFlow,
  type Node,
} from "@xyflow/react";

import { StageConfigUI } from "@/components/config/StageConfigUI";
import { useNodeToolbarPosition } from "./NodeToolbarPositionContext";
import type { StageNodeData } from "@/types/Pipeline";

const POPOVER_W = 340;
const POPOVER_H = 520;
const POPOVER_OFFSET = 16;
const NODE_FALLBACK_W = 220;
const NODE_FALLBACK_H = 110;
const FOCUS_DURATION_MS = 300;

interface PopoverStageEditorProps {
  node: Node<StageNodeData>;
  onUpdate: (id: string, patch: Partial<StageNodeData>) => void;
  onDelete: (id: string) => void;
  onCancel: () => void;
  confirmBeforeDelete: boolean;
}

export function PopoverStageEditor({
  node,
  onUpdate,
  onDelete,
  onCancel,
  confirmBeforeDelete,
}: PopoverStageEditorProps) {
  const position = useNodeToolbarPosition();
  const reactFlow = useReactFlow();
  const nodeId = node.id;

  // Pan the canvas so the node + popover are both in view when the editor opens.
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

  return (
    <NodeToolbar
      nodeId={nodeId}
      isVisible
      position={position}
      offset={POPOVER_OFFSET}
      className="!pointer-events-auto !flex !flex-col [&>*]:min-h-0"
    >
      <div
        className="box-border flex min-h-0 w-[340px] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
        style={{ maxHeight: "85vh" }}
      >
        <StageConfigUI
          node={node}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onCancel={onCancel}
          confirmBeforeDelete={confirmBeforeDelete}
        />
      </div>
    </NodeToolbar>
  );
}
