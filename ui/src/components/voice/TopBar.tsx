import { Settings as SettingsIcon, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Settings } from "@/hooks/useSettings";

interface TopBarProps {
  settings: Settings;
  onSettingsChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export default function TopBar({ settings, onSettingsChange }: TopBarProps) {
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
          Gemini NoSQL Data Wrangler
        </span>
        <span className="ml-2 rounded-full bg-white/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white/90">
          MongoDB Atlas · Multimodal Live
        </span>
      </div>

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

      {open && (
        <div
          ref={panelRef}
          className="absolute right-4 top-14 z-50 w-[360px] rounded-lg border border-slate-200 bg-white text-slate-800 shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold">Settings</h3>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close settings"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-4 p-4">
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
                    setOpen(false);
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
                    setOpen(false);
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

            {/* Connection */}
            <section className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                Connection
              </label>
              <Check
                checked={settings.autoConnect}
                onChange={(v) => onSettingsChange("autoConnect", v)}
                label="Auto-connect on load"
                hint="Otherwise click Connect in the sidebar (saves free-tier quota)."
              />
            </section>

            {/* Microphone */}
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

            {/* Language mode */}
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

            {/* Dataset */}
            <section className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                Dataset
              </label>
              <Radio
                checked={settings.dataset === "mflix"}
                onChange={() => onSettingsChange("dataset", "mflix")}
                label="MongoDB sample_mflix dataset"
                hint="Uses the read-only sample data loaded into your Atlas cluster."
              />
              <Radio
                checked={settings.dataset === "upload"}
                onChange={() => onSettingsChange("dataset", "upload")}
                label="Upload your own JSON"
                hint="Drag-and-drop NoSQL documents into a temporary collection — coming soon."
                disabled
              />
            </section>

            {/* Sample flow */}
            <section className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                Sample Flow
              </label>
              <Check
                checked={settings.useSampleFlow}
                onChange={(v) => onSettingsChange("useSampleFlow", v)}
                label="Load sample pipeline on startup"
                hint="A 3-stage MongoDB pipeline with $vectorSearch over embedded_movies."
              />
            </section>

            {/* Results panel */}
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
            </section>
          </div>
        </div>
      )}
    </header>
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
