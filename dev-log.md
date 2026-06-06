# Development log — deprecated attempts

This file tracks the things we tried and dropped during the build. The actual deprecated code lives on the `deprecated` git branch (not `main`), so anyone curious can `git checkout deprecated -- path/to/file` and read it. This log records **what** we tried and **why** it didn't work, so we don't relearn the same lessons.

The deprecated branch is updated only when fresh deprecated code is moved out of `main`. It's not kept in sync with feature work on `main`.

---

## 1. Gemini Live API for streaming voice

**What we tried.** `ai.live.connect()` from `@google/genai` — a single WebSocket session that handles bidirectional audio + tool calls in one stream. The model "listens" while the user speaks and starts reasoning before the utterance ends, returning audio back to the speaker.

**Why we dropped it.** Frequent **close code 1011** mid-stream errors that we could never reliably reproduce. The session would die in the middle of a tool-call sequence, leaving the canvas half-updated and the user staring at silence. Symptoms varied by model alias (`gemini-2.5-flash-native-audio-preview-09-2025` was tolerable; `12-2025` regressed on tool calls; `*-live-preview-*` was Vertex-only and rejected our AI Studio key with close code 1008).

**What replaced it.** An explicit ReAct loop using the standard `ai.chats.create()` + `chat.sendMessage()` path. We can still feed audio in as an `inlineData` Part, but everything else (tool calls, agent text) goes through the regular non-streaming API. Trace events are emitted via our own WebSocket so the UI still feels live.

**Files**: `server/deprecated/geminiStream.ts` (on the deprecated branch).

---

## 2. Voice-first UI

**What we tried.** The initial UX was entirely voice-driven — push-to-talk button, always-on mic, voice visualizer center stage. Text input was a secondary affordance.

**Why we dropped it.** Three compounding problems: (1) the Live API 1011 errors above made voice unreliable end-to-end; (2) `franc-min`-based English detection was over-aggressive on short utterances, marking valid English as "non-English speech"; (3) ghost transcriptions (the model hallucinating phrases from silence, music, or breathing) cluttered the trace timeline.

**What replaced it.** Text-first input with voice as opt-in (`enableVoiceMode` toggle in Settings, off by default). The mic, visualizer, mute button, and transcription pipeline are still there — but hidden until the user wants them. We also bumped the franc-min English-detection threshold to 30 chars and added a noise-transcription allow-list.

**Files**: `ui/deprecated/Sidebar.tsx`, `ui/deprecated/useAudioCapture.ts`, `ui/deprecated/useAudioPlayback.ts`, `ui/deprecated/useMicPermission.ts` (deprecated branch).

---

## 3. Live `$vectorSearch` against `embedded_movies`

**What we tried.** The first version of the system instruction routed all vibes/semantic queries to `$vectorSearch` against `sample_mflix.embedded_movies`'s `plot_vector_index`. The agent would emit something like `$vectorSearch: { queryText: "lone cowboys ruthless outlaws" }`.

**Why we dropped it.** `$vectorSearch` requires a precomputed `queryVector` — a 1536-dim float array compatible with the indexed `plot_embedding` field. The vectors that ship with `embedded_movies` come from a third-party embedding service we don't integrate with at request time, so the agent has no way to generate a matching `queryVector`. Every attempt failed with either *"Exactly one and only one of `query` and `queryVector` can be present"* or silently returned 0 documents because Mongo ignored the unknown parameter. After 6+ retries the agent would hit the iteration cap and stop.

**What replaced it.** A two-path routing rule in the system instruction:
- Conceptual / vibes-based queries → `$match` with the `$text` operator against `sample_mflix.movies` (which has a real text index on `cast`, `fullplot`, `genres`, `title`). The canvas still shows the purple `MQL_VECTOR_SEARCH` node so the demo aesthetic is preserved.
- Exact-equality queries (named people, years, genres, etc.) → plain `$match`, rendered as the standard `MQL_MATCH` node.

The vector index remains in the cluster for a future extension where we could wire in a compatible embedding service.

---

## 4. Browser-side Gemini embeddings as a `$vectorSearch` workaround

**What we considered (briefly).** Generate query embeddings on the browser side using a Gemini embedding model and pass them as `queryVector` to `$vectorSearch`.

