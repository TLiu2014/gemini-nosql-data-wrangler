import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Browser-side speech recognition. On Chrome / Edge / Safari this hits the
 * native `SpeechRecognition` API (Chrome forwards to Google's production STT
 * under the hood; quality is much better than asking Gemini to transcribe
 * after-the-fact). Firefox doesn't ship it — feature-detect via `supported`.
 *
 * Runs in parallel with the regular audio capture (`useVoiceCapture`).
 * They share the underlying mic stream cleanly because the browser arbitrates
 * `getUserMedia` requests for the same origin.
 *
 * Surfaces only **final** transcripts — we don't try to render interim
 * partials because they overwrite themselves rapidly and clutter the trace.
 * Auto-restarts on `onend` so the recognizer stays "always on" while it's
 * supposed to be running.
 */

type RecognitionResultAlternative = { transcript: string; confidence?: number };
type RecognitionResult = ArrayLike<RecognitionResultAlternative> & {
  isFinal: boolean;
};
interface RecognitionEvent extends Event {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: Event & { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface UseWebSpeechOptions {
  /** Fires once per finalized utterance with the recognized text. */
  onTranscript: (text: string) => void;
  /** Recognition language. Defaults to en-US. */
  lang?: string;
}

export function useWebSpeech({ onTranscript, lang = "en-US" }: UseWebSpeechOptions) {
  const [supported, setSupported] = useState(false);
  const [running, setRunning] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const wantRunningRef = useRef(false);
  // Stable callback ref so changes to the consumer's handler don't recreate
  // the recognizer (which would lose mid-stream audio).
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  useEffect(() => {
    setSupported(!!getCtor());
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) return;
    if (recognitionRef.current) return;
    wantRunningRef.current = true;

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = lang;

    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0]?.transcript?.trim();
          if (text) onTranscriptRef.current(text);
        }
      }
    };

    rec.onerror = (ev) => {
      // `no-speech` / `aborted` are routine; everything else is worth a log.
      const code = (ev as { error?: string }).error;
      if (code !== "no-speech" && code !== "aborted") {
        console.warn("[webspeech] error:", code);
      }
    };

    // Chrome's SpeechRecognition stops itself after ~30s of continuous use or
    // a long silence. Auto-restart while we still want to be running, so the
    // user doesn't have to babysit the mic.
    rec.onend = () => {
      if (wantRunningRef.current && recognitionRef.current === rec) {
        try {
          rec.start();
        } catch {
          // already starting — ignore
        }
      } else {
        setRunning(false);
      }
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      setRunning(true);
    } catch (err) {
      console.warn("[webspeech] start failed:", err);
      recognitionRef.current = null;
      setRunning(false);
    }
  }, [lang]);

  const stop = useCallback(() => {
    wantRunningRef.current = false;
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    setRunning(false);
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      wantRunningRef.current = false;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  return { supported, running, start, stop };
}
