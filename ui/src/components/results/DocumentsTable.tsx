import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { cn } from "@/lib/Utils";

/**
 * MongoDB-aware results table. Rows are documents (potentially deeply nested
 * objects), not flat rows from a SQL query. The table renders the most
 * frequently-occurring scalar fields as columns; nested values become a
 * compact preview ("{ 4 fields }" / "[3 items]") so the table doesn't sprout
 * a sea of mostly-empty columns. The full document lives in the JSON pane on
 * the right, driven by `selectedIndex`.
 *
 * This is a controlled component — selection lives in the parent so the
 * companion JSON pane can react to row clicks.
 */
interface DocumentsTableProps {
  rows: unknown[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
}

const PREVIEW_COLUMN_LIMIT = 6;

export default function DocumentsTable({
  rows,
  selectedIndex,
  onSelect,
}: DocumentsTableProps) {
  const columns = useMemo(() => collectTopColumns(rows), [rows]);

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs italic text-slate-400">
        No documents.
      </div>
    );
  }

  const totalKeyCount = rows[0]
    ? Object.keys(rows[0] as Record<string, unknown>).length
    : 0;
  const hasMoreColumns = columns.length < totalKeyCount;

  return (
    <div className="h-full min-h-0 overflow-auto">
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
            {hasMoreColumns && (
              <th className="border-b border-slate-200 px-2 py-1.5 text-[11px] font-normal italic text-slate-400">
                …more
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isSelected = selectedIndex === i;
            return (
              <tr
                key={i}
                onClick={() => onSelect(isSelected ? null : i)}
                className={cn(
                  "cursor-pointer hover:bg-blue-50",
                  isSelected && "bg-blue-100",
                )}
              >
                <td className="w-8 px-2 py-1 text-center text-slate-400">
                  {isSelected ? (
                    <ChevronDown className="inline h-3 w-3" />
                  ) : (
                    <ChevronRight className="inline h-3 w-3" />
                  )}
                </td>
                {columns.map((c) => (
                  <Cell key={c} value={(r as Record<string, unknown>)?.[c]} />
                ))}
                {hasMoreColumns && (
                  <td className="w-12 px-2 py-1 text-[10px] italic text-slate-400">
                    …
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function collectTopColumns(rows: unknown[]): string[] {
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
}

function Cell({ value }: { value: unknown }) {
  const display = renderValuePreview(value);
  const isNested = display.kind === "object" || display.kind === "array";
  return (
    <td
      className={cn(
        "max-w-[24rem] truncate border-b border-slate-100 px-2 py-1 font-mono text-[11px]",
        isNested ? "italic text-violet-700" : "text-slate-800",
        display.kind === "empty" && "text-slate-400",
      )}
      title={display.tooltip}
    >
      {display.text}
    </td>
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