**Why we didn't pursue it.** Dimension mismatch. Gemini's text-embedding models produce different dimensions than the 1536-dim `plot_embedding` field in the sample dataset, and different embedding models live in different vector spaces — distances aren't comparable across them. We would have needed to re-embed the entire corpus with a Gemini model and create a new index, which was outside the hackathon scope.

---

## 5. Auto-mute on background noise

**What we tried.** Voice activity detection (VAD) was wired to auto-cut transcription when amplitude dropped below a threshold, on the theory that this would suppress music / breathing / background chatter.

**Why we dropped it.** Too aggressive. Cut off the user mid-word more often than it suppressed noise, because VAD windows are shorter than natural pauses in speech. Worse, the recovery wasn't smooth — the next utterance often arrived cropped.

**What replaced it.** Hysteresis-based VAD (different on/off thresholds, with grace windows), plus server-side noise-transcription filtering for known hallucinations (`__SILENCE__`, "thanks for watching", lone periods).

---

## 6. Hand-rolled ReAct loop on `@google/genai`

**What we tried.** Our first server-side agent was a custom ReAct loop driving `ai.chats.create()` + `chat.sendMessage()` from `@google/genai` directly. We dispatched tool calls ourselves, managed a `MAX_TOOL_ITERATIONS = 8` cap, dispatched custom tools (`update_canvas`, `push_results`, `run_pipeline`, `suggest_next_prompts`) and the MongoDB MCP tools via separate code paths, and emitted trace events for every loop iteration.

**Why we dropped it.** Two reasons: (1) the **Google Cloud Rapid Agent Hackathon** requires the agent to live inside the **Google Cloud Agent Builder ecosystem**, and the bare Gemini API SDK isn't unambiguously part of that ecosystem — `@google/adk` (Agent Development Kit) is. (2) The hand-rolled loop duplicated a lot of plumbing that ADK provides for free: tool argument validation, function-declaration generation from typed schemas, MCP tool discovery + schema mapping, before/after-tool callbacks for observability.

**What replaced it.** `@google/adk` (`LlmAgent` + `InMemoryRunner` + `MCPToolset` + `FunctionTool`). The four custom tools moved from `FunctionDeclaration` objects + a manual switch dispatch into `FunctionTool` instances with explicit `execute` callbacks. The MongoDB MCP server is now exposed via ADK's `MCPToolset` (separate stdio connection per session, allow-listed to six data-operation tools). Trace events still flow through the same WebSocket protocol; we hook ADK's `beforeToolCallback` / `afterToolCallback` to emit them. The UI didn't change at all — same `tool_call_start` / `tool_call_result` / `suggested_prompts` traces hit the chat panel.

**Files**: `server/src/agent/agentLoop.ts` (and the older `customTools.ts` that returned `FunctionDeclaration[]`) live on the `deprecated` branch. Run the deprecated branch and the app behaves identically to the post-ADK build — useful as a fallback if we ever need to A/B between the two orchestrators.

---

## 7. Voice-first status bar inside the chat sidebar

**What we tried.** A persistent StatusBar at the top of the left sidebar showing MongoDB Atlas + Gemini + Transcript connection states, with inline Connect / Disconnect / Mute buttons and a save-confirmation strip. Designed to make voice-session state legible in the chat panel.

**Why we dropped it.** Once voice became opt-in and the layout shifted to side-by-side canvas + results, the StatusBar consumed ~120px at the top of the sidebar that the chat trace needed. With voice off (the default), most of the StatusBar was redundant with the WebSocket connection state.

**What replaced it.** Status pills + state-aware Connect button moved into the TopBar (always visible, no vertical real estate cost). The mute button moved into the chat panel's voice section, where it lives only when voice mode is on.

---

## How to add to this log

When you remove or replace a feature large enough that someone might wonder "why did they stop doing X?":

1. Move the deprecated code to the `deprecated` branch:
   ```bash
   git checkout deprecated
   git checkout main -- <paths>
   git commit -m "Park <feature> from main"
   git checkout main
   git rm <paths>
   git commit -m "Remove deprecated <feature>"
   ```
2. Add a section here with the **What we tried** / **Why we dropped it** / **What replaced it** template. Keep it short — one paragraph per heading. The point is institutional memory, not exhaustive postmortems.
