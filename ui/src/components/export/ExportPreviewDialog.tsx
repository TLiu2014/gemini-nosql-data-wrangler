import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";

/**
 * What the export dialog is previewing. `image` carries a ready-to-save PNG
 * data URL; `mql` carries the generated mongosh script text. `name` is the
 * pipeline name, used for the download filename.
 */
export type ExportPreview =
  | { kind: "image"; dataUrl: string; name: string }
  | { kind: "mql"; text: string; name: string };

/**
 * Preview-before-save dialog for the canvas export actions. Images show the
 * rendered PNG; MQL shows the script with a Copy button. Both expose a
 * Download button that defers to the host's `onDownload` (same file-save
 * behavior as before the dialog existed).
 */
export function ExportPreviewDialog({
  preview,
  onClose,
  onDownload,
}: {
  preview: ExportPreview | null;
  onClose: () => void;
  onDownload: (preview: ExportPreview) => void;
}) {
  const [copied, setCopied] = useState(false);
  const open = preview !== null;

  const handleCopy = async () => {
    if (!preview || preview.kind !== "mql") return;
    try {
      await navigator.clipboard.writeText(preview.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — fall through silently */
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-3xl">
        {preview && (
          <>
            <DialogHeader>
              <DialogTitle>
                {preview.kind === "image"
                  ? "Export canvas image"
                  : "Export MQL script"}
              </DialogTitle>
              <DialogDescription>
                {preview.kind === "image"
                  ? "Preview the diagram PNG before saving it."
                  : "Preview the generated mongosh script — copy it to the clipboard or download the file."}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-3 max-h-[60vh] overflow-auto rounded-md border border-slate-200 bg-slate-50">
              {preview.kind === "image" ? (
                <img
                  src={preview.dataUrl}
                  alt="Canvas export preview"
                  className="mx-auto block max-w-full"
                />
              ) : (
                <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs leading-snug text-slate-800">
                  {preview.text}
                </pre>
              )}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              {preview.kind === "mql" && (
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </button>
              )}
              <button
                type="button"
                onClick={() => onDownload(preview)}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
              >
                <Download className="h-4 w-4" />
                Download
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
