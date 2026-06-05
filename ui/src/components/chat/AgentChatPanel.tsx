import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Mic,
  MicOff,
  Send,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import AudioVisualizer from "@/components/voice/AudioVisualizer";
import { cn } from "@/lib/Utils";
import type { ConnectionState, TraceMessage } from "@/types/ws";

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
  /** Whether MongoDB Atlas is actually reachable. Drives the empty-state
   *  guidance — there's no point typing a database query if Atlas is down. */
  atlasConnected: boolean;
  /** Full Atlas connection state. Lets the empty state distinguish
   *  "warming up" (during the MCP cold-start probe) from "disconnected"
   *  (no connection string configured) so the user sees the right hint. */
  atlasState: ConnectionState;
  /**
   * Show the text-input + Send button below the chat. On by default in the
   * text-first UX. Toggle in Settings → Chat Panel.
   */
  enableTextInput: boolean;
  /** When false, hide all voice/audio chrome — visualizer, speaking pill, etc. */
  voiceMode: boolean;
  /**
   * Voice capture state from `useVoiceCapture`. Only consulted when
   * `voiceMode` is true.
   */
  voice: {
    state: "idle" | "requesting-mic" | "listening" | "speaking" | "error";
    muted: boolean;
    setMuted: (v: boolean) => void;
    errorDetail: string | null;
    analyser: React.RefObject<AnalyserNode | null>;
  };
}

/**
 * Demo prompt suggestions shown in the empty chat state. Clicking a chip
 * fills the input field with the first message of that demo — it does NOT
 * auto-send, so the user can review/edit before hitting Enter. This keeps
 * the agent's reasoning fully interactive while saving judges typing time.
 */
const DEMO_PROMPTS: Array<{ label: string; prompt: string; hint: string }> = [
  {
    label: "Vibes search",
    prompt:
      "Find me movies about lone cowboys, ruthless outlaws, and dusty gunfights.",
    hint: "Demo 1 — conceptual search via $match + $text on movies",
  },
  {
    label: "Join + branch",
    prompt: "Find all comments by Ned Stark.",
    hint: "Demo 2 — open with a filter, then ask for joins and branches",
  },
  {
    label: "BI analytics",
    prompt: "Find all movies directed by Christopher Nolan.",
    hint: "Demo 3 — open with a director match, then group / sort / round",
  },
];

