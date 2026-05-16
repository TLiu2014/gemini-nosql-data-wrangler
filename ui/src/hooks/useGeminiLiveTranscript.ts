import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleGenAI, Modality, type Session } from "@google/genai";

/**
 * Browser-side Gemini Live transcription. Opens a dedicated Live session
 * configured for TEXT response modality + `inputAudioTranscription`, streams
 * raw PCM-16kHz audio from the mic, and surfaces the model's transcription
 * deltas.
 *
 * This runs IN PARALLEL with the main audio path (which goes through our
 * server to `gemini-3.1-flash-lite`'s `chats.sendMessage` for the agent
 * loop). We're just adding a second, transcription-only consumer of the
 * same mic feed.
 *
 * Why TEXT-only response modality: the 1011 mid-stream drops we saw on Live
 * API historically happened around audio-output state machinery. Disabling
 * audio output dramatically reduces (though doesn't eliminate) that risk.
 *
 * Why a Live model here: only Live-capable models accept
 * `inputAudioTranscription`. `gemini-2.5-flash-native-audio-preview-09-2025`
 * is the most reliable Live model on AI Studio keys for this purpose.
 */

const LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-09-2025";
const PCM_SAMPLE_RATE = 16000;

export type LiveTranscriptState =
  | "idle"
  | "connecting"
  | "listening"
  | "error";

interface UseGeminiLiveTranscriptOptions {
  /** Fires when an utterance's transcription is finalized. */
  onTranscript: (text: string) => void;
  /** API key. Required — falls back to noop if missing. */
  getApiKey: () => string | undefined;
}

export function useGeminiLiveTranscript({
  onTranscript,
  getApiKey,
}: UseGeminiLiveTranscriptOptions) {
  const [state, setState] = useState<LiveTranscriptState>("idle");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  // Stable callback ref so we can rebind onTranscript without restarting.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  // Mic + audio context for PCM capture.
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<Session | null>(null);
  // Per-utterance buffer — emit on turnComplete.
  const bufferRef = useRef("");
  // True while we want the session up — avoids races where stop() is called
  // before connect() resolves.
  const wantRunningRef = useRef(false);

  const teardown = useCallback(() => {
    wantRunningRef.current = false;
    try {
      sessionRef.current?.close();
    } catch {
      /* ignore */
    }
    sessionRef.current = null;
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    bufferRef.current = "";
  }, []);

  useEffect(() => {
    return () => teardown();
  }, [teardown]);

  const start = useCallback(async (): Promise<boolean> => {
    if (wantRunningRef.current) return true;
    const apiKey = getApiKey();
    if (!apiKey) {
      console.warn(
        "[live-transcript] no API key in Settings — falling back to Web Speech path. Set Settings → Gemini API Key.",
      );
      setErrorDetail(
        "Browser-side Live transcription needs a Gemini API key set in Settings (it can't read the server's env key).",
      );
      setState("error");
      return false;
    }
    setErrorDetail(null);
    setState("connecting");
    wantRunningRef.current = true;
    console.log("[live-transcript] starting (model:", LIVE_MODEL, ")");

    try {
      // 1. Mic + AudioContext at 16 kHz for PCM-16 audio frames.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: PCM_SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
        },
      });
      streamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
      ctxRef.current = ctx;

      // 2. Live session — native-audio Live models reject TEXT-only modality
      // ("Cannot extract voices from a non-audio request", close code 1007).
      // We use AUDIO modality (which the model requires) but never forward
      // the model's audio output to the speaker — we only consume the
      // `inputTranscription` deltas we asked for.
      const ai = new GoogleGenAI({ apiKey });
      console.log("[live-transcript] opening Live session…");
      const session = await ai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { languageCode: "en-US" },
          inputAudioTranscription: {},
        } as unknown as Parameters<typeof ai.live.connect>[0]["config"],
        callbacks: {
          onopen: () => {
            console.log("[live-transcript] session opened");
            if (!wantRunningRef.current) return;
            setState("listening");
          },
          onmessage: (msg) => {
            const sc = msg.serverContent;
            if (sc?.inputTranscription?.text) {
              bufferRef.current += sc.inputTranscription.text;
            }
            if (sc?.turnComplete || sc?.generationComplete) {
              const text = bufferRef.current.trim();
              bufferRef.current = "";
              if (text) {
                console.log(
                  "[live-transcript] transcript:",
                  text.slice(0, 80),
                );
                onTranscriptRef.current(text);
              }
            }
          },
          onerror: (err) => {
            console.warn("[live-transcript] error:", err);
            setErrorDetail(String(err));
            setState("error");
          },
          onclose: (ev) => {
            const code = (ev as { code?: number })?.code;
            const reason = (ev as { reason?: string })?.reason;
            console.log("[live-transcript] session closed:", code, reason);
            if (wantRunningRef.current) {
              setState("error");
              setErrorDetail(
                `Live transcription closed (code ${code ?? "?"}${reason ? `, ${reason}` : ""})`,
              );
              wantRunningRef.current = false;
            } else {
              setState("idle");
            }
          },
        },
      });
      sessionRef.current = session;

      // 3. Stream raw PCM-16 audio chunks into the session.
      const source = ctx.createMediaStreamSource(stream);
      // ScriptProcessor is deprecated but ubiquitously supported and the
      // simplest way to get raw PCM frames out of the browser. The replacement
      // (AudioWorklet) is a bigger lift.
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (e) => {
        if (!wantRunningRef.current || !sessionRef.current) return;
        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        const bytes = new Uint8Array(int16.buffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        try {
          sessionRef.current.sendRealtimeInput({
            audio: { mimeType: "audio/pcm;rate=16000", data: base64 },
          });
        } catch (err) {
          console.warn("[live-transcript] sendRealtimeInput failed:", err);
        }
      };
      source.connect(processor);
      processor.connect(ctx.destination);

      return true;
    } catch (err) {
      console.warn("[live-transcript] start failed:", err);
      setErrorDetail(String(err));
      setState("error");
      teardown();
      return false;
    }
  }, [state, getApiKey, teardown]);

  const stop = useCallback(() => {
    teardown();
    setState("idle");
  }, [teardown]);

  return { state, errorDetail, start, stop };
}
