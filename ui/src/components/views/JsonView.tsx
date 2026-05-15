import { useCallback, useMemo, useState } from "react";
import {
  Check,
  Copy,
  Download,
  Minus,
  Plus,
} from "lucide-react";

/**
 * Generic JSON viewer. Render any value as pretty-printed JSON with font size
 * controls, copy-to-clipboard, and download. Header is fully customizable so
 * the same component drives both Pipeline-Schema panels and per-document
 * result panels.
 */
export interface JsonViewProps {
  /** Anything JSON-serializable. Non-objects render as their JSON string too. */
  data: unknown;
  /** Headline shown on the left side of the toolbar. */
  title?: string;
  /** Optional inline metadata (e.g. "3 stages · 0 datasets") next to the title. */
  info?: React.ReactNode;
  /** Filename (sans extension) suggested when the user clicks Download. */
  downloadName?: string;
  /** Empty-state message when `data` is null / undefined / []. */
  emptyHint?: string;
}

const JSON_FONT_MIN_PX = 9;
const JSON_FONT_MAX_PX = 22;
const JSON_FONT_DEFAULT_PX = 12;

export function JsonView({
  data,
  title,
  info,
  downloadName = "data",
  emptyHint,
}: JsonViewProps) {
  const json = useMemo(() => stringifyForDisplay(data), [data]);
  const isEmpty = data == null || (Array.isArray(data) && data.length === 0);

  const [copied, setCopied] = useState(false);
  const [fontSizePx, setFontSizePx] = useState(JSON_FONT_DEFAULT_PX);

  const zoomOut = useCallback(() => {
    setFontSizePx((s) => Math.max(JSON_FONT_MIN_PX, s - 1));
  }, []);
  const zoomIn = useCallback(() => {
    setFontSizePx((s) => Math.min(JSON_FONT_MAX_PX, s + 1));
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable; ignore */
    }
  };

  const handleDownload = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${downloadName || "data"}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-gray-600">
          {title && (
            <span className="truncate font-mono text-gray-900">{title}</span>
          )}
          {info && (
            <>
              {title && <span>·</span>}
              <span className="truncate">{info}</span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="mr-1 flex items-center gap-0.5 rounded border border-gray-300 bg-white px-0.5 shadow-sm">
            <button
              type="button"
              onClick={zoomOut}
              disabled={fontSizePx <= JSON_FONT_MIN_PX}
              title="Smaller text"
              aria-label="Smaller text"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:pointer-events-none disabled:opacity-40"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span
              className="min-w-[2.25rem] select-none text-center font-mono text-[10px] text-gray-500"
              title="JSON font size"
            >
              {fontSizePx}px
            </span>
            <button
              type="button"
              onClick={zoomIn}
              disabled={fontSizePx >= JSON_FONT_MAX_PX}
              title="Larger text"
              aria-label="Larger text"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:pointer-events-none disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <ToolbarButton onClick={handleDownload} icon={Download}>
            Download
          </ToolbarButton>
          <ToolbarButton
            onClick={handleCopy}
            icon={copied ? Check : Copy}
            highlight={copied}
          >
            {copied ? "Copied" : "Copy"}
          </ToolbarButton>
        </div>
      </header>
      {isEmpty ? (
        <div className="flex flex-1 items-center justify-center bg-gray-950 text-xs italic text-gray-500">
          {emptyHint ?? "No data."}
        </div>
      ) : (
        <pre
          className="flex-1 overflow-auto bg-gray-950 p-4 font-mono leading-relaxed text-gray-100"
          style={{ fontSize: `${fontSizePx}px` }}
        >
          <code>{json}</code>
        </pre>
      )}
    </div>
  );
}

function stringifyForDisplay(data: unknown): string {
  if (data === undefined) return "undefined";
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

interface ToolbarButtonProps {
  onClick: () => void;
  icon: typeof Copy;
  children: React.ReactNode;
  highlight?: boolean;
}

function ToolbarButton({
  onClick,
  icon: Icon,
  children,
  highlight,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-medium shadow-sm " +
        (highlight
          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50")
      }
    >
      <Icon className="h-3 w-3" />
      <span>{children}</span>
    </button>
  );
}
