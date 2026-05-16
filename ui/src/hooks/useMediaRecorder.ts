import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Push-to-talk audio capture for Phase 3. The user holds (or toggles) the
 * mic button, MediaRecorder accumulates chunks, and on stop we hand back
 * one base64-encoded blob ready to send to the server.
 *
 * Mime-type detection: most browsers default to `audio/webm;codecs=opus`,
 * which Gemini accepts. If that's unavailable (Safari), we fall back to
 * whatever `MediaRecorder.isTypeSupported` accepts.
 */
export type RecorderState = "idle" | "requesting-mic" | "recording" | "error";

export interface RecordedClip {
  data: string; // base64-encoded
  mimeType: string;
  durationMs: number;
}

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) {
      return m;
    }
  }
  return "audio/webm";
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  // btoa() can't handle arbitrary bytes via String.fromCharCode in one shot
  // for large buffers, so chunk it.
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  return btoa(binary);
}

export function useMediaRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  // AudioContext + AnalyserNode for the live waveform during recording.
  // We expose the analyser as a ref so a sibling `AudioVisualizer` can
  // read frequency data on rAF without re-rendering this hook on every frame.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Stop any in-flight stream on unmount.
  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => undefined);
      audioCtxRef.current = null;
      analyserRef.current = null;
    };
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (state === "recording") return true;
    setErrorDetail(null);
    setState("requesting-mic");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onerror = (ev) => {
        const err = (ev as unknown as { error?: Error }).error;
        setErrorDetail(err?.message ?? "MediaRecorder error");
        setState("error");
      };
      recorderRef.current = recorder;
      // Set up the live waveform analyser. Tap the same mic stream and feed
      // it into an AnalyserNode; the AudioVisualizer reads it on rAF.
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ctx = new Ctx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
      } catch (err) {
        // Visualizer is cosmetic — recording still works without it.
        console.warn("[mic] AnalyserNode setup failed:", err);
      }
      recorder.start();
      setStartedAt(Date.now());
      setState("recording");
      return true;
    } catch (err) {
      setErrorDetail(String(err));
      setState("error");
      return false;
    }
  }, [state]);

  /**
   * Stop the active recording and return the captured clip. Resolves to
   * null if there was nothing to capture (no chunks, mic denied, etc.).
   */
  const stop = useCallback(async (): Promise<RecordedClip | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      // Best-effort cleanup of the stream even if recorder is gone.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setState("idle");
      setStartedAt(null);
      return null;
    }

    const stoppedPromise = new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
    });
    recorder.stop();
    await stoppedPromise;

    // Release the mic immediately so the OS indicator goes away.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    const chunks = chunksRef.current;
    chunksRef.current = [];
    recorderRef.current = null;
    const begun = startedAt;
    setStartedAt(null);
    setState("idle");

    if (chunks.length === 0) return null;
    const mimeType = chunks[0].type || "audio/webm";
    const blob = new Blob(chunks, { type: mimeType });
    const data = await blobToBase64(blob);
    return {
      data,
      mimeType,
      durationMs: begun ? Date.now() - begun : 0,
    };
  }, [startedAt]);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    chunksRef.current = [];
    recorderRef.current = null;
    setStartedAt(null);
    setState("idle");
  }, []);

  return { state, errorDetail, startedAt, start, stop, cancel };
}
