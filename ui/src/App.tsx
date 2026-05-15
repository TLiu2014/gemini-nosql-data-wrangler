import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { TransformationFlow } from "@/components/flow/TransformationFlow";
import TopBar from "@/components/voice/TopBar";
import Sidebar from "@/components/voice/Sidebar";
import ResultsPanel from "@/components/results/ResultsPanel";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import { useDragResize } from "@/hooks/useDragResize";
import { useMicPermission } from "@/hooks/useMicPermission";
import { useSettings } from "@/hooks/useSettings";
import { useWebSocket } from "@/hooks/useWebSocket";
import {
  SAMPLE_MFLIX_DEMO_FLOW,
  SAMPLE_MFLIX_VECTOR_FLOW,
} from "@/samples/sampleFlow";
import type { ChatMessage } from "@/components/voice/ChatLog";
import type { PipelineSchema } from "@/Schema";
import type {
  AgentState,
  ConnectionState,
  MflixCollectionsMessage,
  ResultsMessage,
  ServerMessage,
} from "@/types/ws";

const SIDEBAR_MIN = 260;
const SIDEBAR_MAX = 560;
const SIDEBAR_DEFAULT = 320;

const FLOW_PCT_MIN = 20;
const FLOW_PCT_MAX = 85;
const FLOW_PCT_DEFAULT = 60;

const NON_ENGLISH_CLARIFICATION = "(non-English speech — English-only mode)";

/**
 * Concatenate streaming transcript fragments. Gemini Live's transcription API
 * emits each fragment with its own leading whitespace marking word boundaries,
 * so we concat directly and collapse any accidental double-spaces.
 */
function appendTranscriptChunk(existing: string, chunk: string): string {
  if (!existing) return chunk.trimStart();
  if (!chunk) return existing;
  return (existing + chunk).replace(/ {2,}/g, " ");
}

/**
 * Detect chunks that contain characters from a non-Latin script — Gemini's
 * ASR uses these when it thinks the user spoke another language, but also
 * occasionally as a misrecognition of background noise. In English-only mode
 * we hide these from the transcript entirely (user) or drop them (agent).
 *
 * The accept list covers ASCII, Latin-1 Supplement, Latin Extended A/B,
 * IPA, combining marks, and Latin Extended Additional — so accented English/
 * European letters and punctuation pass. Anything else (CJK, Cyrillic, Greek,
 * Hebrew, Arabic, Indic, Thai, Korean, emojis/supplementary planes via
 * surrogate pairs) fails. Punctuation-only fragments like ", " or "." are
 * legitimate streaming chunks and now pass — they used to be wrongly flagged.
 *
 * NOTE: Latin-script non-English (Spanish, French, German) cannot be detected
 * by script alone; the system instruction handles those at the model layer.
 *
 * Returns the chunk (trailing whitespace trimmed) when it's displayable, null
 * when it should be suppressed. Leading whitespace is preserved because the
 * transcription API uses it to mark word boundaries.
 */
const NON_LATIN_RE = /[^\x00-\x7F\u00A0-\u036F\u1E00-\u1EFF]/;

function displayableEnglishChunk(text: string): string | null {
  if (!text || !text.trim()) return null;
  if (NON_LATIN_RE.test(text)) return null;
  return text.trimEnd();
}

