import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Mic,
  MicOff,
  RotateCcw,
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
  /** Clear the timeline and start a fresh chat (keeps the connection). The
   *  host also resets the canvas/results and tells the server to wipe the
   *  agent's memory. */
  onClearChat: () => void;
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
  /** When false, hide ALL suggestion chips — the hardcoded demo openers in
   *  the empty state AND any agent-suggested follow-ups after each turn.
   *  Mirrors the server-side flag passed via the init message. */
  enableSuggestedPrompts: boolean;
  /** Auto-send a chip's prompt when clicked instead of just filling the
   *  composer. Mirrored from `useSettings.autoSendSuggestion` so changing
   *  the checkbox in chat takes effect across the app. */
  autoSendSuggestion: boolean;
  onAutoSendSuggestionChange: (v: boolean) => void;
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
 * Hardcoded demo scripts. Each demo is an ordered list of user-input
 * sentences. The chat panel uses these for two things:
 *   1. Empty state: render the FIRST step of each demo as an opener chip.
 *   2. Post-turn: if the user's last prompt matches step N of a demo
 *      (via exact-text match), render step N+1 as the leading chip
 *      alongside Gemini's `suggest_next_prompts` chips.
 *
 * Keep the prompt strings character-identical to the hackathon script so
 * exact-text matching works without fuzzy fallbacks.
 */
interface DemoFlow {
  id: "vibes" | "join" | "bi";
  /** Long human-readable name, used only for the empty-state opener chip
   *  ("Demo 1 · Vibes search"). */
  displayName: string;
  steps: Array<{
    /** Very short chip caption (1-4 words). Mirrors the style of Gemini's
     *  `suggest_next_prompts` labels so the hardcoded next-step chip
     *  visually blends with the AI-generated ones. */
    label: string;
    /** The actual user-input sentence dispatched when the chip is clicked. */
    prompt: string;
  }>;
}

const DEMO_FLOWS: DemoFlow[] = [
  {
    id: "vibes",
    displayName: "Demo 1 · Vibes search",
    steps: [
      {
        label: "Find by vibe",
        prompt:
          "Find me movies about lone cowboys, ruthless outlaws, and dusty gunfights from the embedded_movies collection",
      },
      {
        label: "Filter year >2000",
        prompt: "Filter to movies after the year 2000.",
      },
      {
        label: "Project fields",
        prompt:
          "Clean the result to only show the title, the year, the genres, and the plot.",
      },
    ],
  },
  {
    id: "join",
    displayName: "Demo 2 · Join + branch",
    steps: [
      {
        label: "Find user comments",
        prompt: "Find all comments by Ned Stark.",
      },
      { label: "Join movies", prompt: "Join the movie details to his comments." },
      {
        label: "Filter recent",
        prompt:
          "Filter to movies after 2000, and show just the title and comment.",
      },
      {
        label: "Branch by genre",
        prompt:
          "Create a second branch from the join: group by genre and count the reviews.",
      },
    ],
  },
  {
    id: "bi",
    displayName: "Demo 3 · BI analytics",
    steps: [
      {
        label: "Filter director",
        prompt: "Find all movies directed by Christopher Nolan.",
      },
      {
        label: "Group by year",
        prompt:
          "Group his movies by release year. For each year, calculate his average IMDB rating and the total number of awards won.",
      },
      {
        label: "Sort & round",
        prompt:
          "Sort the results chronologically by year, and round the average rating to one decimal place.",
      },
    ],
  },
];

/** Find a demo + step index whose `prompt` matches the given text exactly
 *  (case-insensitive trim). Returns `null` when the user wrote free-form
 *  text that doesn't follow any demo. */
function matchDemoStep(
  text: string,
): { demoId: DemoFlow["id"]; stepIndex: number } | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;
  for (const demo of DEMO_FLOWS) {
    for (let i = 0; i < demo.steps.length; i++) {
      if (demo.steps[i].prompt.trim().toLowerCase() === normalized) {
        return { demoId: demo.id, stepIndex: i };
      }
    }
  }
  return null;
}

/** First-step chips shown in the empty chat state — one opener per demo.
 *  Uses the demo's long display name + a short hint string so the user
 *  can see which demo they're starting before clicking. */
const DEMO_OPENERS = DEMO_FLOWS.map((d) => ({
  label: d.displayName,
  prompt: d.steps[0].prompt,
  hint: `${d.steps[0].label} — start the flow`,
}));