export function AgentChatPanel({
  entries,
  onSendText,
  busy,
  connected,
  atlasConnected,
  atlasState,
  enableTextInput,
  voiceMode,
  voice,
}: AgentChatPanelProps) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length, busy]);

  // Auto-focus the most recent tool-call card — but only AFTER the agent
  // finishes its current turn. While `busy` is true the timeline is still
  // unfolding and auto-expanding the latest step would shift the user's
  // view on every new event. Once the turn completes, the last tool call's
  // result expands so the data is in view without clicking.
  // Users can still manually expand any card at any time; manual toggles
  // persist across busy → idle transitions.
  const focusedToolEntryId = useMemo(() => {
    if (busy) return null;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (
        e.kind === "trace" &&
        (e.trace.kind === "tool_call_start" ||
          e.trace.kind === "tool_call_result")
      ) {
        return e.id;
      }
    }
    return null;
  }, [entries, busy]);

  // Context-aware label for the busy indicator. Reads the most recent
  // trace entry: if a tool call is in flight, show what's running. If a
  // tool just finished, name it so the user knows the agent is between
  // steps (not stuck). Iteration count is appended so multi-step turns
  // feel like they're progressing.
  const busyLabel = useMemo(() => {
    if (!busy) return null;
    // Count tool calls dispatched since the most recent user message
    // (rough proxy for "iterations in this turn").
    let toolCount = 0;
    let lastResultName: string | null = null;
    let lastResultError = false;
    let lastResultDurationMs: number | null = null;
    let inFlightLabel: string | null = null;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.kind === "user_text" || e.kind === "user_audio") break;
      if (e.kind !== "trace") continue;
      if (e.trace.kind === "tool_call_start") {
        toolCount += 1;
        if (inFlightLabel === null && lastResultName === null) {
          // This start has no later matching result → still in flight.
          const name = e.trace.label ?? "tool";
          const para = paraphraseCustomTool(name, true, false);
          inFlightLabel = para ?? `Calling ${name}`;
        }
      } else if (e.trace.kind === "tool_call_result" && lastResultName === null) {
        lastResultName = e.trace.label ?? "tool";
        lastResultError = !!e.trace.isError;
        lastResultDurationMs =
          typeof e.trace.durationMs === "number" ? e.trace.durationMs : null;
      }
    }
    const suffix = toolCount > 0 ? ` · step ${toolCount}` : "";
    if (inFlightLabel) return `${inFlightLabel}…${suffix}`;
    if (lastResultName) {
      const para = paraphraseCustomTool(lastResultName, false, lastResultError);
      const label = para ?? `Called ${lastResultName}`;
      const verb = lastResultError ? "recovering" : "deciding next step";
      const latency =
        lastResultDurationMs != null ? ` · ${lastResultDurationMs}ms` : "";
      return `${label} · ${verb}…${suffix}${latency}`;
    }
    return "Thinking…";
  }, [entries, busy]);

  const submitText = () => {
    const text = draft.trim();
    if (!text || !connected || busy) return;
    onSendText(text);
    setDraft("");
  };

  const micArmed = voice.state === "listening" || voice.state === "speaking";

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white">
      {/* Visualizer + speaking/muted pills — only when voice mode is on. */}
      {voiceMode && (
        <div className="shrink-0 border-b border-slate-200 p-3">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              You
            </span>
            {voice.state === "speaking" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />
                speaking
              </span>
            )}
            <button
              type="button"
              onClick={() => voice.setMuted(!voice.muted)}
              disabled={voice.state === "error"}
              title={
                voice.state === "error"
                  ? voice.errorDetail ?? "Microphone unavailable"
                  : voice.muted
                    ? "Unmute mic"
                    : "Mute mic"
              }
              className={cn(
                "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                voice.muted
                  ? "bg-rose-50 text-rose-700 hover:bg-rose-100"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {voice.muted ? (
                <>
                  <MicOff className="h-3 w-3" />
                  Unmute
                </>
              ) : (
                <>
                  <Mic className="h-3 w-3" />
                  Mute
                </>
              )}
            </button>
          </div>
          <AudioVisualizer
            analyser={voice.analyser.current}
            color={[156, 39, 176]}
            colorEnd={[66, 133, 244]}
            label=""
            active={micArmed && !voice.muted}
          />
        </div>
      )}

      {/* Timeline */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {entries.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
            {!connected ? (
              <div className="space-y-1.5 text-xs text-slate-400">
                <p className="font-medium text-slate-500">Not connected yet.</p>
                <p>
                  Click{" "}
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-700">
                    Connect
                  </span>{" "}
                  in the header to start a session.
                </p>
              </div>
            ) : atlasState === "connecting" ? (
              <div className="space-y-1.5 text-xs text-slate-400">
                <p className="inline-flex items-center gap-1.5 font-medium text-slate-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Warming up MongoDB connection…
                </p>
                <p>
                  The MCP server takes a few seconds to spawn on a cold
                  start. The demo chips below stay disabled until Atlas is
                  reachable.
                </p>
              </div>
            ) : atlasState === "error" ? (
              <div className="space-y-1.5 text-xs text-slate-400">
                <p className="font-medium text-rose-600">
                  MongoDB Atlas hit an error.
                </p>
                <p>
                  Hover the red <span className="font-mono">Atlas</span> pill
                  in the header for details, then open Settings{" "}
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                    ⚙
                  </span>{" "}
                  → Connection to fix the URI.
                </p>
              </div>
            ) : !atlasConnected ? (
              <div className="space-y-1.5 text-xs text-slate-400">
                <p className="font-medium text-slate-500">
                  MongoDB Atlas isn't connected.
                </p>
                <p>
                  Open Settings{" "}
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                    ⚙
                  </span>{" "}
                  → Connection and paste your Atlas URI. The agent can still
                  design pipelines on the canvas, but it can't run queries
                  yet.
                </p>
              </div>
            ) : (
              <div className="space-y-1 text-xs text-slate-400">
                <p>
                  {voiceMode
                    ? "Talk or type to build a pipeline."
                    : "Type a request to build a pipeline."}
                </p>
                <p>Or pick one of the demos below to get started:</p>
              </div>
            )}

            {connected && atlasConnected && (
              <div className="flex w-full flex-col gap-1.5">
                {DEMO_PROMPTS.map((d) => (
                  <button
                    key={d.label}
                    type="button"
                    onClick={() => setDraft(d.prompt)}
                    title={d.hint}
                    className="group flex w-full flex-col gap-0.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition-colors hover:border-blue-300 hover:bg-blue-50"
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-600">
                      {d.label}
                    </span>
                    <span className="text-xs text-slate-700">
                      "{d.prompt}"
                    </span>
                    <span className="text-[10px] italic text-slate-400 group-hover:text-slate-500">
                      {d.hint}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="space-y-2">
          {entries.map((e) => (
            <TimelineEntry
              key={e.id}
              entry={e}
              focusedToolEntryId={focusedToolEntryId}
            />
          ))}
          {busy && busyLabel && (
            <div className="flex items-center gap-2.5 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-700">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="font-medium">{busyLabel}</span>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* Composer — primary input. Larger font + taller hit target since
          this is how most users will interact with the agent. */}
      {enableTextInput && (
        <div className="shrink-0 border-t border-slate-200 bg-slate-50/50 px-3 py-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  // submitText() is itself a no-op while busy, so the
                  // Enter key is implicitly blocked until the agent is
                  // ready for the next turn.
                  submitText();
                }
              }}
              placeholder={
                connected
                  ? voiceMode
                    ? "Speak, or type a message…"
                    : "Type a message…"
                  : "Connect to start chatting"
              }
              // Keep the input enabled even while the agent is busy so the
              // user can compose their next request without waiting. The
              // Send button is still gated on `busy` so they can't actually
              // submit mid-turn.
              disabled={!connected}
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
            />
            <button
              type="button"
              onClick={submitText}
              disabled={!connected || busy || !draft.trim()}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
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

function TimelineEntry({
  entry,
  focusedToolEntryId,
}: {
  entry: ChatEntry;
  focusedToolEntryId: string | null;
}) {
  if (entry.kind === "user_text") {
    return (
      <div className="max-w-[92%] self-end rounded-[10px] rounded-br-[3px] bg-[#e8f0fe] px-3 py-2 text-sm leading-snug text-slate-900">
        <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          You
        </div>
        <div className="whitespace-pre-wrap break-words">{entry.text}</div>
      </div>
    );
  }
  if (entry.kind === "user_audio") {
    return (
      <div className="max-w-[92%] self-end rounded-[10px] rounded-br-[3px] bg-[#e8f0fe] px-3 py-2 text-sm text-slate-900">
        <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          You — voice
        </div>
        <div className="inline-flex items-center gap-1.5 text-xs italic text-slate-600">
          <Mic className="h-3.5 w-3.5" />
          {fmtDuration(entry.durationMs)} sent
        </div>
      </div>
    );
  }
  return (
    <TraceEntry
      trace={entry.trace}
      focused={entry.id === focusedToolEntryId}
    />
  );
}

function TraceEntry({
  trace,
  focused,
}: {
  trace: TraceMessage;
  focused: boolean;
}) {
  if (trace.kind === "agent_text" && trace.text) {
    return (
      <div className="max-w-[92%] self-start rounded-[10px] rounded-bl-[3px] bg-[#f3e8fd] px-3 py-2 text-sm leading-snug text-slate-900">
        <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Gemini
        </div>
        <div className="whitespace-pre-wrap break-words">{trace.text}</div>
      </div>
    );
  }
  if (trace.kind === "user_text" && trace.text) {
    return (
      <div className="max-w-[92%] self-end rounded-[10px] rounded-br-[3px] bg-[#e8f0fe] px-3 py-2 text-sm leading-snug text-slate-900">
        <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          You — voice
        </div>
        <div className="whitespace-pre-wrap break-words">{trace.text}</div>
      </div>
    );
  }
  if (trace.kind === "tool_call_start" || trace.kind === "tool_call_result") {
    return <ToolCallLine trace={trace} focused={focused} />;
  }
  if (trace.kind === "turn_complete") {
    return (
      <div className="flex items-center gap-2 py-1 text-[11px] text-slate-400">
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
      <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 font-mono text-xs text-rose-700">
        ⚠ {trace.text}
      </div>
    );
  }
  if (trace.kind === "info" && (trace.text || trace.label)) {
    // The "thinking" info trace is fully redundant with the violet busy
    // pill at the bottom of the panel, which already shows "Thinking…"
    // (and switches to context-aware labels once tools start firing).
    // Drop it from the timeline entirely.
    if (trace.label === "thinking") return null;
    return (
      <div className="font-mono text-[11px] italic text-slate-400">
        {trace.label ? `[${trace.label}] ` : ""}
        {trace.text}
      </div>
    );
  }
  return null;
}

function ToolCallLine({
  trace,
  focused,
}: {
  trace: TraceMessage;
  focused: boolean;
}) {
  const isStart = trace.kind === "tool_call_start";
  const isError = !!trace.isError;
  const toolName = trace.label ?? "tool";
  // Custom UI tools (our internal canvas/results plumbing) get a readable
  // paraphrase — they're conceptually "doing something to the workspace",
  // not "calling an API". MCP tools (aggregate, find, list-collections, …)
  // keep their exact tool name so the user sees what's actually being
  // called against MongoDB.
  const paraphrase = paraphraseCustomTool(toolName, isStart, isError);

  if (isStart) {
    return (
      <StepLine
        icon="🛠️"
        toolName={toolName}
        paraphrase={paraphrase}
        verb="Calling"
        payloadLabel="args"
        payload={trace.payload}
        tone="progress"
      />
    );
  }

  return (
    <ResultCard
      toolName={toolName}
      paraphrase={paraphrase}
      isError={isError}
      args={trace.args}
      result={trace.payload}
      durationMs={trace.durationMs}
      focused={focused}
    />
  );
}

const CUSTOM_TOOL_VERBS: Record<
  string,
  { starting: string; done: string; failed: string }
> = {
  update_canvas: {
    starting: "Updating canvas",
    done: "Canvas updated",
    failed: "Canvas update failed",
  },
  push_results: {
    starting: "Loading results into panel",
    done: "Results loaded",
    failed: "Results push failed",
  },
};

/** Return a readable paraphrase for a custom UI tool, or null for MCP /
 *  unknown tools (caller should fall back to "Calling [toolName]"). */
function paraphraseCustomTool(
  name: string,
  isStart: boolean,
  isError: boolean,
): string | null {
  const entry = CUSTOM_TOOL_VERBS[name];
  if (!entry) return null;
  if (isStart) return entry.starting;
  if (isError) return entry.failed;
  return entry.done;
}

/** Compact one-line step — used for tool_call_start events. Renders either
 *  the paraphrase (custom tools) or "Calling [tool_name]…" (MCP tools). */
function StepLine({
  icon,
  toolName,
  paraphrase,
  verb,
  payloadLabel,
  payload,
  tone,
}: {
  icon: string;
  toolName: string;
  paraphrase: string | null;
  verb: string;
  payloadLabel: string;
  payload: unknown;
  tone: "progress" | "ok" | "error";
}) {
  const [open, setOpen] = useState(false);
  const hasPayload = payload !== undefined;
  const toneClass =
    tone === "error"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : tone === "ok"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <div className={cn("rounded-md border px-2.5 py-1.5 font-mono text-xs", toneClass)}>
      <button
        type="button"
        onClick={() => hasPayload && setOpen((v) => !v)}
        disabled={!hasPayload}
        className="flex w-full items-center gap-1.5 text-left disabled:cursor-default"
      >
        {hasPayload ? (
          open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          )
        ) : (
          <span className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="shrink-0">{icon}</span>
        {paraphrase ? (
          <span className="truncate">
            {paraphrase}
            <span className="text-slate-400">…</span>
          </span>
        ) : (
          <>
            <span className="shrink-0">{verb}</span>
            <span className="truncate font-semibold text-violet-700">
              {toolName}
            </span>
            <span className="shrink-0 text-slate-400">…</span>
          </>
        )}
      </button>
      {open && hasPayload && (
        <div className="mt-1.5">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">
            {payloadLabel}
          </div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 text-xs leading-snug text-slate-700">
            {tryStringify(payload)}
          </pre>
        </div>
      )}
    </div>
  );
}

/** Larger card for completed tool calls. Header reads either the readable
 *  paraphrase ("✅ Canvas updated") for custom UI tools, or "✅ Called
 *  [toolName]" for MCP tools. Renders args + result on expand; the most
 *  recent result auto-expands. */
function ResultCard({
  toolName,
  paraphrase,
  isError,
  args,
  result,
  durationMs,
  focused,
}: {
  toolName: string;
  paraphrase: string | null;
  isError: boolean;
  args: unknown;
  result: unknown;
  durationMs?: number;
  focused: boolean;
}) {
  const [manual, setManual] = useState<boolean | null>(null);
  useEffect(() => {
    if (!focused) setManual(null);
  }, [focused]);
  const open = manual !== null ? manual : focused;
  const icon = isError ? "❌" : "✅";
  const verb = isError ? "" : "Called";
  const toneClass = isError
    ? "border-rose-200 bg-rose-50 text-rose-800"
    : "border-emerald-200 bg-emerald-50 text-emerald-800";
  return (
    <div className={cn("rounded-md border px-2.5 py-1.5 font-mono text-xs", toneClass)}>
      <button
        type="button"
        onClick={() => setManual(!open)}
        className="flex w-full items-center gap-1.5 text-left"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        )}
        <span className="shrink-0">{icon}</span>
        {paraphrase ? (
          <span className="truncate">{paraphrase}</span>
        ) : (
          <>
            {verb && <span className="shrink-0">{verb}</span>}
            <span className="truncate font-semibold text-violet-700">
              {toolName}
            </span>
            {isError && <span className="shrink-0">failed</span>}
          </>
        )}
        {typeof durationMs === "number" && (
          <span className="shrink-0 text-slate-400">· {durationMs}ms</span>
        )}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {args !== undefined && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-400">
                args
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 text-xs leading-snug text-slate-700">
                {tryStringify(args)}
              </pre>
            </div>
          )}
          {result !== undefined && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-400">
                {isError ? "error" : "result"}
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 text-xs leading-snug text-slate-700">
                {tryStringify(result)}
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
