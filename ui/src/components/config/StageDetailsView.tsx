import { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import { cn } from "@/lib/Utils";
import {
  type StageConfig,
  type StageNodeData,
  STAGE_COLORS,
  STAGE_LABELS,
} from "@/types/Pipeline";

interface StageDetailsViewProps {
  node: { id: string; data: StageNodeData } | null;
  /** Called when the user dismisses the panel (X / footer Close / Esc). */
  onClose?: () => void;
}

const FALLBACK_COLOR = "#64748b";

/**
 * Read-only inspector for a stage. Mirrors {@link StageConfigUI}'s structure
 * so the view-only experience feels symmetric with editing, but renders every
 * value as plain text / JSON instead of input controls. Used in view-only
 * mode when the user double-clicks a node or clicks its eye icon.
 */
export function StageDetailsView({ node, onClose }: StageDetailsViewProps) {
  // Esc closes the panel — symmetric with the editor's Esc-to-cancel.
  useEffect(() => {
    if (!node) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [node, onClose]);

  if (!node) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-gray-500">
        Select a node on the canvas to inspect it.
      </div>
    );
  }

  const { data } = node;
  const color = STAGE_COLORS[data.stageType] ?? FALLBACK_COLOR;
  const stageLabel = STAGE_LABELS[data.stageType] ?? data.stageType;
  const isVectorSearch = data.stageType === "MQL_VECTOR_SEARCH";

  return (
    <div className="grid h-full min-h-0 w-full flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded px-2 py-0.5 text-xs font-semibold tracking-wide text-white",
              isVectorSearch ? "font-mono normal-case" : "uppercase",
            )}
            style={{ backgroundColor: color }}
          >
            {stageLabel}
          </span>
          <span className="text-xs text-gray-500">#{data.stageIndex}</span>
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close details"
          >
            <X className="h-4 w-4 text-gray-500" />
          </Button>
        )}
      </header>

      <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
        <div className="space-y-4">
          <DetailRow label="Display label" value={data.label} />
          <DetailRow
            label="Output table name"
            value={
              data.outputTableName ??
              `${data.stageType.toLowerCase()}_${data.stageIndex}`
            }
            mono
          />
          {data.executionState && (
            <DetailRow label="Execution state" value={data.executionState} />
          )}

          <div className="border-t border-gray-200 pt-4">
            <OperationDetails config={data.config} />
          </div>
        </div>
      </div>

      {onClose && (
        <footer className="border-t border-gray-200 bg-white p-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="w-full justify-center"
          >
            Close
          </Button>
        </footer>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div
        className={cn(
          "min-h-[20px] break-words text-sm text-gray-800",
          mono && "font-mono",
        )}
      >
        {value === "" || value == null ? (
          <span className="text-gray-400">—</span>
        ) : (
          value
        )}
      </div>
    </div>
  );
}

/** Pretty-printed, read-only JSON block — used for raw MongoDB stage bodies. */
function JsonBlock({ value }: { value: unknown }) {
  let text: string;
  try {
    text = JSON.stringify(value ?? {}, null, 2);
  } catch {
    text = String(value);
  }
  if (!text || text === "null" || text === "undefined") text = "{}";
  return (
    <pre className="max-h-64 overflow-auto rounded border border-gray-200 bg-gray-50 p-2 font-mono text-[11px] leading-snug text-gray-800">
      {text}
    </pre>
  );
}

/**
 * Per-stage operation breakdown. MongoDB stages are what the agent emits:
 * sources show database/collection, every other stage shows its raw pipeline
 * body as JSON (the canvas never introspects the body). The legacy
 * SQL-flavored configs fall through to a raw JSON dump — they're never
 * produced here but render gracefully if encountered.
 */
function OperationDetails({ config }: { config: StageConfig }) {
  switch (config.stageType) {
    case "MQL_SOURCE":
      return (
        <div className="space-y-3">
          <DetailRow label="Database" value={config.database} mono />
          <DetailRow label="Collection" value={config.collection} mono />
        </div>
      );
    case "MQL_MATCH":
    case "MQL_VECTOR_SEARCH":
    case "MQL_PROJECT":
    case "MQL_SORT":
    case "MQL_LIMIT":
    case "MQL_GROUP":
    case "MQL_LOOKUP":
    case "MQL_UNWIND":
      return (
        <DetailRow
          label={`${STAGE_LABELS[config.stageType]} stage body`}
          value={<JsonBlock value={config.body} />}
        />
      );
    default:
      return (
        <DetailRow label="Configuration" value={<JsonBlock value={config} />} />
      );
  }
}