export function AgentChatPanel({
  entries,
  onSendText,
  onClearChat,
  busy,
  connected,
  atlasConnected,
  atlasState,
  enableSuggestedPrompts,
  autoSendSuggestion,
  onAutoSendSuggestionChange,
  enableTextInput,
  voiceMode,
  voice,
}: AgentChatPanelProps) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  /**
   * Unified chip-click handler used by both the hardcoded demo openers and
   * the agent-suggested follow-ups. Behavior depends on
   * `autoSendSuggestion`: when on, dispatch immediately; when off (default)
   * just fill the composer so the user reviews/edits before sending.
   */
  const handleChipClick = (prompt: string) => {
    if (autoSendSuggestion && connected && !busy && prompt.trim()) {
      onSendText(prompt);
      setDraft("");
    } else {
      setDraft(prompt);
    }
  };

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
  // Most recent agent-suggested follow-up chips since the last user message.
  // We walk the timeline back to either a `suggested_prompts` trace or a user
  // input boundary, so each turn cleanly replaces the prior turn's chips and
  // the user starting a new turn (last entry becomes user_text/user_audio)
  // makes the chips disappear.
  const agentSuggestions = useMemo<
    Array<{ label: string; prompt: string }> | null
  >(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.kind === "user_text" || e.kind === "user_audio") return null;
      if (e.kind === "trace" && e.trace.kind === "suggested_prompts") {
        const list = Array.isArray(e.trace.prompts) ? e.trace.prompts : [];
        const valid = list.filter(
          (p) =>
            p &&
            typeof p.label === "string" &&
            p.label.trim() !== "" &&
            typeof p.prompt === "string" &&
            p.prompt.trim() !== "",
        );
        return valid.length > 0 ? valid : null;
      }
    }
    return null;
  }, [entries]);

  /**
   * Find the most-recent user message in the timeline. If its text
   * matches step K of one of the hardcoded demos, return the demo + step
   * — used below to surface step K+1 as a hardcoded chip alongside
   * Gemini's suggestions.
   */
  const activeDemoStep = useMemo<
    { demoId: DemoFlow["id"]; stepIndex: number } | null
  >(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.kind === "user_text") return matchDemoStep(e.text);
      if (
        e.kind === "trace" &&
        e.trace.kind === "user_text" &&
        typeof e.trace.text === "string"
      ) {
        return matchDemoStep(e.trace.text);
      }
      if (e.kind === "user_audio") return null;
    }
    return null;
  }, [entries]);

  /**
   * The chip set actually rendered post-turn. Composition: if the user is
   * mid-demo and the next step exists, prepend that as the leading chip.
   * Fill remaining slots from Gemini's suggestions, deduplicating against
   * the hardcoded step's prompt. Cap at 3 total chips.
   */
  const combinedChips = useMemo<
    Array<{ label: string; prompt: string; hint?: string }>
  >(() => {
    const out: Array<{ label: string; prompt: string; hint?: string }> = [];

    if (activeDemoStep) {
      const demo = DEMO_FLOWS.find((d) => d.id === activeDemoStep.demoId);
      const next = demo?.steps[activeDemoStep.stepIndex + 1];
      if (demo && next) {
        // Use the step's short label (e.g. "Filter year >2000") so the
        // hardcoded chip looks identical to Gemini-suggested chips — no
        // "Demo 1 · next step" prefix. The user shouldn't care that this
        // chip came from the script vs. from the model.
        out.push({ label: next.label, prompt: next.prompt });
      }
    }

    if (agentSuggestions) {
      const seen = new Set(out.map((c) => c.prompt.trim().toLowerCase()));
      for (const s of agentSuggestions) {
        const key = s.prompt.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ label: s.label, prompt: s.prompt });
        if (out.length >= 3) break;
      }
    }

    return out;
  }, [activeDemoStep, agentSuggestions]);

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

      {/* Clear / new-chat bar — only once the conversation has started, so
          the empty state stays clean. Keeps the WebSocket open; the host
          resets the canvas/results and the server's agent memory. */}
      {entries.length > 0 && (
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Chat
          </span>
          <button
            type="button"
            onClick={onClearChat}
            title="Clear this chat and start over from the demos (keeps the connection)"
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800"
          >
            <RotateCcw className="h-3 w-3" />
            Reset chat
          </button>
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
                {enableSuggestedPrompts && (
                  <p>Or pick one of the demos below to get started:</p>
                )}
              </div>
            )}

            {connected && atlasConnected && enableSuggestedPrompts && (
              <ChipStrip
                title="Pick a demo to start"
                prompts={DEMO_OPENERS}
                onPick={handleChipClick}
                autoSendSuggestion={autoSendSuggestion}
                onAutoSendSuggestionChange={onAutoSendSuggestionChange}
                disabled={busy}
              />
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
          {/* Post-turn chip strip. The composition (see `combinedChips`
              memo above) is: if the user's most recent message matched
              step K of a demo, the FIRST chip is step K+1 of the same
              demo; the remaining chips are taken from Gemini's
              `suggest_next_prompts` reply, capped to 3 total. If no demo
              is active, all chips come from Gemini. Hidden during `busy`
              and during the empty state. */}
          {!busy &&
            enableSuggestedPrompts &&
            entries.length > 0 &&
            connected &&
            atlasConnected &&
            combinedChips.length > 0 && (
              <ChipStrip
                title="What's next?"
                prompts={combinedChips}
                onPick={handleChipClick}
                autoSendSuggestion={autoSendSuggestion}
                onAutoSendSuggestionChange={onAutoSendSuggestionChange}
                disabled={busy}
              />
            )}
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

/**
 * Reusable strip of suggestion chips. Renders the title, an optional
 * "send immediately on click" checkbox, and a vertical list of chip
 * buttons. Used for both the hardcoded demo openers and the Gemini-
 * suggested follow-ups so the two render with identical chrome.
 */
function ChipStrip({
  title,
  prompts,
  onPick,
  autoSendSuggestion,
  onAutoSendSuggestionChange,
  disabled,
  hideToggle,
}: {
  title: string;
  prompts: Array<{ label: string; prompt: string; hint?: string }>;
  onPick: (prompt: string) => void;
  autoSendSuggestion: boolean;
  onAutoSendSuggestionChange: (v: boolean) => void;
  disabled?: boolean;
  /** When true (e.g. on a secondary strip below the primary one), don't
   *  re-render the auto-send checkbox — one toggle is enough. */
  hideToggle?: boolean;
}) {
  if (prompts.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          {title}
        </span>
        {!hideToggle && (
          <label className="flex cursor-pointer select-none items-center gap-1 text-[10px] text-slate-500">
            <input
              type="checkbox"
              checked={autoSendSuggestion}
              onChange={(e) => onAutoSendSuggestionChange(e.target.checked)}
              className="h-3 w-3 cursor-pointer rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            send immediately on click
          </label>
        )}
      </div>
      <div className="flex w-full flex-col gap-1.5">
        {prompts.map((p, i) => (
          <button
            key={`${i}-${p.label}`}
            type="button"
            onClick={() => onPick(p.prompt)}
            title={p.hint ?? p.prompt}
            disabled={disabled}
            className="group flex w-full flex-col gap-0.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition-colors hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-600">
              {p.label}
            </span>
            <span className="text-xs text-slate-700">"{p.prompt}"</span>
            {p.hint && (
              <span className="text-[10px] italic text-slate-400 group-hover:text-slate-500">
                {p.hint}
              </span>
            )}
          </button>
        ))}
      </div>
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
  if (trace.kind === "suggested_prompts") {
    // Rendered as a chip strip below the timeline, not inline — return null
    // here so the trace doesn't double-up as an italic debug line.
    return null;
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
    // "thinking" info traces come in two flavors:
    //   - the turn-start "Thinking…" milestone (no duration): redundant with
    //     the violet busy pill at the bottom, so drop it.
    //   - a "Thought for Xs" pill (carries durationMs): emitted right before
    //     the agent's text reply to show how long it reasoned. Render it as a
    //     small persistent pill in the timeline.
    if (trace.label === "thinking") {
      if (typeof trace.durationMs === "number") {
        return (
          <div className="flex">
            <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
              <span className="text-violet-400">✦</span>
              Thought for {fmtDuration(trace.durationMs)}
            </span>
          </div>
        );
      }
      return null;
    }
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
    starting: "Updating the pipeline diagram",
    done: "Pipeline diagram updated",
    failed: "Pipeline diagram update failed",
  },
  push_results: {
    starting: "Loading results into the panel",
    done: "Results loaded",
    failed: "Couldn't push results",
  },
  run_pipeline: {
    starting: "Running the pipeline against MongoDB",
    done: "Pipeline run finished",
    failed: "Pipeline run failed",
  },
  suggest_next_prompts: {
    starting: "Preparing follow-up suggestions",
    done: "Follow-up suggestions ready",
    failed: "Couldn't prepare suggestions",
  },
};

/** Names of the MongoDB MCP tools we expose through ADK's `MCPToolset`.
 *  Mirrors the server-side `MCP_TOOLS_ALLOWLIST` in `agentLoop.ts`. Used
 *  here to render a "Mongo MCP" badge next to the tool name so users can
 *  tell at a glance whether a step touched the database. */
const MCP_TOOL_NAMES = new Set([
  "list-databases",
  "list-collections",
  "collection-schema",
  "find",
  "count",
  "aggregate",
]);

function isMcpToolName(name: string): boolean {
  return MCP_TOOL_NAMES.has(name);
}

/** Return a readable paraphrase for a custom tool, or null for MCP /
 *  unknown tools (caller falls back to the tool name + MCP badge). */
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

/** Compact one-line step — used for tool_call_start events.
 *  - Custom tool with a paraphrase: shows only natural-language text
 *    ("Updating the pipeline diagram…"). The tool name is hidden.
 *  - MCP tool: shows the raw tool name in monospace + a small "Mongo MCP"
 *    badge so users see exactly what's being called against the database. */
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
  const isMcp = isMcpToolName(toolName);
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
            {isMcp && <McpBadge />}
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

/** Small purple pill rendered next to MCP-tool names so the user can see
 *  at a glance which trace lines touched MongoDB through the MCP server. */
function McpBadge() {
  return (
    <span
      className="ml-1 shrink-0 rounded bg-violet-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-violet-700"
      title="Tool exposed by the MongoDB MCP server"
    >
      Mongo MCP
    </span>
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
            {isMcpToolName(toolName) && <McpBadge />}
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
