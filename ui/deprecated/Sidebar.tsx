import { Mic, MicOff, Pause, Play, Plug, PlugZap, Scissors } from "lucide-react";
import AudioVisualizer from "./AudioVisualizer";
import ChatLog, { type ChatMessage } from "./ChatLog";
import type { MicPermissionState } from "@/hooks/useMicPermission";
import type { AgentState, ConnectionState } from "@/types/ws";
import { cn } from "@/lib/Utils";

interface SidebarProps {
  geminiConnection: ConnectionState;
  geminiDetail?: string;
  atlasConnection: ConnectionState;
  atlasDetail?: string;
  agent: AgentState;
  agentDetail?: string;
  micActive: boolean;
  micPermission: MicPermissionState;
  audioPaused: boolean;
  agentSpeaking: boolean;
  micAnalyser: React.RefObject<AnalyserNode | null>;
  agentAnalyser: React.RefObject<AnalyserNode | null>;
  chatLog: ChatMessage[];
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleMic: () => void;
  onInterrupt: () => void;
  onPauseAudio: () => void;
  onResumeAudio: () => void;
}

function CtrlButton({
  onClick,
  disabled,
  title,
  className,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-medium shadow-sm transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

function StatusDot({ state }: { state: ConnectionState }) {
  const color =
    state === "connected"
      ? "bg-emerald-500"
      : state === "connecting"
        ? "bg-amber-400 animate-pulse"
        : state === "error"
          ? "bg-rose-500"
          : "bg-slate-300";
  return <span className={cn("h-2 w-2 rounded-full", color)} />;
}

function statusLabel(state: ConnectionState, detail?: string): string {
  if (detail) return detail;
  switch (state) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting…";
    case "error":
      return "Error";
    default:
      return "Disconnected";
  }
}

function StatusRow({
  label,
  state,
  detail,
}: {
  label: string;
  state: ConnectionState;
  detail?: string;
}) {
  // Show errors on a second line so the full message is readable without
  // hovering — connection-string mistakes are hard to debug from a tooltip.
  const isError = state === "error";
  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusDot state={state} />
          <span className="font-medium text-slate-700">{label}</span>
        </div>
        <span
          className={cn(
            "truncate text-[11px]",
            isError ? "text-rose-600" : "text-slate-500",
          )}
          title={detail}
        >
          {isError ? "Error" : statusLabel(state, detail)}
        </span>
      </div>
      {isError && detail && (
        <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10.5px] leading-snug text-rose-700">
          {detail}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({
  geminiConnection,
  geminiDetail,
  atlasConnection,
  atlasDetail,
  agent,
  agentDetail,
  micActive,
  micPermission,
  audioPaused,
  agentSpeaking,
  micAnalyser,
  agentAnalyser,
  chatLog,
  onConnect,
  onDisconnect,
  onToggleMic,
  onInterrupt,
  onPauseAudio,
  onResumeAudio,
}: SidebarProps) {
  const isConnected = geminiConnection === "connected";
  const isConnecting = geminiConnection === "connecting";

  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col bg-white">
      {/* Connection statuses */}
      <div className="space-y-2 border-b border-slate-200 px-3 py-3">
        <StatusRow
          label="MongoDB Atlas"
          state={atlasConnection}
          detail={atlasDetail}
        />
        <StatusRow
          label="Gemini Live"
          state={geminiConnection}
          detail={geminiDetail}
        />
      </div>

      {/* Visualizers */}
      <div className="border-b border-slate-200 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            You
          </span>
          {micActive && (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
              Live
            </span>
          )}
        </div>
        <AudioVisualizer
          analyser={micAnalyser.current}
          color={[66, 133, 244]}
          colorEnd={[156, 39, 176]}
          label=""
          active={micActive}
        />
        <div className="mb-2 mt-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Agent
          </span>
          {agentSpeaking && (
            <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
              Speaking
            </span>
          )}
        </div>
        <AudioVisualizer
          analyser={agentAnalyser.current}
          color={[156, 39, 176]}
          colorEnd={[66, 133, 244]}
          label=""
          active={isConnected}
        />
      </div>

      {/* Controls — connection + mic */}
      <div className="flex min-w-0 gap-2 border-b border-slate-200 p-3">
        {isConnected ? (
          <CtrlButton
            onClick={onDisconnect}
            className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            title="Disconnect from agent"
          >
            <Plug className="h-3.5 w-3.5" />
            Disconnect
          </CtrlButton>
        ) : (
          <CtrlButton
            onClick={onConnect}
            disabled={isConnecting}
            className="border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            title="Connect to agent"
          >
            <PlugZap className="h-3.5 w-3.5" />
            {isConnecting ? "Connecting…" : "Connect"}
          </CtrlButton>
        )}
        <CtrlButton
          onClick={onToggleMic}
          disabled={micPermission === "denied"}
          className={cn(
            micActive
              ? "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
          )}
          title={
            micPermission === "denied"
              ? "Microphone access denied"
              : micActive
                ? "Mute mic"
                : "Unmute mic"
          }
        >
          {micActive ? (
            <>
              <MicOff className="h-3.5 w-3.5" /> Mute
            </>
          ) : (
            <>
              <Mic className="h-3.5 w-3.5" /> Unmute
            </>
          )}
        </CtrlButton>
      </div>

      {/* Controls — interrupt + pause */}
      <div className="flex min-w-0 gap-2 border-b border-slate-200 p-3">
        <CtrlButton
          onClick={onInterrupt}
          disabled={!agentSpeaking}
          className="border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
          title={agentSpeaking ? "Cut off the agent" : "Available while the agent is talking"}
        >
          <Scissors className="h-3.5 w-3.5" />
          Interrupt
        </CtrlButton>
        <CtrlButton
          onClick={audioPaused ? onResumeAudio : onPauseAudio}
          disabled={!audioPaused && !agentSpeaking}
          className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          title={audioPaused ? "Resume agent audio" : "Pause agent audio"}
        >
          {audioPaused ? (
            <>
              <Play className="h-3.5 w-3.5" /> Resume
            </>
          ) : (
            <>
              <Pause className="h-3.5 w-3.5" /> Pause
            </>
          )}
        </CtrlButton>
      </div>

      {/* Chat log */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">
        <div className="border-b border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Conversation
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <ChatLog
            messages={chatLog}
            agentState={agent}
            agentDetail={agentDetail}
          />
        </div>
      </div>
    </aside>
  );
}
