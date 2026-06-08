# Gemini NoSQL Data Wrangler

> **Build MongoDB aggregation pipelines by talking to an agent — and watch it work.**
> Submitted to the **Google Cloud Rapid Agent Hackathon**.

An agentic NoSQL pipeline builder powered by **Gemini 3 Flash** and the **MongoDB MCP server**. Type a question in plain English ("find me movies about lone cowboys", "group his films by year and show me average IMDB rating") and watch the agent reason out loud, design the pipeline on a live canvas, and run it against MongoDB Atlas — stage by stage, with results filling in as each step lands.

![placeholder for demo gif](docs/demo-placeholder.png)

---

## What's novel here

Three pieces that didn't exist together in one place before this project:

- **`run_pipeline` server tool with `$facet` previews.** The agent emits one MongoDB aggregation pipeline; the server wraps it in `$facet` so every canvas stage gets its own preview row in a single round-trip. The underlying pipeline still sees the full collection — only the per-stage UI display is limited. This means "show me the data at every step" comes free, with no extra latency.
- **Branching-aware DAG layout.** The canvas lays out parallel branches side-by-side automatically. Once a stage has multiple downstreams (`depends_on` pointing at the same upstream), subsequent branches get fresh columns to the right. The user sees a tree, not a stack.
- **Cumulative agent-driven canvas.** `update_canvas` is the only way the diagram changes — every stage, edge, and position the user sees came from the agent. The system instruction enforces "the canvas is cumulative": every update is a superset of the prior schema. The UI normalizes layout, derives edges from `depends_on`, and renders without trusting the agent's positions.

---

## Tech stack

