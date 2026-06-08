import { memo } from "react";
import { Handle, Position, useConnection, type Node, type NodeProps } from "@xyflow/react";
import {
  Filter,
  GitMerge,
  Layers,
  ArrowDownAZ,
  Columns3,
  Database,
  FunctionSquare,
  Code2,
  ExternalLink,
  Pencil,
  Sparkles,
  ListFilter,
  Crop,
  Split,
} from "lucide-react";
import type { StageNodeData, StageType } from "@/types/Pipeline";
import { STAGE_COLORS, STAGE_LABELS } from "@/types/Pipeline";
import { cn } from "@/lib/Utils";
import { STAGE_EDGE_HANDLE_IDS } from "./StageEdgeHandles";
import { useStageNodeCallbacks } from "./StageNodeContext";

const STAGE_ICONS: Record<StageType, typeof Filter> = {
  // legacy
  LOAD: Database,
  FILTER: Filter,
  JOIN: GitMerge,
  UNION: Layers,
  GROUP: FunctionSquare,
  SORT: ArrowDownAZ,
  SELECT: Columns3,
  CUSTOM: Code2,
  // MongoDB
  MQL_SOURCE: Database,
  MQL_MATCH: ListFilter,
  MQL_VECTOR_SEARCH: Sparkles,
  MQL_PROJECT: Columns3,
  MQL_SORT: ArrowDownAZ,
  MQL_LIMIT: Crop,
  MQL_GROUP: FunctionSquare,
  MQL_LOOKUP: GitMerge,
  MQL_UNWIND: Split,
};

const EXEC_BADGE: Record<NonNullable<StageNodeData["executionState"]>, string> = {
  pending: "bg-amber-50 text-amber-700",
  running: "bg-blue-50 text-blue-700 animate-pulse",
  success: "bg-emerald-50 text-emerald-700",
  error: "bg-red-50 text-red-700",
};

type StageNodeType = Node<StageNodeData, "stageNode">;

// Slate-500 + Database icon are the safe fallbacks when the agent ships a
// stage type we don't have a registry entry for (e.g. it hallucinates an
// `MQL_SET` or `MQL_ADDFIELDS` we never registered). Without these the
// component renders `<undefined />` and React crashes the entire tree
// with "Element type is invalid".
const FALLBACK_STAGE_COLOR = "#64748b";
const FALLBACK_STAGE_ICON = Database;

