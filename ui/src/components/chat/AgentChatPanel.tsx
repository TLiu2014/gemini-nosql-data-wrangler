import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Mic,
  Send,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import AudioVisualizer from "@/components/voice/AudioVisualizer";
import { cn } from "@/lib/Utils";
import type { TraceMessage } from "@/types/ws";

/**
 * One entry in the visible chat timeline. We surface the user's own messages
 * (typed or voice clip) and selected trace events from the agent — tool calls
 * collapsed by default, agent text rendered as bubbles, info/error rendered
 * as compact log lines.
 */
export type ChatEntry =
  | {
      kind: "user_text";
      text: string;
      ts: number;
      id: string;
    }
  | {
      kind: "user_audio";
      durationMs: number;
      ts: number;
      id: string;
    }
  | { kind: "trace"; trace: TraceMessage; id: string };

interface AgentChatPanelProps {
  /** Combined ordered timeline of user inputs + agent trace events. */
  entries: ChatEntry[];
  /** Send a typed message. The panel handles the input field state internally. */
  onSendText: (text: string) => void;
  /** True when the agent is currently processing a turn. */
  busy: boolean;
  /** Whether the WebSocket session is open. Controls input enabled state. */
  connected: boolean;
  /**
   * Show the text-input + Send button below the chat. Off by default — the
   * primary UX is the always-on mic. Toggle in Settings → Chat Panel.
   */
  enableTextInput: boolean;
  /**
   * Always-on voice capture state from `useVoiceCapture`. The panel renders
   * a live waveform when the mic is hot and lets the user mute / unmute.
   */
  voice: {
    state: "idle" | "requesting-mic" | "listening" | "speaking" | "error";
    muted: boolean;
    setMuted: (v: boolean) => void;
    errorDetail: string | null;
    analyser: React.RefObject<AnalyserNode | null>;
  };
}

export function AgentChatPanel({
  entries,
  onSendText,
  busy,
  connected,
  enableTextInput,
  voice,
}: AgentChatPanelProps) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length, busy]);

  const submitText = () => {
    const text = draft.trim();
    if (!text || !connected || busy) return;
    onSendText(text);
    setDraft("");
  };

  const micArmed = voice.state === "listening" || voice.state === "speaking";

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white">
      {/* Visualizer strip — Mute/Unmute lives in the sidebar controls
          row (same place as Connect/Disconnect) per the pre-refactor look. */}
      <div className="shrink-0 border-b border-slate-200 p-3">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            You
          </span>
          {voice.state === "speaking" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />
              speaking
            </span>
          )}
          {voice.muted && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              muted
            </span>
          )}
        </div>
        <AudioVisualizer
          analyser={voice.analyser.current}
          color={[156, 39, 176]}
          colorEnd={[66, 133, 244]}
          label=""
          active={micArmed && !voice.muted}
        />
      </div>

      {/* Timeline */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {entries.length === 0 && (
          <div className="flex h-full items-center justify-center px-4 text-center">
            <div className="space-y-2 text-[11px] text-slate-400">
              <p>Just speak — the mic is on whenever you're connected.</p>
              <p>
                Try:{" "}
                <span className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10.5px] text-slate-600">
                  load embedded_movies
                </span>
              </p>
            </div>
          </div>
        )}
        <div className="space-y-2">
          {entries.map((e) => (
            <TimelineEntry key={e.id} entry={e} />
          ))}
          {busy && (
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2 py-1 text-[11px] italic text-slate-600">
              <Loader2 className="h-3 w-3 animate-spin" />
              agent thinking…
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* Composer — text fallback for noisy environments. Toggle in Settings. */}
      {enableTextInput && (
        <div className="shrink-0 border-t border-slate-200 bg-slate-50/50 px-3 py-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitText();
                }
              }}
              placeholder={
                connected
                  ? "…or type a message"
                  : "Connect to start chatting"
              }
              disabled={!connected || busy}
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
            />
            <button
              type="button"
              onClick={submitText}
              disabled={!connected || busy || !draft.trim()}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
              title="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineEntry({ entry }: { entry: ChatEntry }) {
  if (entry.kind === "user_text") {
    return (
      <div className="max-w-[92%] self-end rounded-[10px] rounded-br-[3px] bg-[#e8f0fe] px-3 py-1.5 text-sm leading-snug text-slate-900">
        <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          You
        </div>
        <div className="whitespace-pre-wrap break-words">{entry.text}</div>
      </div>
    );
  }
  if (entry.kind === "user_audio") {
    return (
      <div className="max-w-[92%] self-end rounded-[10px] rounded-br-[3px] bg-[#e8f0fe] px-3 py-1.5 text-sm text-slate-900">
        <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          You — voice
        </div>
        <div className="inline-flex items-center gap-1.5 text-xs italic text-slate-600">
          <Mic className="h-3 w-3" />
          {fmtDuration(entry.durationMs)} sent
        </div>
      </div>
    );
  }
  return <TraceEntry trace={entry.trace} />;
}

