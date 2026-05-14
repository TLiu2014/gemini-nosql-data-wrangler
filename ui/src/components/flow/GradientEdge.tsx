import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useInternalNode,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import { STAGE_COLORS, type StageNodeData } from "@/types/Pipeline";
import { useStageNodeCallbacks } from "./StageNodeContext";

const FALLBACK_COLOR = "#9ca3af";

function GradientEdgeImpl({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const { readOnly } = useStageNodeCallbacks();
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  const sourceColor = colorFor(sourceNode?.data) ?? FALLBACK_COLOR;
  const targetColor = colorFor(targetNode?.data) ?? FALLBACK_COLOR;

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const gradientId = `tfu-edge-grad-${id}`;
  const markerId = `tfu-edge-arrow-${id}`;

  return (
    <>
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          <stop offset="0%" stopColor={sourceColor} />
          <stop offset="100%" stopColor={targetColor} />
        </linearGradient>
        <marker
          id={markerId}
          viewBox="-5 -5 10 10"
          refX="3.5"
          refY="0"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M -3 -3 L 4 0 L -3 3 z" fill={targetColor} />
        </marker>
      </defs>
      <BaseEdge
        path={path}
        markerEnd={`url(#${markerId})`}
        style={{ stroke: `url(#${gradientId})`, strokeWidth: 2.5 }}
      />
      {selected && !readOnly && (
        <EdgeLabelRenderer>
          <button
            type="button"
            aria-label="Delete connection"
            className="nodrag nopan absolute flex h-5 w-5 items-center justify-center rounded-full bg-white text-gray-500 shadow-md ring-1 ring-gray-300 hover:bg-red-50 hover:text-red-600 hover:ring-red-400"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            onClick={() => deleteElements({ edges: [{ id }] })}
          >
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

function colorFor(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const stageType = (data as Partial<StageNodeData>).stageType;
  if (!stageType) return null;
  return STAGE_COLORS[stageType] ?? null;
}

export const GradientEdge = memo(GradientEdgeImpl);
