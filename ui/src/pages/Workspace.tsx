import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Mic, MicOff, Plug, PlugZap } from "lucide-react";
import { TransformationFlow } from "@/components/flow/TransformationFlow";
import TopBar from "@/components/voice/TopBar";
import {
  AgentChatPanel,
  type ChatEntry,
} from "@/components/chat/AgentChatPanel";
import { useVoiceCapture } from "@/hooks/useVoiceCapture";
import { useWebSpeech } from "@/hooks/useWebSpeech";
import { useGeminiLiveTranscript } from "@/hooks/useGeminiLiveTranscript";
import { isLikelyEnglish } from "@/lib/englishDetect";
import { cn } from "@/lib/Utils";
// DEPRECATED voice components — moved to `ui/deprecated/`.
// import Sidebar from "@/components/voice/Sidebar";
// import { useAudioCapture } from "@/hooks/useAudioCapture";
// import { useAudioPlayback } from "@/hooks/useAudioPlayback";
// import { useMicPermission } from "@/hooks/useMicPermission";
import ResultsPanel from "@/components/results/ResultsPanel";
import { useDragResize } from "@/hooks/useDragResize";
import { useSettings } from "@/hooks/useSettings";
import { useWebSocket } from "@/hooks/useWebSocket";
import {
  SAMPLE_MFLIX_DEMO_FLOW,
  SAMPLE_MFLIX_VECTOR_FLOW,
} from "@/samples/sampleFlow";
import type { PipelineSchema } from "@/Schema";
import type {
  ConnectionState,
  MflixCollectionsMessage,
  ResultsMessage,
  ServerMessage,
} from "@/types/ws";

const SIDEBAR_MIN = 320;
const SIDEBAR_MAX = 560;
const SIDEBAR_DEFAULT = 380;

const FLOW_PCT_MIN = 20;
const FLOW_PCT_MAX = 85;
const FLOW_PCT_DEFAULT = 60;

/**
 * Sanity-fill an agent-supplied schema. The agent will sometimes call
 * `update_canvas` with a partial payload — missing `pipeline` metadata,
 * `layout`, or even `stages` — and the rest of the UI then crashes on
 * unguarded access like `schema.pipeline.name`. Normalize once at the
 * message boundary so downstream code can trust the shape.
 */
/** Treat any non-string as missing — protects React from rendering raw
 *  objects when the agent ships a malformed payload. */
function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

// Layered DAG auto-layout. The agent doesn't reliably set positions, and
// the ones it does set tend to be (0,0) or arbitrary, so we always
// overwrite — better a predictable, branching-aware layout than randomness.
const CANVAS_NODE_X = 80;
const CANVAS_NODE_Y0 = 60;
const CANVAS_VERTICAL_GAP = 160;
const CANVAS_HORIZONTAL_GAP = 240;

type StageLike = {
  id: string;
  depends_on?: unknown;
};

/** Topological order over depends_on, falling back to array order for ties
 *  and for any cycle remainder. Used for the sequential-chain edge fallback
 *  when the agent ships stages without `depends_on`. */
