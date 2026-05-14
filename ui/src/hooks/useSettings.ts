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
  useSampleFlow: boolean;
  /** "mflix" = use the loaded sample_mflix dataset; "upload" = user JSON (not yet wired). */
  dataset: "mflix" | "upload";
  /** Show the "Pipeline Schema" tab in the results panel. Off by default — most users care about rows. */
  showSchemaJson: boolean;
  /**
   * "english" = strict English-only (default, recommended for demos): the agent
   *             is instructed to respond in English even if the user appears
   *             to speak another language, and the UI filters non-Latin
   *             transcript fragments as background-noise mistranscriptions.
   * "international" = no language enforcement: the agent responds in whatever
   *             language the user speaks; the UI shows all transcripts as-is.
   */
  languageMode: "english" | "international";
}

const STORAGE_KEY = "gemini-nosql-wrangler:settings";

const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  mongoUri: "",
  autoConnect: false,
  startMicMuted: false,
  useSampleFlow: true,
  dataset: "mflix",
  showSchemaJson: false,
  languageMode: "english",
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
