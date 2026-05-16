import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Always-on push-the-microphone-to-talk-not voice capture for Phase 3.
 *
 * Flow:
 *   1. `start()` requests the mic, opens an AudioContext, hangs an
 *      AnalyserNode on the stream.
 *   2. A 50 ms VAD loop reads RMS amplitude from the analyser.
 *      Above the open threshold → user is speaking → begin a fresh
 *      MediaRecorder chunk.
 *      Below the close threshold for ~`silenceHangMs` → utterance done →
 *      stop the recorder, deliver the clip via `onUtterance`.
 *   3. The mic stream stays open between utterances so we don't pay the
 *      `getUserMedia` permission/initialization cost each turn.
 *
 * Caller controls when to actually run via `start()` / `stop()` and can
 * mute via `setMuted(true)` to ignore audio without releasing the mic.
 */
export type VoiceCaptureState =
  | "idle"
  | "requesting-mic"
  | "listening" // armed, waiting for voice
  | "speaking" // user is mid-utterance
  | "error";

export interface VoiceUtterance {
  data: string; // base64
  mimeType: string;
  durationMs: number;
}

export interface UseVoiceCaptureOptions {
  /** Callback when a complete utterance is captured. */
  onUtterance: (clip: VoiceUtterance) => void;
  /** Minimum clip length to bother sending (filters cough / stray noise). */
  minClipMs?: number;
  /** How long below the close-threshold we wait before declaring silence. */
  silenceHangMs?: number;
}

const DEFAULT_MIN_CLIP_MS = 600;
const DEFAULT_SILENCE_HANG_MS = 1200;
const VAD_TICK_MS = 50;
// Open threshold needs to be high enough that keyboard clicks / room
// ambience don't trip it. Close threshold leaves a comfortable margin so
// we don't end the utterance too eagerly inside a quiet word.
const OPEN_RMS = 0.09;
const CLOSE_RMS = 0.04;
// Require the open threshold to be sustained for N consecutive ticks
// before we start a recording. Stops single-sample spikes (door slam,
// chair creak, distant cough) from kicking off a phantom utterance.
const OPEN_HOLD_TICKS = 3;

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

export function useVoiceCapture({
  onUtterance,
  minClipMs = DEFAULT_MIN_CLIP_MS,
  silenceHangMs = DEFAULT_SILENCE_HANG_MS,
}: UseVoiceCaptureOptions) {
  const [state, setState] = useState<VoiceCaptureState>("idle");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);

  // Stream + analyser stay alive across utterances so VAD is continuous.
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Per-utterance recorder state.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const utteranceStartedAtRef = useRef<number | null>(null);

  // VAD loop bookkeeping.
  const vadTimerRef = useRef<number | null>(null);
  const lastVoiceAtRef = useRef<number>(0);
  const openHoldRef = useRef(0);

  // Refs that mirror state so the VAD loop reads fresh values without
  // re-binding the interval on every render.
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const onUtteranceRef = useRef(onUtterance);
  onUtteranceRef.current = onUtterance;
  const minClipMsRef = useRef(minClipMs);
  minClipMsRef.current = minClipMs;
  const silenceHangMsRef = useRef(silenceHangMs);
  silenceHangMsRef.current = silenceHangMs;

  const teardown = useCallback(() => {
    if (vadTimerRef.current != null) {
      window.clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {
        /* ignore */
      }
    }
    recorderRef.current = null;
    chunksRef.current = [];
    utteranceStartedAtRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    analyserRef.current = null;
  }, []);

  useEffect(() => {
    return () => teardown();
  }, [teardown]);

  const startRecorderForUtterance = useCallback(() => {
    if (!streamRef.current) return;
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    chunksRef.current = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    recorderRef.current = recorder;
    recorder.start();
    utteranceStartedAtRef.current = Date.now();
    setState("speaking");
  }, []);

  const stopRecorderAndDeliver = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    const stoppedPromise = new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
    });
    recorder.stop();
    await stoppedPromise;

    const chunks = chunksRef.current;
    chunksRef.current = [];
    recorderRef.current = null;
    const begun = utteranceStartedAtRef.current;
    utteranceStartedAtRef.current = null;
    setState((s) => (s === "speaking" ? "listening" : s));

    if (chunks.length === 0) return;
    const durationMs = begun ? Date.now() - begun : 0;
    if (durationMs < minClipMsRef.current) return;
    const mimeType = chunks[0].type || "audio/webm";
    const blob = new Blob(chunks, { type: mimeType });
    const data = await blobToBase64(blob);
    onUtteranceRef.current({ data, mimeType, durationMs });
  }, []);

  const startVadLoop = useCallback(() => {
    if (vadTimerRef.current != null) return;
    const buf = new Uint8Array(analyserRef.current?.fftSize ?? 2048);
    vadTimerRef.current = window.setInterval(() => {
      const analyser = analyserRef.current;
      if (!analyser) return;
      analyser.getByteTimeDomainData(buf);
      // RMS from 0..255 byte time-domain data.
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / buf.length);

      const now = Date.now();
      if (mutedRef.current) {
        // While muted, if we were in the middle of an utterance, abandon it.
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          try {
            recorderRef.current.stop();
          } catch {
            /* ignore */
          }
          recorderRef.current = null;
          chunksRef.current = [];
          utteranceStartedAtRef.current = null;
          setState("listening");
        }
        return;
      }

      const isSpeaking =
        recorderRef.current && recorderRef.current.state === "recording";
      if (!isSpeaking) {
        // Require N consecutive ticks above OPEN_RMS so a single noise
        // spike doesn't start an utterance.
        if (rms > OPEN_RMS) {
          openHoldRef.current += 1;
          if (openHoldRef.current >= OPEN_HOLD_TICKS) {
            openHoldRef.current = 0;
            lastVoiceAtRef.current = now;
            startRecorderForUtterance();
          }
        } else {
          openHoldRef.current = 0;
        }
      } else {
        if (rms > CLOSE_RMS) {
          lastVoiceAtRef.current = now;
        } else if (now - lastVoiceAtRef.current > silenceHangMsRef.current) {
          void stopRecorderAndDeliver();
        }
      }
    }, VAD_TICK_MS);
  }, [startRecorderForUtterance, stopRecorderAndDeliver]);

  const start = useCallback(async (): Promise<boolean> => {
    if (state === "listening" || state === "speaking") return true;
    setErrorDetail(null);
    setState("requesting-mic");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      setState("listening");
      startVadLoop();
      return true;
    } catch (err) {
      setErrorDetail(String(err));
      setState("error");
      teardown();
      return false;
    }
  }, [state, startVadLoop, teardown]);

  const stop = useCallback(() => {
    teardown();
    setState("idle");
  }, [teardown]);

  return {
    state,
    errorDetail,
    muted,
    setMuted,
    analyser: analyserRef,
    start,
    stop,
  };
}