function topoOrderByDependsOn(stages: StageLike[]): string[] {
  const ids = stages.map((s) => s.id);
  const indexById = new Map(ids.map((id, i) => [id, i]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  const adj = new Map(ids.map((id) => [id, [] as string[]]));

  for (const stage of stages) {
    const deps = Array.isArray(stage.depends_on) ? stage.depends_on : [];
    for (const dep of deps) {
      if (typeof dep !== "string" || !indegree.has(dep)) continue;
      adj.get(dep)!.push(stage.id);
      indegree.set(stage.id, (indegree.get(stage.id) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of indegree) if (deg === 0) queue.push(id);
  queue.sort((a, b) => (indexById.get(a) ?? 0) - (indexById.get(b) ?? 0));

  const ordered: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    ordered.push(id);
    const next = (adj.get(id) ?? [])
      .slice()
      .sort((a, b) => (indexById.get(a) ?? 0) - (indexById.get(b) ?? 0));
    for (const nid of next) {
      const d = (indegree.get(nid) ?? 0) - 1;
      indegree.set(nid, d);
      if (d === 0) queue.push(nid);
    }
  }
  if (ordered.length < ids.length) {
    const seen = new Set(ordered);
    for (const id of ids) if (!seen.has(id)) ordered.push(id);
  }
  return ordered;
}

/** Two-axis DAG layout for branching pipelines.
 *  - y (depth) = longest path from any source. Children always sit below
 *    their parents so flow direction reads top-down.
 *  - x (column) = first child of each branching point keeps its parent's
 *    column; subsequent children get fresh columns to the right. This puts
 *    "branch 1" directly under the lookup and "branch 2" to its right —
 *    rather than stacking them on top of each other in a single line.
 *  Stage-array order is used as a tiebreaker so the agent's emit order
 *  determines which branch is "primary". */
function layoutBranchingDag(
  stageIds: string[],
  edges: Array<{ source: string; target: string }>,
): Array<{ id: string; position: { x: number; y: number } }> {
  const idSet = new Set(stageIds);
  const indexById = new Map(stageIds.map((id, i) => [id, i]));
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const id of stageIds) {
    children.set(id, []);
    parents.set(id, []);
  }
  for (const e of edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
    children.get(e.source)!.push(e.target);
    parents.get(e.target)!.push(e.source);
  }

  // Depth = longest path from any source. Children always sit one row
  // below their deepest parent, so even when a node has multiple parents,
  // edges always point downward.
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  function getDepth(id: string): number {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    const ps = parents.get(id) ?? [];
    const d = ps.length === 0 ? 0 : Math.max(...ps.map(getDepth)) + 1;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  }
  for (const id of stageIds) getDepth(id);

  // Column assignment: DFS from sources, first child inherits parent's
  // column, later children get freshly-allocated columns to the right.
  const column = new Map<string, number>();
  let nextCol = 0;
  function assign(id: string, col: number): void {
    if (column.has(id)) return;
    column.set(id, col);
    const kids = (children.get(id) ?? [])
      .slice()
      .sort((a, b) => (indexById.get(a) ?? 0) - (indexById.get(b) ?? 0));
    for (let i = 0; i < kids.length; i++) {
      const c = i === 0 ? col : nextCol++;
      assign(kids[i], c);
    }
  }
  const sources = stageIds
    .filter((id) => (parents.get(id) ?? []).length === 0)
    .sort((a, b) => (indexById.get(a) ?? 0) - (indexById.get(b) ?? 0));
  for (const id of sources) assign(id, nextCol++);
  for (const id of stageIds) {
    if (!column.has(id)) column.set(id, nextCol++);
  }

  return stageIds.map((id) => ({
    id,
    position: {
      x: CANVAS_NODE_X + (column.get(id) ?? 0) * CANVAS_HORIZONTAL_GAP,
      y: CANVAS_NODE_Y0 + (depth.get(id) ?? 0) * CANVAS_VERTICAL_GAP,
    },
  }));
}

function normalizeAgentSchema(raw: unknown): PipelineSchema | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<PipelineSchema>;
  // Backfill `output` for any stage that's missing it AND coerce all
  // identity fields to strings. The agent occasionally puts an object where
  // a string belongs (e.g. `output: {}`), which crashes downstream
  // renderers ("Objects are not valid as a React child").
  const stages = Array.isArray(s.stages)
    ? s.stages.map((stage, i) => {
        const op = stage.operation as { collection?: string } | undefined;
        const id = asString(stage.id) ?? `stage_${i + 1}`;
        const name = asString(stage.name) ?? id;
        const type = asString(stage.type) ?? "MQL_SOURCE";
        const output =
          asString(stage.output) ??
          asString(op?.collection) ??
          name ??
          id;
        return {
          ...stage,
          id,
          name,
          type: type as typeof stage.type,
          output,
        };
      })
    : [];

  // Derive edges from depends_on first (authoritative). If no stage declared
  // a dependency (single-stage pipeline, or agent skipped depends_on), fall
  // back to chaining consecutive stages so the canvas at least shows flow.
  const derivedEdges: { id: string; source: string; target: string }[] = [];
  for (const stage of stages) {
    const deps = Array.isArray(stage.depends_on) ? stage.depends_on : [];
    for (const dep of deps) {
      if (typeof dep !== "string") continue;
      if (!stages.some((st) => st.id === dep)) continue;
      derivedEdges.push({
        id: `e-${dep}-${stage.id}`,
        source: dep,
        target: stage.id,
      });
    }
  }
  const ordered = topoOrderByDependsOn(stages);
  const edges =
    derivedEdges.length > 0
      ? derivedEdges
      : ordered.slice(1).map((id, i) => ({
          id: `e-${ordered[i]}-${id}`,
          source: ordered[i],
          target: id,
        }));

  // Compute layout from the same edge set that drives connectivity, so
  // branches read as branches (parallel columns) rather than a single
  // vertical line.
  const layoutNodes = layoutBranchingDag(
    stages.map((s) => s.id),
    edges,
  );

  return {
    version: "1.0",
    pipeline: {
      name: asString(s.pipeline?.name) ?? "pipeline",
      createdAt: asString(s.pipeline?.createdAt) ?? new Date().toISOString(),
      description: asString(s.pipeline?.description),
    },
    datasets:
      s.datasets && typeof s.datasets === "object" && !Array.isArray(s.datasets)
        ? s.datasets
        : {},
    stages,
    layout: {
      nodes: layoutNodes,
      edges,
    },
  };
}

export default function Workspace() {
  const { settings, update: updateSetting } = useSettings();

  const initialSchema =
    settings.sampleFlow === "data"
      ? SAMPLE_MFLIX_DEMO_FLOW
      : settings.sampleFlow === "vector"
        ? SAMPLE_MFLIX_VECTOR_FLOW
        : null;
  const [schema, setSchema] = useState<PipelineSchema | null>(initialSchema);
  const [results, setResults] = useState<ResultsMessage[]>([]);
  const [activeResultsTab, setActiveResultsTab] = useState<string | null>(null);
  const [mflixRefresh, setMflixRefresh] =
    useState<MflixCollectionsMessage | null>(null);
  const [mflixRefreshing, setMflixRefreshing] = useState(false);
  const [atlasConnection, setAtlasConnection] =
    useState<ConnectionState>("disconnected");
  const [atlasDetail, setAtlasDetail] = useState<string | undefined>(undefined);
  // Separate from ws.state: ws.state goes "connected" the moment the WebSocket
  // handshake completes, but the server still needs ~1-8 s to spawn MCP and
  // build the AgentLoop. Voice capture must wait on `geminiConnection` to
  // avoid sending audio before the agent is ready ("Agent isn't initialized…"
  // trace errors).
  const [geminiConnection, setGeminiConnection] =
    useState<ConnectionState>("disconnected");
  const [geminiDetail, setGeminiDetail] = useState<string | undefined>(undefined);
  // Transient confirmation surfaced in the sidebar after the user clicks Save
  // in Settings. Auto-clears after 6s so it doesn't linger.
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const saveNoticeTimerRef = useRef<number | null>(null);
  const flashSaveNotice = useCallback((message: string) => {
    setSaveNotice(message);
    if (saveNoticeTimerRef.current != null) {
      window.clearTimeout(saveNoticeTimerRef.current);
    }
    saveNoticeTimerRef.current = window.setTimeout(() => {
      setSaveNotice(null);
      saveNoticeTimerRef.current = null;
    }, 6000);
  }, []);
  // Chat + trace timeline for the new agent panel. Each `user.text` send and
  // each incoming `trace` event appends one entry. The agent is "busy" from
  // the moment a user turn is dispatched until a `turn_complete` trace lands.
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const entryIdRef = useRef(0);
  const nextEntryId = useCallback(() => `e-${++entryIdRef.current}`, []);

  // Layout — drag-to-resize for sidebar width and canvas/results split.
  const mainRef = useRef<HTMLDivElement>(null);
  const sidebar = useDragResize<number>(
    SIDEBAR_DEFAULT,
    "x",
    (e) =>
      Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, e.clientX)),
  );
  // The canvas/results split has two flavors depending on `layoutMode`:
  //   stacked → vertical drag (Y axis), canvas height %.
  //   side-by-side → horizontal drag (X axis), canvas width %.
  // We keep separate hook instances so each remembers its own drag position
  // and the user can switch back and forth without losing their layout.
  const flowPctStacked = useDragResize<number>(FLOW_PCT_DEFAULT, "y", (e) => {
    const rect = mainRef.current?.getBoundingClientRect();
    if (!rect) return FLOW_PCT_DEFAULT;
    const pct = ((e.clientY - rect.top) / rect.height) * 100;
    return Math.max(FLOW_PCT_MIN, Math.min(FLOW_PCT_MAX, pct));
  });
  const flowPctSideBySide = useDragResize<number>(50, "x", (e) => {
    const rect = mainRef.current?.getBoundingClientRect();
    if (!rect) return 50;
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    return Math.max(FLOW_PCT_MIN, Math.min(FLOW_PCT_MAX, pct));
  });

  const handleMessage = useCallback(
    (msg: ServerMessage) => {
      switch (msg.type) {
        // DEPRECATED Live API streams — silently ignored.
        case "audio":
        case "agent.status":
        case "transcript":
        case "thinking":
          break;
        case "canvas.update":
          setSchema(normalizeAgentSchema(msg.schema));
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
            setGeminiConnection(msg.state);
            setGeminiDetail(msg.detail);
          }
          break;
        }
        case "trace": {
          // Apply the english-only / international rule to incoming
          // user_text traces (the server-side transcription of the user's
          // voice). Mirrors the behavior the deprecated Live UI had:
          //   - international mode: show transcription as-is.
          //   - english mode: if the transcription doesn't look like
          //     English, swap the bubble's text for a clarification line.
          let inbound = msg;
          if (
            msg.kind === "user_text" &&
            settings.languageMode === "english" &&
            msg.text &&
            !isLikelyEnglish(msg.text)
          ) {
            inbound = {
              ...msg,
              text: "(non-English speech — English-only mode)",
            };
          }

          // tool_call_result events need the corresponding start's args
          // attached so the expanded card shows {args + result}. We keep
          // BOTH events in the timeline (start as "Calling X…", result as
          // "Called X") but the result carries the args along for display.
          if (msg.kind === "tool_call_result") {
            setChatEntries((prev) => {
              let augmented = msg;
              for (let i = prev.length - 1; i >= 0; i--) {
                const e = prev[i];
                if (
                  e.kind === "trace" &&
                  e.trace.kind === "tool_call_start" &&
                  e.trace.label === msg.label
                ) {
                  augmented = { ...msg, args: e.trace.payload };
                  break;
                }
              }
              return [
                ...prev,
                { kind: "trace", trace: augmented, id: nextEntryId() },
              ];
            });
            break;
          }

          setChatEntries((prev) => [
            ...prev,
            { kind: "trace", trace: inbound, id: nextEntryId() },
          ]);
          if (msg.kind === "turn_complete") {
            setAgentBusy(false);
          }
          break;
        }
      }
    },
    [nextEntryId, settings.languageMode],
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
    // Language enforcement only applies when voice mode is on. In text mode
    // the user types in whatever language they want and we let the model
    // respond in kind — no English-only filter, no system-instruction
    // language rule.
    getLanguageMode: useCallback(
      () =>
        settings.enableVoiceMode ? settings.languageMode : "international",
      [settings.enableVoiceMode, settings.languageMode],
    ),
  });

  const handleConnect = useCallback(() => {
    ws.connect();
  }, [ws]);

  const handleDisconnect = useCallback(() => {
    ws.disconnect();
  }, [ws]);

  const handleRefreshMflix = useCallback(() => {
    setMflixRefreshing(true);
    ws.send({ type: "mflix.refresh" });
  }, [ws]);

  const handleSendText = useCallback(
    (text: string) => {
      setChatEntries((prev) => [
        ...prev,
        { kind: "user_text", text, ts: Date.now(), id: nextEntryId() },
      ]);
      setAgentBusy(true);
      ws.send({ type: "user.text", text });
    },
    [ws, nextEntryId],
  );

  const handleSendAudio = useCallback(
    (clip: { data: string; mimeType: string; durationMs: number }) => {
      // No optimistic "voice 1.9s sent" pill — the server's transcription
      // trace will land momentarily and render as the actual text bubble,
      // following english-only / international rules.
      setAgentBusy(true);
      ws.send({
        type: "user.audio",
        mimeType: clip.mimeType,
        data: clip.data,
      });
    },
    [ws],
  );

  // Always-on voice capture with VAD-based utterance segmentation. When the
  // user speaks, an utterance fires; we hand it off to the same audio-send
  // path used by the push-to-talk button. Mic is auto-started on WS connect
  // and torn down on disconnect.
  const voice = useVoiceCapture({
    onUtterance: handleSendAudio,
  });

  // Browser-side STT (Chrome/Edge/Safari). Runs in parallel with the audio
  // capture above — when the recognizer finalizes an utterance, we push it
  // into the timeline as a user_text trace. The audio still goes to Gemini
  // through `voice` for the agent's reasoning; Web Speech is purely for the
  // visible transcript.
  const handleLocalTranscript = useCallback(
    (text: string) => {
      // Apply the English-only filter just like server-side transcripts.
      const display =
        settings.languageMode === "english" && !isLikelyEnglish(text)
          ? "(non-English speech — English-only mode)"
          : text;
      setChatEntries((prev) => [
        ...prev,
        {
          kind: "trace",
          trace: {
            type: "trace",
            kind: "user_text",
            text: display,
            ts: Date.now(),
          },
          id: nextEntryId(),
        },
      ]);
    },
    [nextEntryId, settings.languageMode],
  );
  // Both hooks are always instantiated so React's hooks order stays stable;
  // we route audio start/stop to whichever the user selected. Web Speech is
  // free + zero-latency but quality varies; Gemini Live yields the same ASR
  // engine that powers Google's audio products — typically much better.
  const webSpeech = useWebSpeech({ onTranscript: handleLocalTranscript });
  const liveTranscript = useGeminiLiveTranscript({
    onTranscript: handleLocalTranscript,
    getApiKey: useCallback(
      () => settings.apiKey || undefined,
      [settings.apiKey],
    ),
  });

  // Auto-connect on load when the user has opted in via Settings.
  const didAutoConnect = useRef(false);
  useEffect(() => {
    if (didAutoConnect.current) return;
    if (!settings.autoConnect) return;
    didAutoConnect.current = true;
    handleConnect();
  }, [settings.autoConnect, handleConnect]);

  // When the WS drops, reset the server-driven gemini connection state too —
  // otherwise a stale "connected" leaks across sessions.
  const lastWsState = useRef(ws.state);
  useEffect(() => {
    const prev = lastWsState.current;
    if (prev === "connected" && ws.state !== "connected") {
      setGeminiConnection("disconnected");
      setGeminiDetail(undefined);
      setAgentBusy(false);
    }
    lastWsState.current = ws.state;
  }, [ws.state]);

  // Pick the active transcription hook based on the user's setting. Both
  // are instantiated above; this just selects which one to run. We expose a
  // normalized `{ start, stop, isIdle, status, statusDetail }` shape so the
  // effects + sidebar UI below don't care which underlying hook is active.
  const activeTranscript = useMemo(() => {
    if (settings.transcriptionMethod === "live") {
      // Map liveTranscript.state → a 5-state status the StatusRow can render.
      const status: ConnectionState =
        liveTranscript.state === "listening"
          ? "connected"
          : liveTranscript.state === "connecting"
            ? "connecting"
            : liveTranscript.state === "error"
              ? "error"
              : "disconnected";
      return {
        start: () => liveTranscript.start(),
        stop: () => liveTranscript.stop(),
        isIdle: () => liveTranscript.state === "idle",
        method: "live" as const,
        status,
        statusDetail: liveTranscript.errorDetail ?? undefined,
      };
    }
    const status: ConnectionState = webSpeech.running
      ? "connected"
      : webSpeech.supported
        ? "disconnected"
        : "error";
    return {
      start: () => webSpeech.start(),
      stop: () => webSpeech.stop(),
      isIdle: () => !webSpeech.running,
      method: "webspeech" as const,
      status,
      statusDetail: webSpeech.supported
        ? undefined
        : "Web Speech API not supported in this browser (try Chrome / Edge).",
    };
  }, [
    settings.transcriptionMethod,
    liveTranscript,
    webSpeech,
  ]);

  // Auto-start (or stop) the always-on mic when the AGENT is ready, not just
  // when the WebSocket handshake completes. Otherwise utterances captured
  // during MCP probe (~1-8 s) hit the server before `agent` is built and
  // surface as "Agent isn't initialized yet" error traces.
  //
  // Voice mode gates ALL audio paths: when off, we never request the mic,
  // never open the transcription session, and the sidebar's audio chrome
  // is hidden.
  const voiceMode = settings.enableVoiceMode;
  const lastGeminiState = useRef(geminiConnection);
  useEffect(() => {
    const prev = lastGeminiState.current;
    if (prev !== "connected" && geminiConnection === "connected") {
      if (voiceMode) {
        void voice.start();
        void activeTranscript.start();
      }
    }
    if (prev === "connected" && geminiConnection !== "connected") {
      voice.stop();
      activeTranscript.stop();
    }
    lastGeminiState.current = geminiConnection;
  }, [geminiConnection, voice, activeTranscript, voiceMode]);

  // Tear everything down when the user flips voice mode off mid-session,
  // start it back up when they flip it on while connected.
  const lastVoiceMode = useRef(voiceMode);
  useEffect(() => {
    if (lastVoiceMode.current === voiceMode) return;
    lastVoiceMode.current = voiceMode;
    if (!voiceMode) {
      voice.stop();
      activeTranscript.stop();
    } else if (geminiConnection === "connected") {
      void voice.start();
      void activeTranscript.start();
    }
  }, [voiceMode, geminiConnection, voice, activeTranscript]);

  // Pause transcription when the user mutes (so it doesn't keep streaming
  // room noise and feeding ghost messages into the trace).
  useEffect(() => {
    if (!voiceMode) return;
    if (geminiConnection !== "connected") return;
    if (voice.muted) {
      activeTranscript.stop();
    } else if (activeTranscript.isIdle()) {
      void activeTranscript.start();
    }
  }, [voice.muted, geminiConnection, activeTranscript, voiceMode]);

  // When the user flips transcription method, stop the previous hook and
  // start the new one. Keeping both running would create duplicate trace
  // entries for every utterance.
  const lastTranscriptionMethod = useRef(settings.transcriptionMethod);
  useEffect(() => {
    if (lastTranscriptionMethod.current === settings.transcriptionMethod) return;
    lastTranscriptionMethod.current = settings.transcriptionMethod;
    if (geminiConnection !== "connected") return;
    // Stop both, then start whichever is now active.
    webSpeech.stop();
    liveTranscript.stop();
    void activeTranscript.start();
  }, [
    settings.transcriptionMethod,
    geminiConnection,
    webSpeech,
    liveTranscript,
    activeTranscript,
  ]);

  // Auto-switch the results panel to a newly-populated stage's tab — but
  // only AFTER `push_results` lands, so the user doesn't get yanked to a
  // blank "Waiting for results" placeholder while the agent is still
  // working. We track which stageIds we've already seen results for; the
  // first time a brand-new one arrives, we switch the active tab.
  const seenResultStageIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const r of results) {
      if (!seenResultStageIdsRef.current.has(r.stageId)) {
        seenResultStageIdsRef.current.add(r.stageId);
        setActiveResultsTab(r.stageId);
      }
    }
  }, [results]);

  // When the user changes `sampleFlow` in Settings, swap the canvas (and
  // clear any accumulated results) immediately.
  const lastAppliedSample = useRef(settings.sampleFlow);
  useEffect(() => {
    if (lastAppliedSample.current === settings.sampleFlow) return;
    lastAppliedSample.current = settings.sampleFlow;
    if (settings.sampleFlow === "data") setSchema(SAMPLE_MFLIX_DEMO_FLOW);
    else if (settings.sampleFlow === "vector") setSchema(SAMPLE_MFLIX_VECTOR_FLOW);
    else setSchema(null);
    setResults([]);
    setActiveResultsTab(null);
    seenResultStageIdsRef.current.clear();
  }, [settings.sampleFlow]);

  // Single consolidated status block — one bordered card containing both
  // connection rows, the (rare) save notice, and the action buttons. Easier
  // to scan than two stacked sections.
  const isConnected = ws.state === "connected";
  const isConnecting = ws.state === "connecting";
  // Effective Gemini state: WS open but server hasn't finished spawning the
  // agent yet → show "connecting" rather than "disconnected" so the user
  // doesn't think nothing is happening during the ~1-8 s MCP probe.
  const geminiEffective: ConnectionState =
    ws.state === "connected" && geminiConnection !== "connected"
      ? "connecting"
      : geminiConnection;
  // Vertical-stacked status block — sits at the top of the sidebar above
  // the chat panel. Compact rows + a buttons row underneath, plus optional
  // save-notice / error strips. Same general shape as gemini-data-wrangler.
  const StatusBar = useMemo(
    () => (
      <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-3 space-y-2.5">
        {saveNotice && (
          <div className="rounded border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs leading-snug text-blue-700">
            ✓ {saveNotice}
          </div>
        )}
        <StatusRow
          label="MongoDB Atlas"
          state={atlasConnection}
          detail={atlasDetail}
        />
        <StatusRow
          label="Gemini"
          state={geminiEffective}
          detail={geminiEffective === "connected" ? geminiDetail : undefined}
        />
        {voiceMode && (
          <StatusRow
            label={
              activeTranscript.method === "live"
                ? "Transcript (Live)"
                : "Transcript (Web Speech)"
            }
            state={activeTranscript.status}
            detail={activeTranscript.statusDetail}
          />
        )}
        <div className="flex min-w-0 gap-2 pt-1">
          {isConnected ? (
            <CtrlButton
              onClick={handleDisconnect}
              className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              title="Disconnect from agent"
            >
              <Plug className="h-3.5 w-3.5" />
              Disconnect
            </CtrlButton>
          ) : (
            <CtrlButton
              onClick={handleConnect}
              disabled={isConnecting}
              className="border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              title="Connect to agent"
            >
              <PlugZap className="h-3.5 w-3.5" />
              {isConnecting ? "Connecting…" : "Connect"}
            </CtrlButton>
          )}
          {voiceMode && (
            <CtrlButton
              onClick={() => voice.setMuted(!voice.muted)}
              disabled={!isConnected || voice.state === "error"}
              className={cn(
                voice.muted
                  ? "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
              )}
              title={
                voice.state === "error"
                  ? voice.errorDetail ?? "Microphone unavailable"
                  : voice.muted
                    ? "Unmute mic"
                    : "Mute mic"
              }
            >
              {voice.muted ? (
                <>
                  <MicOff className="h-3.5 w-3.5" /> Unmute
                </>
              ) : (
                <>
                  <Mic className="h-3.5 w-3.5" /> Mute
                </>
              )}
            </CtrlButton>
          )}
        </div>
      </div>
    ),
    [
      atlasConnection,
      atlasDetail,
      geminiEffective,
      geminiDetail,
      saveNotice,
      isConnected,
      isConnecting,
      handleConnect,
      handleDisconnect,
      voice.muted,
      voice.state,
      voice.errorDetail,
      voice.setMuted,
      activeTranscript.method,
      activeTranscript.status,
      activeTranscript.statusDetail,
      voiceMode,
    ],
  );

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-50">
      <TopBar
        settings={settings}
        onSettingsChange={updateSetting}
        onSaveNotice={flashSaveNotice}
      />

      <div className="flex min-h-0 flex-1">
        <div
          className="flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white"
          style={{ width: sidebar.value }}
        >
          {StatusBar}
          <div className="min-h-0 flex-1">
            <AgentChatPanel
              entries={chatEntries}
              onSendText={handleSendText}
              busy={agentBusy}
              connected={ws.state === "connected"}
              enableTextInput={settings.enableTextInput}
              voiceMode={voiceMode}
              voice={{
                state: voice.state,
                muted: voice.muted,
                setMuted: voice.setMuted,
                errorDetail: voice.errorDetail,
                analyser: voice.analyser,
              }}
            />
          </div>
        </div>

        {/* Sidebar resize handle */}
        <div
          className="w-1 shrink-0 cursor-col-resize bg-slate-200 transition-colors hover:bg-blue-400"
          onMouseDown={sidebar.onMouseDown}
        />

        {(() => {
          const stacked = settings.layoutMode === "stacked";
          const flowPct = stacked ? flowPctStacked : flowPctSideBySide;
          const canvasSize: React.CSSProperties = stacked
            ? { height: `${flowPct.value}%` }
            : { width: `${flowPct.value}%` };
          const resultsSize: React.CSSProperties = stacked
            ? { height: `${100 - flowPct.value}%` }
            : { width: `${100 - flowPct.value}%` };

          const canvasSection = (
            <section
              className={cn(
                "relative bg-white",
                stacked ? "border-b border-slate-200" : "border-r border-slate-200",
              )}
              style={canvasSize}
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
                      Connect and ask, e.g.:{" "}
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">
                        "find movies about a heist gone wrong"
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </section>
          );

          const splitHandle = (
            <div
              className={cn(
                "shrink-0 bg-slate-200 transition-colors hover:bg-blue-400",
                stacked
                  ? "h-1 cursor-row-resize"
                  : "w-1 cursor-col-resize",
              )}
              onMouseDown={flowPct.onMouseDown}
            />
          );

          const resultsSection = (
            <section className="min-h-0 min-w-0" style={resultsSize}>
              <ResultsPanel
                schema={schema}
                results={results}
                showSchemaJson={settings.showSchemaJson}
                showMflixCollections={settings.showMflixCollections}
                mflixRefresh={mflixRefresh}
                mflixRefreshing={mflixRefreshing}
                onRefreshMflix={handleRefreshMflix}
                atlasConnected={atlasConnection === "connected"}
                activeTab={activeResultsTab}
                onActiveTabChange={setActiveResultsTab}
                splitOrientation={stacked ? "horizontal" : "vertical"}
                agentBusy={agentBusy}
              />
            </section>
          );

          return (
            <main
              ref={mainRef}
              className={cn(
                "flex min-w-0 flex-1",
                stacked ? "flex-col" : "flex-row",
              )}
            >
              {canvasSection}
              {splitHandle}
              {resultsSection}
            </main>
          );
        })()}
      </div>
    </div>
  );
}

/* ───────────── Sidebar status helpers (match the pre-refactor look) ───────────── */

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

/** Vertical status row used in the sidebar's StatusBar block. Label on the
 *  left with a colored dot; state text on the right. Errors expand into a
 *  rose-tinted detail strip below the row. */
function StatusRow({
  label,
  state,
  detail,
}: {
  label: string;
  state: ConnectionState;
  detail?: string;
}) {
  const isError = state === "error";
  return (
    <div className="space-y-1 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusDot state={state} />
          <span className="font-medium text-slate-700">{label}</span>
        </div>
        <span
          className={cn(
            "truncate text-xs",
            isError ? "text-rose-600" : "text-slate-500",
          )}
          title={detail}
        >
          {isError ? "Error" : statusLabel(state, detail)}
        </span>
      </div>
      {isError && detail && (
        <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs leading-snug text-rose-700">
          {detail}
        </div>
      )}
    </div>
  );
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
        "inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium shadow-sm transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}