export default function App() {
  const { settings, update: updateSetting } = useSettings();

  const initialSchema =
    settings.sampleFlow === "data"
      ? SAMPLE_MFLIX_DEMO_FLOW
      : settings.sampleFlow === "vector"
        ? SAMPLE_MFLIX_VECTOR_FLOW
        : null;
  const [schema, setSchema] = useState<PipelineSchema | null>(initialSchema);
  const [results, setResults] = useState<ResultsMessage[]>([]);
  // Active tab id in the results panel. Owned here so a click on a canvas
  // stage node's "view output" link can flip the panel to that stage's tab.
  // Stage ids match between canvas (StageNode `id`) and results (`ResultsMessage.stageId`).
  const [activeResultsTab, setActiveResultsTab] = useState<string | null>(null);
  // Live-fetched Mflix collections. `null` = no refresh attempted yet (the UI
  // falls back to the static catalog); otherwise this is the most recent
  // server reply (with either `collections` or `error`).
  const [mflixRefresh, setMflixRefresh] =
    useState<MflixCollectionsMessage | null>(null);
  const [mflixRefreshing, setMflixRefreshing] = useState(false);
  const [chatLog, setChatLog] = useState<ChatMessage[]>([]);
  const [agent, setAgent] = useState<AgentState>("idle");
  const [agentDetail, setAgentDetail] = useState<string | undefined>(undefined);
  const [atlasConnection, setAtlasConnection] =
    useState<ConnectionState>("disconnected");
  const [atlasDetail, setAtlasDetail] = useState<string | undefined>(undefined);
  const [geminiDetail, setGeminiDetail] = useState<string | undefined>(undefined);

  // Layout — drag-to-resize for sidebar width and canvas/results split.
  const mainRef = useRef<HTMLDivElement>(null);
  const sidebar = useDragResize<number>(
    SIDEBAR_DEFAULT,
    "x",
    (e) =>
      Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, e.clientX)),
  );
  const flowPct = useDragResize<number>(FLOW_PCT_DEFAULT, "y", (e) => {
    const rect = mainRef.current?.getBoundingClientRect();
    if (!rect) return FLOW_PCT_DEFAULT;
    const pct = ((e.clientY - rect.top) / rect.height) * 100;
    return Math.max(FLOW_PCT_MIN, Math.min(FLOW_PCT_MAX, pct));
  });

  const audio = useAudioPlayback();
  const mic = useMicPermission();

  const sendRef = useRef<((data: string) => void) | null>(null);

  const capture = useAudioCapture(
    useCallback((base64) => {
      sendRef.current?.(base64);
    }, []),
  );

  const handleMessage = useCallback(
    (msg: ServerMessage) => {
      switch (msg.type) {
        case "audio":
          audio.allowPlayback();
          audio.playChunk(msg.data);
          break;
        case "agent.status":
          setAgent(msg.state);
          setAgentDetail(msg.detail);
          // Gemini's VAD reports the user barged in mid-response. Flush any
          // queued audio chunks immediately so the user isn't still hearing
          // the abandoned turn while they speak.
          if (msg.detail === "interrupted") {
            audio.interrupt();
          }
          // Turn complete (or error) → finalize the in-flight agent bubble so
          // the next turn's thinking/transcript chunks start a fresh bubble
          // instead of merging into the previous one.
          if (msg.state === "idle" || msg.state === "error") {
            setChatLog((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "agent" && !last.final) {
                return [...prev.slice(0, -1), { ...last, final: true }];
              }
              return prev;
            });
          }
          break;
        case "transcript": {
          // Preemptive barge-in: the moment Gemini transcribes user speech
          // while the agent is mid-response, flush queued audio so the user
          // doesn't keep hearing the old answer over their new question.
          // Gemini's serverContent.interrupted usually follows but can lag
          // a few hundred ms behind the first inputTranscription chunk.
          if (msg.role === "user" && audio.isPlaying) {
            audio.interrupt();
          }

          const appendChunk = (
            prev: ChatMessage[],
            display: string,
          ): ChatMessage[] => {
            const last = prev[prev.length - 1];
            const sameRole = !!last && last.role === msg.role;
            const inFlight = sameRole && !last.final;
            const canAppendById =
              !!msg.messageId && !!last?.messageId && msg.messageId === last.messageId;
            // Adopt an in-flight bubble that has no messageId yet — this is
            // the orphan a thinking-only chunk creates BEFORE the first
            // transcript chunk arrives. Without this, thinking would land in
            // a separate bubble from the spoken text for the same turn.
            const canAdoptOrphan = inFlight && !last?.messageId;
            // Legacy fallback for when the server doesn't stamp messageIds.
            const legacyMatch = inFlight && !msg.messageId;

            if (sameRole && (canAppendById || canAdoptOrphan || legacyMatch)) {
              return [
                ...prev.slice(0, -1),
                {
                  ...last!,
                  text: appendTranscriptChunk(last!.text, display),
                  messageId: msg.messageId ?? last!.messageId,
                },
              ];
            }
            return [
              ...prev,
              {
                role: msg.role,
                text: display.trimStart(),
                messageId: msg.messageId,
                ts: msg.ts,
              },
            ];
          };

          const raw = msg.text.trimEnd();
          if (!raw.trim()) break;

          // International mode: show every chunk verbatim.
          if (settings.languageMode !== "english") {
            setChatLog((prev) => appendChunk(prev, raw));
            break;
          }

          // English-only mode.
          const display = displayableEnglishChunk(raw);
          if (display) {
            setChatLog((prev) => appendChunk(prev, display));
            break;
          }

          // Non-English chunk. Agent chunks are dropped silently — the server
          // already suppresses the rest of the agent's turn anyway. User
          // chunks surface as a single clarification bubble per utterance,
          // keyed on messageId so the bubble doesn't get re-added for every
          // chunk in the same run.
          if (msg.role !== "user") break;
          setChatLog((prev) => {
            const last = prev[prev.length - 1];
            const sameRun =
              last &&
              last.role === "user" &&
              last.kind === "clarification" &&
              ((msg.messageId && last.messageId === msg.messageId) ||
                !msg.messageId);
            if (sameRun) return prev;
            return [
              ...prev,
              {
                role: "user",
                kind: "clarification",
                text: NON_ENGLISH_CLARIFICATION,
                final: true,
                messageId: msg.messageId,
                ts: msg.ts,
              },
            ];
          });
          break;
        }
        case "thinking":
          // Append to the most recent agent bubble — but only if it's still
          // in-flight (not finalized by a prior turn-complete). Otherwise
          // start a fresh agent bubble so thinking attaches to the right turn.
          setChatLog((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "agent" && !last.final) {
              return [
                ...prev.slice(0, -1),
                { ...last, thinking: (last.thinking ?? "") + msg.text },
              ];
            }
            return [
              ...prev,
              { role: "agent", text: "", thinking: msg.text, ts: msg.ts },
            ];
          });
          break;
        case "canvas.update":
          setSchema(msg.schema as PipelineSchema);
          break;
        case "results":
          setResults((prev) => {
            const idx = prev.findIndex((r) => r.stageId === msg.stageId);
            if (idx >= 0) {
              const next = prev.slice();
              next[idx] = msg;
              return next;
            }
            return [...prev, msg];
          });
          break;
        case "mflix.collections":
          setMflixRefresh(msg);
          setMflixRefreshing(false);
          break;
        case "connection.status": {
          const component = msg.component ?? "gemini";
          if (component === "atlas") {
            setAtlasConnection(msg.state);
            setAtlasDetail(msg.detail);
          } else {
            setGeminiDetail(msg.detail);
          }
          break;
        }
      }
    },
    [audio, settings.languageMode],
  );

  const ws = useWebSocket({
    onMessage: handleMessage,
    getApiKey: useCallback(
      () => settings.apiKey || undefined,
      [settings.apiKey],
    ),
    getMongoUri: useCallback(
      () => settings.mongoUri || undefined,
      [settings.mongoUri],
    ),
    getLanguageMode: useCallback(
      () => settings.languageMode,
      [settings.languageMode],
    ),
  });

  sendRef.current = useMemo(
    () => (base64: string) => ws.send({ type: "audio", data: base64 }),
    [ws],
  );

  const handleConnect = useCallback(async () => {
    if (mic.state !== "granted") {
      const ok = await mic.request();
      if (!ok) return;
    }
    ws.connect();
  }, [ws, mic]);

  const handleDisconnect = useCallback(() => {
    capture.stop();
    audio.stop();
    ws.disconnect();
    setAgent("idle");
    setAgentDetail(undefined);
  }, [ws, capture, audio]);

  const handleToggleMic = useCallback(() => {
    if (capture.micActive) capture.stop();
    else void capture.start();
  }, [capture]);

  const handleInterrupt = useCallback(() => {
    audio.interrupt();
    ws.send({ type: "interrupt" });
  }, [audio, ws]);

  const handleRefreshMflix = useCallback(() => {
    setMflixRefreshing(true);
    ws.send({ type: "mflix.refresh" });
  }, [ws]);

  // Auto-connect on load when the user has opted in via Settings.
  const didAutoConnect = useRef(false);
  useEffect(() => {
    if (didAutoConnect.current) return;
    if (!settings.autoConnect) return;
    didAutoConnect.current = true;
    void handleConnect();
  }, [settings.autoConnect, handleConnect]);

  // When the Gemini session opens, optionally start the mic immediately.
  const lastWsState = useRef<ConnectionState>(ws.state);
  useEffect(() => {
    if (lastWsState.current !== "connected" && ws.state === "connected") {
      if (!settings.startMicMuted && !capture.micActive && mic.state === "granted") {
        void capture.start();
      }
    }
    lastWsState.current = ws.state;
  }, [ws.state, settings.startMicMuted, capture, mic.state]);

  // Note: do NOT auto-stop the mic when the agent errors. The server already
  // drops audio chunks sent into a closed session, and keeping the mic on lets
  // the user still see their own waveform — useful for diagnosing whether the
  // problem is on the browser side (no mic input) vs the Gemini side (mic
  // works, model rejected). The user can mute manually if they want.

  // When the user changes `sampleFlow` while disconnected, swap the canvas
  // to match — so the toggle feels responsive without waiting for a refresh.
  // We only auto-replace if the canvas isn't currently being driven by an
  // active Gemini session (otherwise the agent's in-flight edits would be
  // wiped out by the new sample).
  const lastAppliedSample = useRef(settings.sampleFlow);
  useEffect(() => {
    if (lastAppliedSample.current === settings.sampleFlow) return;
    lastAppliedSample.current = settings.sampleFlow;
    if (ws.state === "connected") return;
    if (settings.sampleFlow === "data") setSchema(SAMPLE_MFLIX_DEMO_FLOW);
    else if (settings.sampleFlow === "vector") setSchema(SAMPLE_MFLIX_VECTOR_FLOW);
    else setSchema(null);
  }, [settings.sampleFlow, ws.state]);

  // When the user flips Language mode while connected, cycle the Gemini
  // session so the new system instruction + speechConfig take effect. The
  // chat log on the UI side is preserved — only Gemini's session-side
  // context is reset, which is fine since the canvas state is rehydrated
  // into the new system instruction.
  const lastLanguageMode = useRef(settings.languageMode);
  useEffect(() => {
    if (lastLanguageMode.current === settings.languageMode) return;
    lastLanguageMode.current = settings.languageMode;
    if (ws.state === "connected") {
      // Drop a user-styled clarification bubble so the user sees why the
      // session briefly hiccups. Marked final so subsequent transcripts
      // start a fresh bubble.
      setChatLog((prev) => [
        ...prev,
        {
          role: "user",
          kind: "clarification",
          text: `(language mode changed to ${
            settings.languageMode === "english"
              ? "English only"
              : "International"
          } — reconnecting Gemini…)`,
          final: true,
          ts: Date.now(),
        },
      ]);
      ws.disconnect();
      // Briefly wait so the close handler runs before the new connect.
      setTimeout(() => void handleConnect(), 200);
    }
  }, [settings.languageMode, ws, handleConnect]);

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-50">
      <TopBar settings={settings} onSettingsChange={updateSetting} />

      <div className="flex min-h-0 flex-1">
        <div
          className="flex h-full min-w-0 shrink-0 overflow-hidden border-r border-slate-200"
          style={{ width: sidebar.value }}
        >
          <Sidebar
            geminiConnection={ws.state}
            geminiDetail={geminiDetail ?? agentDetail}
            atlasConnection={atlasConnection}
            atlasDetail={atlasDetail}
            agent={agent}
            micActive={capture.micActive}
            micPermission={mic.state}
            audioPaused={audio.paused}
            agentSpeaking={audio.isPlaying}
            micAnalyser={capture.analyser}
            agentAnalyser={audio.analyser}
            chatLog={chatLog}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onToggleMic={handleToggleMic}
            onInterrupt={handleInterrupt}
            onPauseAudio={audio.pause}
            onResumeAudio={audio.resume}
          />
        </div>

        {/* Sidebar resize handle */}
        <div
          className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-blue-400"
          onMouseDown={sidebar.onMouseDown}
        />

        <main ref={mainRef} className="flex min-w-0 flex-1 flex-col">
          <section
            className="relative border-b border-slate-200 bg-white"
            style={{ height: `${flowPct.value}%` }}
          >
            <ReactFlowProvider>
              <TransformationFlow
                schema={schema}
                readOnly
                configDisplayMode="popover"
                onShowOutput={setActiveResultsTab}
              />
            </ReactFlowProvider>
            {!schema && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="rounded-lg bg-white/80 px-6 py-4 text-center text-sm text-slate-500 ring-1 ring-slate-200 backdrop-blur">
                  <div className="font-semibold text-slate-700">
                    Canvas waiting for the agent
                  </div>
                  <div className="mt-1 text-xs">
                    Connect and try saying:{" "}
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">
                      "find movies about a heist gone wrong"
                    </span>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Canvas / results resize handle */}
          <div
            className="h-1 shrink-0 cursor-row-resize bg-transparent transition-colors hover:bg-blue-400"
            onMouseDown={flowPct.onMouseDown}
          />

          <section className="min-h-0 flex-1">
            <ResultsPanel
              schema={schema}
              results={results}
              showSchemaJson={settings.showSchemaJson}
              showSampleData={settings.dataset === "mflix"}
              showMflixCollections={settings.showMflixCollections}
              mflixRefresh={mflixRefresh}
              mflixRefreshing={mflixRefreshing}
              onRefreshMflix={handleRefreshMflix}
              atlasConnected={atlasConnection === "connected"}
              activeTab={activeResultsTab}
              onActiveTabChange={setActiveResultsTab}
            />
          </section>
        </main>
      </div>
    </div>
  );
}
