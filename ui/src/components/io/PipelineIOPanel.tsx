import { useRef, useState } from "react";
import {
  Upload,
  FileJson,
  AlertCircle,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import {
  validatePipelineSchema,
  type PipelineSchema,
} from "@/Schema";

/**
 * One entry in the optional sample-pipeline list shown at the top of the
 * panel. The host ships the JSON files; the panel just renders cards and
 * forwards clicks.
 */
export interface SamplePipelineEntry {
  id: string;
  label: string;
  description?: string;
  schema: PipelineSchema;
}

export interface PipelineIOPanelProps {
  onLoad: (schema: PipelineSchema) => void;
  /** Optional one-click sample pipelines shown at the top of the panel. */
  samples?: SamplePipelineEntry[];
}

type Status =
  | { kind: "idle" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

export function PipelineIOPanel({ onLoad, samples }: PipelineIOPanelProps) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);

  const tryLoad = (raw: string, sourceLabel: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      setStatus({
        kind: "error",
        message: `Invalid JSON: ${(e as Error).message}`,
      });
      return;
    }
    const err = validatePipelineSchema(parsed);
    if (err) {
      setStatus({ kind: "error", message: err });
      return;
    }
    const schema = parsed as PipelineSchema;
    onLoad(schema);
    setStatus({
      kind: "ok",
      message: `Loaded "${schema.pipeline.name}" from ${sourceLabel} (${schema.stages.length} stages)`,
    });
  };

  const handleLoadFromText = () => {
    if (!text.trim()) {
      setStatus({ kind: "error", message: "Paste a pipeline schema first" });
      return;
    }
    tryLoad(text, "pasted JSON");
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    const raw = await file.text();
    setText(raw);
    tryLoad(raw, file.name);
  };

  const handleSample = (entry: SamplePipelineEntry) => {
    onLoad(entry.schema);
    setText(JSON.stringify(entry.schema, null, 2));
    setStatus({
      kind: "ok",
      message: `Loaded sample "${entry.label}" (${entry.schema.stages.length} stages)`,
    });
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Pipeline I/O</h2>
        <p className="mt-1 text-xs text-gray-500">
          Pick a sample, or paste / upload a saved pipeline schema to render
          it on the canvas.
        </p>
      </div>

      {samples && samples.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            <Sparkles className="h-3 w-3" />
            <span>Sample pipelines</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {samples.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSample(s)}
                title={s.description ?? s.label}
                className="flex flex-col items-start gap-0.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-left text-sm shadow-sm transition-colors hover:border-blue-400 hover:bg-blue-50/40"
              >
                <span className="font-medium text-gray-900">{s.label}</span>
                {s.description && (
                  <span className="text-[11px] text-gray-500">
                    {s.description}
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Load your own
        </div>

        <label className="inline-flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50">
          <Upload className="h-4 w-4" />
          Upload .json
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              handleFile(e.target.files?.[0] ?? null);
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
        </label>

        <div className="text-center text-[11px] uppercase tracking-wide text-gray-400">
          or paste
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          spellCheck={false}
          placeholder='{ "version": "1.0", "pipeline": { ... }, "stages": [ ... ], "layout": { ... } }'
          className="min-h-[160px] w-full resize-none rounded-md border border-gray-300 bg-white p-2 font-mono text-[11px] text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <button
          type="button"
          onClick={handleLoadFromText}
          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800"
        >
          <FileJson className="h-4 w-4" />
          Load pipeline
        </button>
      </section>

      {status.kind === "error" && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{status.message}</span>
        </div>
      )}
      {status.kind === "ok" && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{status.message}</span>
        </div>
      )}
    </div>
  );
}
