import { useRef, useState, useCallback } from "react";

const SAMPLE_RATE = 16000;

export function useAudioCapture(onChunk: (base64: string) => void) {
  const [micActive, setMicActive] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: SAMPLE_RATE, channelCount: 1, echoCancellation: true },
    });
    streamRef.current = stream;

    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    contextRef.current = ctx;

    const source = ctx.createMediaStreamSource(stream);

    // Create analyser for the mic visualizer
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.9;
    analyser.minDecibels = -85;
    analyser.maxDecibels = -20;
    source.connect(analyser);
    analyserRef.current = analyser;

    const processor = ctx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
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
      onChunk(btoa(binary));
    };

    source.connect(processor);
    processor.connect(ctx.destination);
    setMicActive(true);
  }, [onChunk]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    contextRef.current?.close();
    streamRef.current = null;
    contextRef.current = null;
    analyserRef.current = null;
    setMicActive(false);
  }, []);

  return { micActive, start, stop, analyser: analyserRef };
}
