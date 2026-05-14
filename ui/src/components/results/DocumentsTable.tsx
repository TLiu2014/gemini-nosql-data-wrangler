import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/Utils";

/**
 * MongoDB-aware results table. Rows are documents (potentially deeply nested
 * objects), not flat rows from a SQL query. The table shows leading scalar
 * fields and lets the user click a row to open a side drawer that pretty-prints
 * the full document.
 *
 * Nested values are NOT recursively flattened into extra columns — that turns
 * unpredictable Mongo schemas into a sea of mostly-empty columns. Instead, we
 * show a compact preview ("{ 4 fields }" or "[3 items]") and surface the full
 * JSON in the drawer.
 */
interface DocumentsTableProps {
  rows: unknown[];
}

const PREVIEW_COLUMN_LIMIT = 6;

export default function DocumentsTable({ rows }: DocumentsTableProps) {
  const [selected, setSelected] = useState<number | null>(null);

  const columns = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of rows) {
      if (r && typeof r === "object" && !Array.isArray(r)) {
        for (const k of Object.keys(r as Record<string, unknown>)) {
          seen.set(k, (seen.get(k) ?? 0) + 1);
        }
      }
    }
    // Sort by frequency (most common keys first), then alphabetically.
    return Array.from(seen.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, PREVIEW_COLUMN_LIMIT)
      .map(([k]) => k);
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-400">
        No documents.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-auto">
        <table className="min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100 text-left shadow-[inset_0_-1px_0_#e2e8f0]">
            <tr>
              <th className="w-8 px-2 py-1.5"></th>
              {columns.map((c) => (
                <th
                  key={c}
                  className="border-b border-slate-200 px-2 py-1.5 font-mono text-[11px] font-semibold text-slate-700"
                >
                  {c}
                </th>
              ))}
              {columns.length < Object.keys(rows[0] ?? {}).length && (
                <th className="border-b border-slate-200 px-2 py-1.5 text-[11px] font-normal italic text-slate-400">
                  …more
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                onClick={() => setSelected(i)}
                className={cn(
                  "cursor-pointer hover:bg-blue-50",
                  selected === i && "bg-blue-50",
                )}
              >
                <td className="w-8 px-2 py-1 text-center text-slate-400">
                  {selected === i ? (
                    <ChevronDown className="inline h-3 w-3" />
                  ) : (
                    <ChevronRight className="inline h-3 w-3" />
                  )}
                </td>
                {columns.map((c) => (
                  <Cell key={c} value={(r as Record<string, unknown>)?.[c]} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected !== null && (
        <DocumentDrawer
          doc={rows[selected]}
          index={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function Cell({ value }: { value: unknown }) {
  const display = renderValuePreview(value);
  const isNested = display.kind !== "scalar";
  return (
    <td
      className={cn(
        "max-w-[24rem] truncate border-b border-slate-100 px-2 py-1 font-mono text-[11px]",
        isNested ? "italic text-violet-700" : "text-slate-800",
      )}
      title={display.tooltip}
    >
      {display.text}
    </td>
  );
}

function DocumentDrawer({
  doc,
  index,
  onClose,
}: {
  doc: unknown;
  index: number;
  onClose: () => void;
}) {
  const json = JSON.stringify(doc, null, 2);
  return (
    <div className="flex w-[420px] shrink-0 flex-col border-l border-slate-200 bg-slate-950 text-slate-100">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <span className="font-mono text-[11px] text-slate-300">
          Document #{index}
        </span>
        <button
          onClick={onClose}
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          aria-label="Close document"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <pre className="flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed">
        <code>{json}</code>
      </pre>
    </div>
  );
}

interface ValuePreview {
  kind: "scalar" | "object" | "array" | "empty";
  text: string;
  tooltip: string;
}

function renderValuePreview(value: unknown): ValuePreview {
  if (value === null || value === undefined) {
    return { kind: "empty", text: "—", tooltip: "" };
  }
  if (Array.isArray(value)) {
    return {
      kind: "array",
      text: `[${value.length} item${value.length === 1 ? "" : "s"}]`,
      tooltip: tryStringify(value),
    };
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return {
      kind: "object",
      text: `{ ${keys.length} field${keys.length === 1 ? "" : "s"} }`,
      tooltip: tryStringify(value),
    };
  }
  const s = String(value);
  return { kind: "scalar", text: s, tooltip: s };
}

function tryStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