function TraceEntry({ trace }: { trace: TraceMessage }) {
  if (trace.kind === "agent_text" && trace.text) {
    return (
      <div className="max-w-[92%] self-start rounded-[10px] rounded-bl-[3px] bg-[#f3e8fd] px-3 py-1.5 text-sm leading-snug text-slate-900">
        <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Gemini
        </div>
        <div className="whitespace-pre-wrap break-words">{trace.text}</div>
      </div>
    );
  }
  if (trace.kind === "user_text" && trace.text) {
    // Server-emitted transcription of the user's voice clip — renders as a
    // user bubble so the visual trace shows what the model heard.
    return (
      <div className="max-w-[92%] self-end rounded-[10px] rounded-br-[3px] bg-[#e8f0fe] px-3 py-1.5 text-sm leading-snug text-slate-900">
        <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          You — voice
        </div>
        <div className="whitespace-pre-wrap break-words">{trace.text}</div>
      </div>
    );
  }
  if (trace.kind === "tool_call_start" || trace.kind === "tool_call_result") {
    return <ToolCallLine trace={trace} />;
  }
  if (trace.kind === "turn_complete") {
    return (
      <div className="flex items-center gap-2 py-1 text-[10px] text-slate-400">
        <span className="h-px flex-1 bg-slate-200" />
        <span>
          turn complete
          {typeof trace.durationMs === "number"
            ? ` · ${(trace.durationMs / 1000).toFixed(1)}s`
            : ""}
        </span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>
    );
  }
  if (trace.kind === "error" && trace.text) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 font-mono text-[11px] text-rose-700">
        ⚠ {trace.text}
      </div>
    );
  }
  if (trace.kind === "info" && (trace.text || trace.label)) {
    return (
      <div className="font-mono text-[10.5px] italic text-slate-400">
        {trace.label ? `[${trace.label}] ` : ""}
        {trace.text}
      </div>
    );
  }
  return null;
}

function ToolCallLine({ trace }: { trace: TraceMessage }) {
  const [open, setOpen] = useState(false);
  const isStart = trace.kind === "tool_call_start";
  const isError = !!trace.isError;
  // When the merge produced a tool_call_result with `args` attached, render
  // both sections (input args + output result). For an in-flight start
  // event the args live on `payload`.
  const hasMergedArgs = !isStart && trace.args !== undefined;
  const argsBlock = isStart ? trace.payload : hasMergedArgs ? trace.args : undefined;
  const resultBlock = isStart ? undefined : trace.payload;

  const icon = isStart ? "🛠️" : isError ? "❌" : "✅";
  const label = trace.label ?? "tool";
  const durationLabel =
    !isStart && typeof trace.durationMs === "number"
      ? ` · ${trace.durationMs}ms`
      : "";
  const statusLabel = isStart ? "calling" : isError ? "error" : "called";

  return (
    <div
      className={cn(
        "rounded-md border px-2 py-1 font-mono text-[11px]",
        isError
          ? "border-rose-200 bg-rose-50 text-rose-800"
          : "border-slate-200 bg-slate-50 text-slate-700",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 text-left"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-slate-400" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-slate-400" />
        )}
        <span className="shrink-0">{icon}</span>
        <span className="shrink-0 font-semibold">{statusLabel}</span>
        <span className="truncate text-violet-700">{label}</span>
        <span className="shrink-0 text-slate-400">{durationLabel}</span>
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          {argsBlock !== undefined && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                args
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 text-[10.5px] leading-snug text-slate-700">
                {tryStringify(argsBlock)}
              </pre>
            </div>
          )}
          {resultBlock !== undefined && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                {isError ? "error" : "result"}
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 text-[10.5px] leading-snug text-slate-700">
                {tryStringify(resultBlock)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function tryStringify(value: unknown): string {
  if (value === undefined) return "(no payload)";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
