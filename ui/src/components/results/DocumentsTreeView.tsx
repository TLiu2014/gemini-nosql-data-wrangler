import {
  ArrowDownAZ,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ListOrdered,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/Utils";

export type KeyOrderMode = "normalized" | "original";

/**
 * MongoDB-aware results viewer. Each document is a collapsible card; when
 * collapsed it shows a one-line preview of its first few fields, when
 * expanded it shows the full tree with independently-collapsible nested
 * objects and arrays. Values are color-coded by type so they're scannable.
 *
 * This is a controlled component — selection lives in the parent so the
 * companion JSON pane can react to row clicks.
 *
 * Bulk expand/collapse: every collapsible node (DocumentCard, object, array)
 * registers itself in TreeBulkContext on mount so the toolbar buttons can
 * flip them all at once without prop-drilling. Default is "first nested layer
 * expanded" — the document card collapsed, but once opened its top-level
 * fields render expanded.
 */
interface DocumentsTreeViewProps {
  rows: unknown[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  /** Toggle controlling whether keys across rows are aligned to a shared
   *  union-order ("normalized") or kept in each doc's BSON insertion order
   *  ("original"). Rendered in the toolbar to the right. */
  keyOrderMode?: KeyOrderMode;
  onKeyOrderModeChange?: (mode: KeyOrderMode) => void;
}

const COLLAPSED_KEY_PREVIEW_LIMIT = 4;
const COLLAPSED_STRING_PREVIEW_LIMIT = 28;

type NodeApi = { setExpanded: (v: boolean) => void };

const TreeBulkContext = createContext<{
  register: (api: NodeApi) => () => void;
} | null>(null);

function useRegisterBulkNode(setExpanded: (v: boolean) => void) {
  const ctx = useContext(TreeBulkContext);
  // Keep the latest setter in a ref so we register a stable api object.
  const setRef = useRef(setExpanded);
  setRef.current = setExpanded;
  useEffect(() => {
    if (!ctx) return;
    const api: NodeApi = { setExpanded: (v) => setRef.current(v) };
    return ctx.register(api);
  }, [ctx]);
}

export default function DocumentsTreeView({
  rows,
  selectedIndex,
  onSelect,
  keyOrderMode,
  onKeyOrderModeChange,
}: DocumentsTreeViewProps) {
  const nodesRef = useRef(new Set<NodeApi>());

  const register = useCallback((api: NodeApi) => {
    nodesRef.current.add(api);
    return () => {
      nodesRef.current.delete(api);
    };
  }, []);

  const expandAll = useCallback(() => {
    nodesRef.current.forEach((api) => api.setExpanded(true));
  }, []);
  const collapseAll = useCallback(() => {
    nodesRef.current.forEach((api) => api.setExpanded(false));
  }, []);

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs italic text-slate-400">
        No documents.
      </div>
    );
  }

  return (
    <TreeBulkContext.Provider value={{ register }}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-1 border-b border-slate-100 bg-slate-50/60 px-2 py-1">
          <button
            type="button"
            onClick={expandAll}
            title="Expand all"
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200/70"
          >
            <ChevronsUpDown className="h-3 w-3" />
            Expand all
          </button>
          <button
            type="button"
            onClick={collapseAll}
            title="Collapse all"
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200/70"
          >
            <ChevronsDownUp className="h-3 w-3" />
            Collapse all
          </button>
          {keyOrderMode && onKeyOrderModeChange && (
            <div className="ml-auto flex items-center gap-0.5 rounded border border-slate-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => onKeyOrderModeChange("normalized")}
                title="Align keys across rows to a shared first-appearance order"
                className={cn(
                  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors",
                  keyOrderMode === "normalized"
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-500 hover:bg-slate-100",
                )}
              >
                <ArrowDownAZ className="h-3 w-3" />
                Aligned keys
              </button>
              <button
                type="button"
                onClick={() => onKeyOrderModeChange("original")}
                title="Keep each document's original BSON insertion order"
                className={cn(
                  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors",
                  keyOrderMode === "original"
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-500 hover:bg-slate-100",
                )}
              >
                <ListOrdered className="h-3 w-3" />
                Original order
              </button>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-white font-mono text-[12px] leading-relaxed">
          {rows.map((row, i) => (
            <DocumentCard
              key={i}
              row={row}
              index={i}
              total={rows.length}
              isSelected={selectedIndex === i}
              onToggleSelect={() => onSelect(selectedIndex === i ? null : i)}
            />
          ))}
        </div>
      </div>
    </TreeBulkContext.Provider>
  );
}

function DocumentCard({
  row,
  index,
  total,
  isSelected,
  onToggleSelect,
}: {
  row: unknown;
  index: number;
  total: number;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  useRegisterBulkNode(setExpanded);
  const indexLabel = `#${index}`;

  // When expanded, render a terse summary instead of the full inline preview
  // — keeps the header anchored while the tree shows the same data below,
  // without the duplicated single-line copy.
  const summary = summarizeRow(row);

  return (
    <div
      className={cn(
        "border-b border-slate-100",
        isSelected && "bg-blue-50/60",
      )}
    >
      <div
        onClick={() => {
          setExpanded((v) => !v);
          onToggleSelect();
        }}
        className={cn(
          "flex cursor-pointer items-start gap-1.5 px-2 py-1.5 hover:bg-slate-50",
          isSelected && "hover:bg-blue-50",
        )}
      >
        <span className="mt-0.5 text-slate-400">
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </span>
        <span className="select-none text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {indexLabel}
          <span className="text-slate-300"> / {total}</span>
        </span>
        <span className="min-w-0 flex-1 truncate text-slate-700">
          {expanded ? (
            <span className="text-[11px] italic text-slate-400">{summary}</span>
          ) : (
            <ValuePreview value={row} />
          )}
        </span>
      </div>
      {expanded && (
        <div className="pb-2 pl-7 pr-3">
          <TreeNode value={row} depth={0} initialExpanded />
        </div>
      )}
    </div>
  );
}

function summarizeRow(row: unknown): string {
  if (Array.isArray(row)) {
    return `Array (${row.length} item${row.length === 1 ? "" : "s"})`;
  }
  if (row && typeof row === "object") {
    const n = Object.keys(row as Record<string, unknown>).length;
    return `${n} field${n === 1 ? "" : "s"}`;
  }
  return String(row);
}

/** Recursive tree node. Strings/numbers/etc render inline; objects/arrays
 *  recurse with their own collapse state. */
function TreeNode({
  value,
  depth,
  initialExpanded = false,
}: {
  value: unknown;
  depth: number;
  initialExpanded?: boolean;
}) {
  if (Array.isArray(value)) {
    return (
      <CollapsibleArray
        value={value}
        depth={depth}
        initialExpanded={initialExpanded}
      />
    );
  }
  if (value && typeof value === "object") {
    return (
      <CollapsibleObject
        value={value as Record<string, unknown>}
        depth={depth}
        initialExpanded={initialExpanded}
      />
    );
  }
  return <LeafValue value={value} />;
}

function CollapsibleObject({
  value,
  depth,
  initialExpanded,
}: {
  value: Record<string, unknown>;
  depth: number;
  initialExpanded: boolean;
}) {
  const keys = Object.keys(value);
  const [expanded, setExpanded] = useState(initialExpanded);
  useRegisterBulkNode(setExpanded);

  if (keys.length === 0) {
    return <span className="text-slate-500">{"{}"}</span>;
  }

  return (
    <div>
      <span
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
        className="inline-flex cursor-pointer items-center gap-1 text-slate-500 hover:text-slate-700"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {expanded ? (
          <span className="text-slate-400">{"{"}</span>
        ) : (
          <span className="text-slate-600">
            <ObjectInline value={value} />
          </span>
        )}
      </span>
      {expanded && (
        <>
          <div className="border-l border-slate-200 pl-3">
            {keys.map((k) => (
              <div key={k} className="flex items-start gap-1.5">
                <span className="shrink-0 text-violet-700">{k}</span>
                <span className="shrink-0 text-slate-400">:</span>
                <span className="min-w-0 flex-1">
                  <TreeNode value={value[k]} depth={depth + 1} />
                </span>
              </div>
            ))}
          </div>
          <span className="text-slate-400">{"}"}</span>
        </>
      )}
    </div>
  );
}

function CollapsibleArray({
  value,
  depth,
  initialExpanded,
}: {
  value: unknown[];
  depth: number;
  initialExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(initialExpanded);
  useRegisterBulkNode(setExpanded);

  if (value.length === 0) {
    return <span className="text-slate-500">[]</span>;
  }

  return (
    <div>
      <span
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
        className="inline-flex cursor-pointer items-center gap-1 text-slate-500 hover:text-slate-700"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <span className="text-slate-500">
          Array
          <span className="text-slate-400">({value.length})</span>
        </span>
        {!expanded && (
          <span className="ml-1 truncate text-slate-500">
            <ArrayInline value={value} />
          </span>
        )}
        {expanded && <span className="ml-1 text-slate-400">[</span>}
      </span>
      {expanded && (
        <>
          <div className="border-l border-slate-200 pl-3">
            {value.map((v, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <span className="shrink-0 text-slate-400">{i}:</span>
                <span className="min-w-0 flex-1">
                  <TreeNode value={v} depth={depth + 1} />
                </span>
              </div>
            ))}
          </div>
          <span className="text-slate-400">]</span>
        </>
      )}
    </div>
  );
}

function LeafValue({ value }: { value: unknown }) {
  if (value === null) {
    return <span className="italic text-slate-400">null</span>;
  }
  if (value === undefined) {
    return <span className="italic text-slate-400">undefined</span>;
  }
  if (typeof value === "string") {
    return <span className="break-all text-emerald-700">"{value}"</span>;
  }
  if (typeof value === "number") {
    return <span className="text-blue-700">{value}</span>;
  }
  if (typeof value === "bigint") {
    return <span className="text-blue-700">{String(value)}n</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-violet-700">{String(value)}</span>;
  }
  return <span className="text-slate-700">{String(value)}</span>;
}

/* ───────────────────── one-line previews ───────────────────── */

function ValuePreview({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <span className="text-slate-600">
        Array<span className="text-slate-400">({value.length})</span>{" "}
        <ArrayInline value={value} />
      </span>
    );
  }
  if (value && typeof value === "object") {
    return <ObjectInline value={value as Record<string, unknown>} />;
  }
  return <LeafValue value={value} />;
}

function ObjectInline({ value }: { value: Record<string, unknown> }) {
  const keys = Object.keys(value);
  const head = keys.slice(0, COLLAPSED_KEY_PREVIEW_LIMIT);
  const overflow = keys.length - head.length;
  return (
    <span className="text-slate-600">
      <span className="text-slate-400">{"{ "}</span>
      {head.map((k, i) => (
        <span key={k}>
          <span className="text-violet-700">{k}</span>
          <span className="text-slate-400">: </span>
          <InlineLeaf value={value[k]} />
          {i < head.length - 1 ? (
            <span className="text-slate-400">, </span>
          ) : null}
        </span>
      ))}
      {overflow > 0 && (
        <span className="text-slate-400">
          {head.length > 0 ? ", " : ""}…{overflow} more
        </span>
      )}
      <span className="text-slate-400">{" }"}</span>
    </span>
  );
}

function ArrayInline({ value }: { value: unknown[] }) {
  const head = value.slice(0, 3);
  return (
    <span className="text-slate-500">
      <span className="text-slate-400">[</span>
      {head.map((v, i) => (
        <span key={i}>
          <InlineLeaf value={v} />
          {i < head.length - 1 ? (
            <span className="text-slate-400">, </span>
          ) : null}
        </span>
      ))}
      {value.length > head.length && (
        <span className="text-slate-400">, …</span>
      )}
      <span className="text-slate-400">]</span>
    </span>
  );
}

/** Compact one-token representation for inline previews. */
function InlineLeaf({ value }: { value: unknown }) {
  if (value === null) return <span className="italic text-slate-400">null</span>;
  if (Array.isArray(value)) {
    return (
      <span className="text-slate-500">
        Array<span className="text-slate-400">({value.length})</span>
      </span>
    );
  }
  if (value && typeof value === "object") {
    return <span className="text-slate-500">{"{…}"}</span>;
  }
  if (typeof value === "string") {
    const trimmed =
      value.length > COLLAPSED_STRING_PREVIEW_LIMIT
        ? value.slice(0, COLLAPSED_STRING_PREVIEW_LIMIT) + "…"
        : value;
    return <span className="text-emerald-700">"{trimmed}"</span>;
  }
  return <LeafValue value={value} />;
}