- **Frontend** — React 19 + TypeScript + Vite + Tailwind, with `@xyflow/react` (React Flow v12) for the canvas. Single-page workspace at `/app`, marketing landing at `/`, public tool reference at `/docs`.
- **Backend** — Node + Express + `ws` WebSocket. One long-lived WS per session; chat traces and canvas updates ride the same channel.
- **Agent** — [**Google Agent Development Kit**](https://adk.dev) (`@google/adk`) orchestrates the agent. `LlmAgent` wraps **Gemini 3 Flash** as the model, with our four custom tools (`update_canvas`, `push_results`, `run_pipeline`, `suggest_next_prompts`) registered as `FunctionTool`s and the MongoDB MCP server connected via `MCPToolset`. ADK runs the tool-call loop, validates arguments, and dispatches; we hook `beforeToolCallback` / `afterToolCallback` to stream the visual trace timeline to the UI.
- **Database access** — `mongodb-mcp-server` spawned as a stdio subprocess. ADK's `MCPToolset` handles tool discovery + schema mapping so Gemini sees the database's allow-listed tools (`aggregate`, `find`, `count`, `collection-schema`, `list-collections`, `list-databases`) without us hand-sanitizing JSON Schema.
- **Hosting** — Cloud Run. See [deployment.md](./deployment.md).

This combination — `@google/adk` (orchestration) + Gemini (model) + MongoDB MCP server (partner integration) — sits squarely inside the Google Cloud Agent Builder ecosystem the Rapid Agent Hackathon asks for.

---

## Three demos

1. **Vector / vibes-based search.** *"Find me movies about lone cowboys, ruthless outlaws, and dusty gunfights."* The agent renders a purple "vector search" node on the canvas, runs `$match + $text` under the hood (this environment doesn't have a query-time embedding service, so we route conceptually-vector queries to Atlas text search).
2. **Join + branching.** *"Find all comments by Ned Stark. Now join the movie details. Now create a branch that filters to movies after 2000. Now create a second branch that groups by genre."* The canvas grows; the second branch lands beside the first instead of replacing it.
3. **BI analytics.** *"Find all movies directed by Christopher Nolan. Group them by year and calculate average IMDB rating + total awards. Sort chronologically and round to one decimal."* Demonstrates nested field paths (`imdb.rating`, `awards.wins`), multi-aggregation `$group`, `$sort`, and `$round`.

Each demo opener is one click away — when the chat panel is empty and you're connected, three suggested-prompt chips fill the composer with the demo's first message so judges can replay them end-to-end without typing.

---

## Quickstart (local dev)

```bash
# Prereqs: Node 20+, a Gemini API key from aistudio.google.com, and
# EITHER an Atlas free M0 cluster with sample_mflix loaded OR Docker
# (see "Local MongoDB" below for the recommended dev path).

git clone https://github.com/TLiu2014/gemini-nosql-data-wrangler.git
cd gemini-nosql-data-wrangler
cp .env.example .env
# Edit .env: GEMINI_API_KEY=… and MONGODB_URI=… (Atlas or localhost)

npm install
npm run dev
```

This boots the UI on `http://localhost:5173` (auto-opens `/app`) and the WebSocket server on `:8080`. The first WebSocket connect spawns the MongoDB MCP server (~3–5s cold start; subsequent sessions are near-instant).

### Local MongoDB (recommended for development)

Atlas free-tier M0 adds 200ms–2s of round-trip per query — over a 4-step demo, the wait adds up. For a near-instant local dev loop, run MongoDB in Docker with the same `sample_mflix` dataset Atlas's "Load Sample Data" provides:

```bash
docker-compose up -d                  # mongodb on :27017, sample_mflix auto-loaded
docker-compose logs mongo-init -f     # ~30s on first run; idempotent thereafter
```

Then set `MONGODB_URI=mongodb://localhost:27017/` in `.env`. The UI's Settings → MongoDB Atlas Connection String still overrides this per-session, so you can A/B against Atlas without restarting the server.

Full walkthrough (including index verification, port-conflict troubleshooting, and the `$vectorSearch` caveat): **[LOCAL_DEV.md](./LOCAL_DEV.md)**.

For Cloud Run deployment, see **[deployment.md](./deployment.md)**. For an in-app reference of the agent's tool surface (custom tools + MCP tools + WebSocket events with example calls), open **`/docs`** in the running app.

---

## Features worth highlighting

- **Agent-suggested follow-ups** *(on by default; toggle in Settings → Chat Panel).* At the end of every turn the agent calls a `suggest_next_prompts` tool with 2–3 short, grounded follow-up suggestions tailored to the current canvas state (e.g., "Group by year", "Add lookup", "Sort descending"). The UI renders them as chips below the last agent message; clicking a chip fills the composer with the full prompt so the user can edit before sending. Hardcoded demo openers still appear on the very first empty state. Turning the feature off drops the tool declaration *and* the system-instruction nudge from the chat session, so the agent never tries to call it — saves one tool call + ~500 ms per turn.
- **Per-stage result preview.** Every node on the canvas gets its own tab in the Results panel. Source tab shows the raw collection top-20; intermediate stages show after-$match / after-$group previews; final stage shows the full result. All from one `$facet` aggregation.
- **Share a canvas via URL.** The pipeline schema is encoded into the URL fragment (`#…`) on every change. Copy the URL, send it to a teammate, and they see the same canvas state — no backend storage, no accounts.
- **Export as MQL.** A toolbar button on the canvas downloads the current pipeline as a standalone `db.collection.aggregate([…])` script you can paste into mongosh.
- **Aligned key order across rows.** MongoDB documents preserve BSON insertion order, so the same fields can appear in different orders. The results panel sorts keys alphabetically by default; toggle to "Original order" to see raw BSON.
- **Stage-aware busy indicator.** While the agent is mid-turn, the chat panel shows what it's doing right now ("Calling aggregate · step 2 · 612ms") instead of a generic spinner.
- **Voice mode** *(off by default).* Always-on mic with VAD-based utterance segmentation, browser-side STT for transcripts, optional Gemini Live API transcription. Built but not the primary input — text-first is more reliable for live demos.

---

## Project layout

```
.
├── server/                  # Node + Express + WebSocket
│   └── src/
│       ├── agent/           # ReAct loop, custom tools, system instruction
│       ├── mcp/             # MongoDB MCP client + response sanitization
│       └── websocket/       # Per-session WS handlers
├── ui/                      # React + Vite SPA
│   └── src/
│       ├── components/      # Canvas, chat, results panel, voice chrome
│       ├── pages/           # Landing page + main workspace
│       └── samples/         # Pre-built demo pipelines
├── dev-log.md               # Deprecated attempts and the reasons behind them
├── deployment.md            # Cloud Run + Atlas + Secret Manager guide
└── .env.example
```

---

## License

See [LICENSE](./LICENSE).
