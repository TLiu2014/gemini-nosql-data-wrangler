import { Position } from "@xyflow/react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Wrench,
} from "lucide-react";

import { AddStageMenu } from "@/components/toolbar/AddStageMenu";
import type { StageType } from "@/types/Pipeline";

const POSITION_OPTIONS: Array<{
  value: Position;
  label: string;
  Icon: typeof ArrowLeft;
}> = [
  { value: Position.Left, label: "Left", Icon: ArrowLeft },
  { value: Position.Right, label: "Right", Icon: ArrowRight },
  { value: Position.Top, label: "Top", Icon: ArrowUp },
  { value: Position.Bottom, label: "Bottom", Icon: ArrowDown },
];

export interface FlowCanvasToolbarProps {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  editPanelPosition: Position;
  onEditPanelPositionChange: (position: Position) => void;
  onAddStage: (stageType: StageType) => void;
}

export function FlowCanvasToolbar({
  expanded,
  onExpandedChange,
  editPanelPosition,
  onEditPanelPositionChange,
  onAddStage,
}: FlowCanvasToolbarProps) {
  return (
    <>
      {!expanded ? (
        <button
          type="button"
          onClick={() => onExpandedChange(true)}
          className="pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white/95 px-3 text-xs font-medium text-gray-700 shadow-md backdrop-blur hover:bg-gray-50"
          aria-label="Expand flow tools"
          aria-expanded={false}
        >
          <Wrench className="h-3.5 w-3.5" />
          <span>Tools</span>
          <ChevronRight className="h-4 w-4" />
        </button>
      ) : (
        <div className="pointer-events-auto flex flex-col gap-2 rounded-lg border border-gray-200 bg-white/95 p-2 shadow-md backdrop-blur">
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 pb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Flow tools
            </span>
            <button
              type="button"
              onClick={() => onExpandedChange(false)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              aria-label="Collapse flow tools"
              aria-expanded
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>

          <AddStageMenu onAdd={onAddStage} />

          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Edit panel (popover)
            </div>
            <div className="flex flex-wrap gap-1">
              {POSITION_OPTIONS.map(({ value, label, Icon }) => {
                const active = editPanelPosition === value;
                return (
                  <button
                    key={value}
                    type="button"
                    title={label}
                    aria-label={`Attach edit panel to ${label.toLowerCase()} of node`}
                    aria-pressed={active}
                    onClick={() => onEditPanelPositionChange(value)}
                    className={
                      "inline-flex h-8 w-8 items-center justify-center rounded-md border text-gray-600 shadow-sm transition-colors " +
                      (active
                        ? "border-blue-500 bg-blue-50 text-blue-800"
                        : "border-gray-200 bg-white hover:bg-gray-50")
                    }
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] leading-snug text-gray-400">
              Applies when stage config is pinned to the node (not the fixed
              right panel).
            </p>
          </div>
        </div>
      )}
    </>
  );
}
