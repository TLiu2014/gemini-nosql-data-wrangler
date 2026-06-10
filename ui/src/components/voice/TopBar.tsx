import {
  Book,
  Home,
  Plug,
  PlugZap,
  Settings as SettingsIcon,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Settings } from "@/hooks/useSettings";
import type { ConnectionState } from "@/types/ws";
import { cn } from "@/lib/Utils";

interface TopBarProps {
  settings: Settings;
  onSettingsChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  /** Fired when the user clicks Save on API key / Mongo URI inputs. The host
   *  uses it to flash a confirmation message — we render it inline in the
   *  TopBar (replacing the old sidebar StatusBar location). */
  onSaveNotice?: (message: string) => void;
  /** Inline save-confirmation chip rendered next to the status dots. Null
   *  hides it. The host controls the auto-clear timer. */
  saveNotice?: string | null;
  /** Atlas + Gemini connection states, shown as colored dots in the header
   *  instead of the old left-sidebar StatusBar block. */
  atlasConnection: ConnectionState;
  atlasDetail?: string;
  geminiConnection: ConnectionState;
  geminiDetail?: string;
  /** Action handlers for the inline Connect/Disconnect button. */
  isConnected: boolean;
  isConnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

export default function TopBar({
  settings,
  onSettingsChange,
  onSaveNotice,
  saveNotice,
  atlasConnection,
  atlasDetail,
  geminiConnection,
  geminiDetail,
  isConnected,
  isConnecting,
  onConnect,
  onDisconnect,
}: TopBarProps) {
  const [open, setOpen] = useState(false);
  const [draftKey, setDraftKey] = useState(settings.apiKey);
  const [draftMongoUri, setDraftMongoUri] = useState(settings.mongoUri);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setDraftKey(settings.apiKey);
  }, [settings.apiKey]);

  useEffect(() => {
    setDraftMongoUri(settings.mongoUri);
  }, [settings.mongoUri]);

  // Click-outside to dismiss the settings panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        panelRef.current?.contains(e.target as Node) ||
        buttonRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <header
      className="relative flex h-14 shrink-0 items-center justify-between px-5 text-white"
      style={{
        background: "linear-gradient(135deg, #4285f4 0%, #9c27b0 100%)",
      }}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5" />
        <span className="text-base font-semibold tracking-tight">
          AtlasOrbit
        </span>
      </div>

      <div className="flex items-center gap-2">
        {saveNotice && (
          // `tfu-save-notice` runs a one-shot slide-in + soft pulse so the
          // chip catches the eye on appearance instead of sitting passively
          // alongside the status pills. Rendered on every viewport (no `md:`
          // gate) so the user always gets the notice. The icon/prefix lives
          // INSIDE the message string — saves convention "✓ …", warnings
          // convention "⚠ …" — so we don't have to switch chrome here.
          <span
            key={saveNotice}
            className="tfu-save-notice inline-flex max-w-[40vw] items-center gap-1 rounded-full bg-white/25 px-2.5 py-1 text-[11px] font-medium"
            title={saveNotice}
          >
            <span className="hidden truncate sm:inline">{saveNotice}</span>
            <span className="sm:hidden">{saveNotice.slice(0, 1)}</span>
          </span>
        )}
        <StatusPill
          label="Atlas"
          state={atlasConnection}
          detail={atlasDetail}
        />
        <StatusPill
          label="Gemini"
          state={geminiConnection}
          detail={geminiDetail}
        />
        {isConnected ? (
          <button
            type="button"
            onClick={onDisconnect}
            title="Disconnect from agent"
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/15 px-3 text-xs font-medium transition-colors hover:bg-white/25"
          >
            <Plug className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Disconnect</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            disabled={isConnecting}
            title="Connect to agent"
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-400/90 px-3 text-xs font-semibold text-emerald-950 shadow-sm transition-colors hover:bg-emerald-300",
              isConnecting && "cursor-not-allowed opacity-70",
            )}
          >
            <PlugZap className="h-3.5 w-3.5" />
            <span>{isConnecting ? "Connecting…" : "Connect"}</span>
          </button>
        )}
        <Link
          to="/docs"
          className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors hover:bg-white/20"
          title="Agent + tool reference docs"
        >
          <Book className="h-4 w-4" />
          <span className="hidden sm:inline">Docs</span>
        </Link>
        <Link
          to="/"
          className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors hover:bg-white/20"
          title="Back to landing page"
        >
          <Home className="h-4 w-4" />
          <span className="hidden sm:inline">Home</span>
        </Link>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
            open ? "bg-white/30" : "hover:bg-white/20"
          }`}
          title="Settings"
          aria-label="Settings"
        >
          <SettingsIcon className="h-4 w-4" />
        </button>
      </div>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-4 top-14 z-50 flex max-h-[calc(100vh-5rem)] w-[360px] flex-col rounded-lg border border-slate-200 bg-white text-slate-800 shadow-xl"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold">Settings</h3>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close settings"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <GroupHeader>Connection</GroupHeader>
            {/* API key */}
            <section className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                Gemini API Key
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={draftKey}
                  onChange={(e) => setDraftKey(e.target.value)}
                  placeholder="Enter API key…"
                  className="flex-1 rounded border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    onSettingsChange("apiKey", draftKey.trim());
                    onSaveNotice?.("✓ API key saved — reconnect to apply");
                  }}
                  className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-blue-700"
                >
                  Save
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Stored only in this browser session. Get a free key at{" "}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 underline hover:text-blue-700"
                >
                  aistudio.google.com
                </a>
                . Leave blank to use the server's <code>GEMINI_API_KEY</code>.
              </p>
            </section>

            {/* MongoDB URI */}
            <section className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                MongoDB Atlas Connection String
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={draftMongoUri}
                  onChange={(e) => setDraftMongoUri(e.target.value)}
                  placeholder="mongodb+srv://…"
                  className="flex-1 rounded border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    onSettingsChange("mongoUri", draftMongoUri.trim());
                    onSaveNotice?.(
                      "✓ MongoDB connection string saved — reconnect to apply",
                    );
                  }}
                  className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-blue-700"
                >
                  Save
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Stored only in this browser session. Get a free M0 cluster at{" "}
                <a
                  href="https://cloud.mongodb.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 underline hover:text-blue-700"
                >
                  cloud.mongodb.com
                </a>
                {" "}and load the <code>sample_mflix</code> dataset. Leave blank to use the server's <code>MONGODB_URI</code>.
              </p>
            </section>

            {/* Auto-connect — part of the Connection group above. */}
            <section className="space-y-1.5">
              <Check
                checked={settings.autoConnect}
                onChange={(v) => onSettingsChange("autoConnect", v)}
                label="Auto-connect on load"
                hint="Otherwise click Connect in the header (saves free-tier quota)."
              />
            </section>

            <GroupHeader>Canvas</GroupHeader>

            {/* Sample flow */}
            <section className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                Sample Flow
              </label>
              <Radio
                checked={settings.sampleFlow === "none"}
                onChange={() => onSettingsChange("sampleFlow", "none")}
                label="No sample (default)"
                hint="Start with nothing loaded — empty canvas and empty results. The agent builds everything from scratch as you talk. Recommended for live demos."
              />
              <Radio
                checked={settings.sampleFlow === "data"}
                onChange={() => onSettingsChange("sampleFlow", "data")}
                label="Two-source starter"
                hint="Two MQL_SOURCE nodes — embedded_movies and comments — sitting side by side. Useful warm-up for the join + branching demo."
              />
              <Radio
                checked={settings.sampleFlow === "vector"}
                onChange={() => onSettingsChange("sampleFlow", "vector")}
                label="Nolan filmography starter"
                hint="Pre-built 3-stage pipeline matching Demo 3's opening state: source → $match directors → $project. Extend live by asking the agent to group by year, sort, etc."
              />
            </section>

            <GroupHeader>Display</GroupHeader>

            {/* Layout */}
            <section className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                Layout
              </label>
              <Radio
                checked={settings.layoutMode === "stacked"}
                onChange={() => onSettingsChange("layoutMode", "stacked")}
                label="Canvas on top, results below"
                hint="Inside results, the document table is on the left, JSON view on the right."
              />
              <Radio
                checked={settings.layoutMode === "side-by-side"}
                onChange={() => onSettingsChange("layoutMode", "side-by-side")}
                label="Canvas on the left, results on the right"
                hint="Default. Inside results, the document table is on top and the JSON view (if enabled) below — each occupies half the height."
              />
            </section>

            {/* Results panel toggles */}
            <section className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                Results Panel
              </label>
              <Check
                checked={settings.showSchemaJson}
                onChange={(v) => onSettingsChange("showSchemaJson", v)}
                label="Show pipeline schema JSON tab"
                hint="The schema view is useful for debugging; hide it for a cleaner demo."
              />
              <Check
                checked={settings.showMflixCollections}
                onChange={(v) => onSettingsChange("showMflixCollections", v)}
                label="Show Mflix collections reference tab"
                hint="Static catalog of sample_mflix collections (movies, comments, users, theaters, ...) with example documents — useful for showing what data is available."
              />
              <Check
                checked={settings.showResultsJsonPane}
                onChange={(v) => onSettingsChange("showResultsJsonPane", v)}
                label="Show JSON pane next to document tree"
                hint="Off by default. The tree already shows every field; turn this on if you want a side-by-side raw JSON view of all rows. Per-row 'View raw' on each card is always available."
              />
            </section>

            {/* Chat panel — display section continues. */}
            <section className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                Chat Panel
              </label>
              <Check
                checked={settings.enableTextInput}
                onChange={(v) => onSettingsChange("enableTextInput", v)}
                label="Enable text message input"
                hint="Shows the text box + Send button below the agent chat. On by default — this is now the primary input."
              />
              <Check
                checked={settings.enableSuggestedPrompts}
                onChange={(v) =>
                  onSettingsChange("enableSuggestedPrompts", v)
                }
                label="Suggest follow-up prompts"
                hint="Shows clickable chips with demo openers in the empty state and agent-generated follow-ups after each turn. Off = purely typed input; the server also skips the suggest_next_prompts tool so the agent doesn't burn a call per turn. Reconnect to apply."
              />
              <Check
                checked={settings.enableVoiceMode}
                onChange={(v) => onSettingsChange("enableVoiceMode", v)}
                label="Enable voice mode"
                hint="Adds the always-on mic, voice waveform, mute button, and transcription pipeline. Off by default — flip on to talk to the agent instead of typing."
              />
            </section>

            {/* Voice group — only when voice mode is on. */}
            {settings.enableVoiceMode && <GroupHeader>Voice</GroupHeader>}

            {/* Microphone — only when voice mode is on. */}
            {settings.enableVoiceMode && (
              <section className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Microphone
                </label>
                <Check
                  checked={settings.startMicMuted}
                  onChange={(v) => onSettingsChange("startMicMuted", v)}
                  label="Start with mic muted"
                  hint="When unchecked, mic is unmuted as soon as the session connects."
                />
              </section>
            )}

            {/* Language mode — voice-only; text mode lets the model handle
                whatever language the user types. */}
            {settings.enableVoiceMode && (
              <section className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Language
                </label>
                <Radio
                  checked={settings.languageMode === "english"}
                  onChange={() => onSettingsChange("languageMode", "english")}
                  label="English only (default)"
                  hint="Agent always replies in English. Non-English speech is shown as a 'non-English detected' notice instead of being read aloud."
                />
                <Radio
                  checked={settings.languageMode === "international"}
                  onChange={() => onSettingsChange("languageMode", "international")}
                  label="International (any language, including English)"
                  hint="Agent mirrors whatever language you speak — English, Spanish, Mandarin, etc. Switching modes while connected restarts the Gemini session automatically."
                />
              </section>
            )}

            {/* Transcription — voice-only. Hidden when voice mode is off. */}
            {settings.enableVoiceMode && (
              <section className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Voice Transcription
                </label>
                <p className="text-[11px] text-slate-500">
                  Source for the user-speech text shown in the agent trace. The audio still goes to Gemini directly for the agent's reasoning regardless of this choice.
                </p>
                <Radio
                  checked={settings.transcriptionMethod === "live"}
                  onChange={() =>
                    onSettingsChange("transcriptionMethod", "live")
                  }
                  label="Gemini Live API (default)"
                  hint="Opens a dedicated TEXT-only Live session for transcription. Higher fidelity than Web Speech, but uses one extra audio path per turn and counts against your Gemini quota."
                />
                <Radio
                  checked={settings.transcriptionMethod === "webspeech"}
                  onChange={() =>
                    onSettingsChange("transcriptionMethod", "webspeech")
                  }
                  label="Browser Web Speech API"
                  hint="Chrome/Edge/Safari native STT. Free, low latency, but accuracy varies and Firefox isn't supported."
                />
              </section>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

/** Group divider in the Settings panel. Promotes scanning by chunking
 *  related sections (Connection · Canvas · Display · Voice) under shared
 *  headings. Render at the top of each group; the `<section>` blocks
 *  underneath keep their own per-section labels for fine-grained items. */
function GroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-slate-200 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 first:pt-0">
      {children}
    </div>
  );
}

/** Small connection pill rendered in the TopBar — colored dot + short
 *  label, with the live state surfaced via `title` so hover gives details
 *  without consuming header width. Errors get a red dot AND a visible "Err"
 *  badge so users notice them at a glance. */
function StatusPill({
  label,
  state,
  detail,
}: {
  label: string;
  state: ConnectionState;
  detail?: string;
}) {
  const dotColor =
    state === "connected"
      ? "bg-emerald-300"
      : state === "connecting"
        ? "bg-amber-300 animate-pulse"
        : state === "error"
          ? "bg-rose-400"
          : "bg-white/40";
  const stateText =
    state === "connected"
      ? detail ?? "Connected"
      : state === "connecting"
        ? "Connecting…"
        : state === "error"
          ? detail ?? "Error"
          : "Disconnected";
  return (
    <span
      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-2.5 text-[11px] font-medium"
      title={`${label}: ${stateText}`}
    >
      <span className={cn("h-2 w-2 rounded-full", dotColor)} />
      <span className="hidden md:inline">{label}</span>
      {state === "error" && (
        <span className="rounded bg-rose-500/30 px-1 text-[10px] font-semibold uppercase tracking-wider">
          Err
        </span>
      )}
    </span>
  );
}

function Check({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 cursor-pointer rounded border-slate-300 text-blue-600 focus:ring-blue-500"
      />
      <span className="flex-1">
        <span className="font-medium">{label}</span>
        {hint && (
          <span className="mt-0.5 block text-[11px] font-normal text-slate-500">
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

function Radio({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-2 text-sm ${
        disabled
          ? "cursor-not-allowed text-slate-400"
          : "cursor-pointer text-slate-700"
      }`}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 cursor-pointer border-slate-300 text-blue-600 focus:ring-blue-500"
      />
      <span className="flex-1">
        <span className={disabled ? "" : "font-medium"}>{label}</span>
        {hint && (
          <span
            className={`mt-0.5 block text-[11px] font-normal ${
              disabled ? "text-slate-400" : "text-slate-500"
            }`}
          >
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}
