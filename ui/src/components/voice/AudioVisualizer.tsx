import { useRef, useEffect } from "react";

interface AudioVisualizerProps {
  analyser: AnalyserNode | null;
  color: [number, number, number];
  colorEnd: [number, number, number];
  label: string;
  active: boolean;
}

// Use RMS + hysteresis to avoid jittery "always-on" waves in silence.
const OPEN_RMS_THRESHOLD = 0.035;
const CLOSE_RMS_THRESHOLD = 0.02;
const OPEN_HOLD_FRAMES = 2;
const CLOSE_HOLD_FRAMES = 10;

export default function AudioVisualizer({ analyser, color, colorEnd, label, active }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const gateOpenRef = useRef(false);
  const openFramesRef = useRef(0);
  const closeFramesRef = useRef(0);
  const energyRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d")!;

    if (!active || !analyser) {
      // Draw idle state — flat line
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},0.15)`;
      const y = canvas.height / 2;
      ctx.fillRect(0, y - 1, canvas.width, 2);
      return;
    }

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const timeDomain = new Uint8Array(analyser.fftSize);

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      analyser.getByteTimeDomainData(timeDomain);

      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      // Compute RMS from time-domain signal (more reliable for voice activity)
      let sumSq = 0;
      for (let i = 0; i < timeDomain.length; i++) {
        const centered = (timeDomain[i] - 128) / 128;
        sumSq += centered * centered;
      }
      const rms = Math.sqrt(sumSq / timeDomain.length);

      // Hysteresis gate: open quickly, close slowly.
      if (!gateOpenRef.current) {
        if (rms > OPEN_RMS_THRESHOLD) {
          openFramesRef.current += 1;
          if (openFramesRef.current >= OPEN_HOLD_FRAMES) {
            gateOpenRef.current = true;
            openFramesRef.current = 0;
          }
        } else {
          openFramesRef.current = 0;
        }
      } else if (rms < CLOSE_RMS_THRESHOLD) {
        closeFramesRef.current += 1;
        if (closeFramesRef.current >= CLOSE_HOLD_FRAMES) {
          gateOpenRef.current = false;
          closeFramesRef.current = 0;
          energyRef.current = 0;
        }
      } else {
        closeFramesRef.current = 0;
      }

      if (!gateOpenRef.current) {
        // Draw quiet idle line
        ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},0.2)`;
        const y = height / 2;
        ctx.fillRect(0, y - 1, width, 2);
        return;
      }

      // Smooth energy so bars move naturally without popping.
      energyRef.current = energyRef.current * 0.82 + rms * 0.18;
      const energyScale = Math.min(
        1,
        Math.max(0.12, (energyRef.current - CLOSE_RMS_THRESHOLD) / 0.16),
      );

      const barWidth = (width / bufferLength) * 2;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * height * energyScale;
        const ratio = i / bufferLength;
        const r = Math.floor(color[0] * (1 - ratio) + colorEnd[0] * ratio);
        const g = Math.floor(color[1] * (1 - ratio) + colorEnd[1] * ratio);
        const b = Math.floor(color[2] * (1 - ratio) + colorEnd[2] * ratio);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
        x += barWidth;
      }
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [analyser, color, colorEnd, active]);

  return (
    <div className="rounded-md bg-slate-50 ring-1 ring-slate-200">
      {label && (
        <span className="block px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
      )}
      <canvas
        ref={canvasRef}
        width={280}
        height={48}
        style={{ width: "100%", height: 48, borderRadius: 6 }}
      />
    </div>
  );
}
