import { useCallback, useEffect, useState } from "react";

/**
 * Persisted user settings. Survive a page refresh (via sessionStorage) but
 * intentionally NOT a browser restart — we don't want a forgotten API key to
 * linger on a shared machine.
 */
export interface Settings {
  apiKey: string;
  /** MongoDB Atlas connection string. Overrides the server's MONGODB_URI when set. */
  mongoUri: string;
  autoConnect: boolean;
  startMicMuted: boolean;
  /**
   * What to put on the canvas at startup.
   *   "data"   — two MQL_SOURCE nodes (movies + comments). Demo starting
   *              point; the rest is built by talking to the agent.
   *   "vector" — the legacy 3-stage $vectorSearch pipeline.
   *   "none"   — empty canvas.
   */
  sampleFlow: "data" | "vector" | "none";
  /** Show the "Pipeline Schema" tab in the results panel. */
  showSchemaJson: boolean;
  /** Show the "Mflix collections" reference tab in the results panel. */
  showMflixCollections: boolean;
  /**
   * Show the side-by-side JSON pane next to the document tree on stage-result
   * tabs. Off by default — the tree view already shows every field explicitly
   * and the per-card "View raw" toggle covers single-document inspection.
   * Mflix collections and Pipeline schema tabs always show JSON (it's their
   * primary view) and aren't affected by this setting.
   */
  showResultsJsonPane: boolean;
  /** Show the text-message input box below the chat timeline. */
  enableTextInput: boolean;
  /**
   * Show agent-suggested follow-up chips after each turn, and the hardcoded
   * demo chips in the empty state. When off the chat is purely typed input.
   * The server skips the `suggest_next_prompts` tool entirely (saves a
   * tool call + ~500ms per turn) so the agent never even tries.
   */
  enableSuggestedPrompts: boolean;
  /**
   * Show voice/audio features (mic, visualizer, mute button, transcript
   * status row, transcription pipeline). When off, the agent is purely
   * text-driven and the sidebar's audio chrome is hidden.
   */
  enableVoiceMode: boolean;
  /**
   * "english" = strict English-only (default, recommended for demos).
   * "international" = no language enforcement; agent mirrors whatever the
   * user speaks.
   */
  languageMode: "english" | "international";
  /**
   * Main content layout.
   *   "stacked"       — canvas on top, results on bottom (default). Inside the
   *                     results, DocumentsSplitView is horizontal (table left,
   *                     JSON right).
   *   "side-by-side"  — canvas on the left, results on the right. Inside the
   *                     results, DocumentsSplitView flips to vertical
   *                     (table on top, JSON below).
   */
  layoutMode: "stacked" | "side-by-side";
  /**
   * Source for the user's visible transcript in the trace panel.
   *   "webspeech" — browser-native SpeechRecognition. Free, no API calls,
   *                 but quality varies and Firefox isn't supported.
   *   "live"      — dedicated Gemini Live API session (TEXT-only modality)
   *                 dedicated to streaming transcripts. Uses one extra
   *                 audio path per turn.
   */
  transcriptionMethod: "webspeech" | "live";
}

const STORAGE_KEY = "gemini-nosql-wrangler:settings";

const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  mongoUri: "",
  autoConnect: false,
  startMicMuted: false,
  sampleFlow: "none",
  showSchemaJson: false,
  showMflixCollections: true,
  showResultsJsonPane: false,
  enableTextInput: true,
  enableSuggestedPrompts: true,
  enableVoiceMode: false,
  languageMode: "english",
  layoutMode: "side-by-side",
  transcriptionMethod: "live",
};

function load(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* sessionStorage unavailable (e.g. Safari private mode) — fail quiet */
    }
  }, [settings]);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  return { settings, update };
}