function StageNodeImpl({ id, data, selected }: NodeProps<StageNodeType>) {
  const color = STAGE_COLORS[data.stageType] ?? FALLBACK_STAGE_COLOR;
  const Icon = STAGE_ICONS[data.stageType] ?? FALLBACK_STAGE_ICON;
  const isVectorSearch = data.stageType === "MQL_VECTOR_SEARCH";
  const stageLabel = STAGE_LABELS[data.stageType] ?? data.stageType;
  const { onShowOutput, onEdit, readOnly, validReconnectNodeIdRef, selfLoopReconnectNodeIdRef } = useStageNodeCallbacks();
  const activeConnection = useConnection((connection) => ({
    inProgress: connection.inProgress,
    isValid: connection.isValid,
    toNodeId: connection.toHandle?.nodeId ?? null,
    toHandleId: connection.toHandle?.id ?? null,
  }));

  // Read refs synchronously — they are written in handleReconnectStart before
  // zustand fires useConnection, so these values are always current here.
  const reconnectInvalid =
    (validReconnectNodeIdRef?.current != null && id !== validReconnectNodeIdRef.current) ||
    (selfLoopReconnectNodeIdRef?.current != null && id === selfLoopReconnectNodeIdRef.current);
  const reconnectInProgress =
    validReconnectNodeIdRef?.current != null ||
    selfLoopReconnectNodeIdRef?.current != null;

  const handleCls =
    "!h-2.5 !w-2.5 !border-2 !border-gray-300 !bg-white transition-colors hover:!border-blue-400 hover:!bg-blue-50";

  const getHandleSide = (handleId: string) => handleId.split("-")[0];

  const approachingSide = activeConnection.toHandleId
    ? getHandleSide(activeConnection.toHandleId)
    : null;

  const getHandleClassName = (handleId: string) => {
    const isApproaching =
      activeConnection.inProgress &&
      activeConnection.toNodeId === id &&
      approachingSide === getHandleSide(handleId);

    if (!isApproaching) {
      return handleCls;
    }

    if (reconnectInProgress) {
      return `${handleCls} tfu-handle-approaching ${
        reconnectInvalid ? "tfu-handle-invalid" : "tfu-handle-valid"
      }`;
    }

    if (activeConnection.isValid == null) {
      return handleCls;
    }

    return `${handleCls} tfu-handle-approaching ${
      reconnectInvalid || activeConnection.isValid === false
        ? "tfu-handle-invalid"
        : "tfu-handle-valid"
    }`;
  };

  const h = STAGE_EDGE_HANDLE_IDS;

  return (
    <div
      className={cn(
        "relative min-w-[170px] rounded-md border-2 bg-white p-2 shadow-sm transition-shadow",
        selected ? "ring-2 ring-blue-400 ring-offset-2" : "hover:shadow-md",
        isVectorSearch &&
          "bg-gradient-to-br from-purple-50 via-white to-fuchsia-50 shadow-purple-200/60 ring-1 ring-purple-200 tfu-vector-sparkle",
      )}
      style={{ borderColor: color }}
    >
      {/* One visual dot per side: React Flow still needs separate target + source
          handles; stacked at the same spot so only one connector shows. */}
      <Handle
        id={h.topIn}
        type="target"
        position={Position.Top}
        className={`${getHandleClassName(h.topIn)} z-[1]`}
        style={{ left: "50%" }}
      />
      <Handle
        id={h.topOut}
        type="source"
        position={Position.Top}
        className={`${getHandleClassName(h.topOut)} z-[2]`}
        style={{ left: "50%" }}
      />

      <Handle
        id={h.bottomIn}
        type="target"
        position={Position.Bottom}
        className={`${getHandleClassName(h.bottomIn)} z-[1]`}
        style={{ left: "50%" }}
      />
      <Handle
        id={h.bottomOut}
        type="source"
        position={Position.Bottom}
        className={`${getHandleClassName(h.bottomOut)} z-[2]`}
        style={{ left: "50%" }}
      />

      <Handle
        id={h.leftIn}
        type="target"
        position={Position.Left}
        className={`${getHandleClassName(h.leftIn)} z-[1]`}
        style={{ top: "50%" }}
      />
      <Handle
        id={h.leftOut}
        type="source"
        position={Position.Left}
        className={`${getHandleClassName(h.leftOut)} z-[2]`}
        style={{ top: "50%" }}
      />

      <Handle
        id={h.rightIn}
        type="target"
        position={Position.Right}
        className={`${getHandleClassName(h.rightIn)} z-[1]`}
        style={{ top: "50%" }}
      />
      <Handle
        id={h.rightOut}
        type="source"
        position={Position.Right}
        className={`${getHandleClassName(h.rightOut)} z-[2]`}
        style={{ top: "50%" }}
      />

      <div className="flex items-start gap-1.5">
        <div
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: color }}
        >
          <Icon className="h-3 w-3 text-white" strokeWidth={2.5} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1.5">
            <span
              className={cn(
                "text-[11px] font-semibold tracking-wide",
                isVectorSearch ? "font-mono normal-case" : "uppercase",
              )}
              style={{ color }}
            >
              {stageLabel}
            </span>
            <div className="flex items-center gap-1">
              <span className="rounded bg-gray-100 px-1 py-0.5 text-[9px] font-medium text-gray-600">
                #{data.stageIndex}
              </span>
              {onEdit && !readOnly && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(id);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Edit stage (or double-click the node)"
                  aria-label="Edit stage"
                  className="inline-flex h-4 w-4 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                >
                  <Pencil className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          </div>
          <div className="mt-0.5 truncate text-[13px] text-gray-800">{data.label}</div>
          {data.outputTableName && (
            onShowOutput ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onShowOutput(id);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                title={`View ${data.outputTableName} schema`}
                className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded text-[11px] text-blue-600 hover:text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <span className="truncate">→ {data.outputTableName}</span>
                <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
              </button>
            ) : (
              <div className="mt-1 truncate text-[11px] text-gray-500">
                → {data.outputTableName}
              </div>
            )
          )}
          {data.executionState && (
            <span
              className={cn(
                "mt-2 inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                EXEC_BADGE[data.executionState],
              )}
            >
              {data.executionState}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export const StageNode = memo(StageNodeImpl);
