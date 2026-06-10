# AtlasOrbit
### AI Agent for Visual NoSQL Pipelines, Powered by Gemini & MongoDB

Welcome to **AtlasOrbit** (repo: `gemini-nosql-data-wrangler`) — a visual NoSQL
agent that turns text requests into MongoDB aggregation pipelines and
runs them on a live canvas, stage by stage, with results filling in as each step
lands.

Submitted to the **Google Cloud Rapid Agent Hackathon**. Powered by
**Gemini 3 Flash** + the **Google Agent Development Kit** + the **MongoDB MCP
server**.

**Live app:** <!-- TODO: paste Cloud Run URL --> `https://…run.app`
&nbsp;&nbsp;&nbsp;*(this URL is the landing page at `/`; from there, click **Launch app** to open the workspace at `/app`)*

**Demo video (< 3 min):** <!-- TODO: paste YouTube/Vimeo link --> `https://…`

Two supporting pages beyond the workspace:
- **`/`** — landing page (pitch, "Built with" tech-stack overview, screenshots, **Launch app** button)
- **`/docs`** — public tool reference (every tool the agent can call, with example invocations)

---

## Try it

1. Open the **Live app** link above → click **Launch app** → **Connect** in
   the header.
2. Pick any of the three demo chips on the empty chat to replay a full
   pipeline end-to-end without typing. What each one does is described in
   [Three demos](#three-demos).

### Bring your own keys (optional)

The hosted instance is preconfigured, but you can override either credential
per-session in **Settings** (gear icon, top-right).

- **Gemini API key.** The hosted app ships with a shared key. It can hit
  free-tier rate limits during busy moments — if you see a quota error,
  paste your own [AI Studio key](https://aistudio.google.com/apikey) in
  Settings and the app will use it for the rest of the session (sessionStorage
  only; nothing is persisted to a server).
- **MongoDB connection string.** The hosted backend connects to a read-only
  [`sample_mflix`](https://www.mongodb.com/docs/atlas/sample-data/sample-mflix/)
  cluster — MongoDB's official sample dataset and the corpus required by the
  hackathon's MongoDB partner track. You don't need to provide anything to
  use the app. To run against your own cluster instead, paste a connection
  string in Settings; the MongoDB MCP server still spawns with `--readOnly`
  so it can't mutate your data.

> **Why isn't the hosted connection string published?** It's injected from
> Google Secret Manager at runtime. Publishing a live URI in a public repo
> would expose reusable credentials outside the app's read-only guard —
> not safe even for sample data. To run end-to-end with your own data, see
> [local-dev.md](./local-dev.md) or [deployment.md](./deployment.md).

---

## Setup & run (local)

```bash
# Prereqs: Node 20+ and a Gemini API key (https://aistudio.google.com/apikey).
# For data, use EITHER an Atlas free M0 cluster with sample_mflix loaded,
# OR local MongoDB in Docker (recommended — see local-dev.md).

git clone https://github.com/TLiu2014/gemini-nosql-data-wrangler.git
cd gemini-nosql-data-wrangler
cp .env.example .env
# Edit .env: GEMINI_API_KEY=…  and  MONGODB_URI=…  (Atlas or localhost)
# Both are OPTIONAL here, you can also add them in the app's Settings (BYOK).

npm install
npm run dev
```

This boots the UI on `http://localhost:5173` (auto-opens `/app`) and the
WebSocket server on `:8080`. The first WebSocket connect spawns the MongoDB MCP
server (~3–5 s cold start; subsequent sessions are near-instant).

**Recommended local data path — MongoDB in Docker** (single-digit-ms queries,
no Atlas round-trip):

```bash
docker-compose up -d                  # mongodb on :27017, sample_mflix auto-loaded
docker-compose logs mongo-init -f     # ~30s on first run; idempotent thereafter
```

Then set `MONGODB_URI=mongodb://localhost:27017/` in `.env`. Full walkthrough
(index verification, troubleshooting, the `$vectorSearch` caveat):
**[local-dev.md](./local-dev.md)**.

**To host it yourself on Google Cloud Run:** **[deployment.md](./deployment.md)**.

---

## How it works

Type a question in plain English ("find me movies about lone cowboys", "group
his films by year and show me average IMDB rating") and watch the agent reason
out loud, design the pipeline on a live canvas, and run it against MongoDB —
stage by stage, with results filling in as each step lands.

Under the hood it combines three pieces:

- **Gemini** — **Gemini 3 Flash** is the model.
- **Google Agent Development Kit** ([`@google/adk`](https://adk.dev)) — runs the
  agent's **ReAct loop** (reason → act → observe) and tool dispatch.
- **MongoDB MCP server** — the database integration, connected via ADK's
  `MCPToolset`.

The same architecture is documented end-to-end on the app's **`/docs`** page
(agent + every tool with example calls) and the home page (`/`).

![placeholder for demo gif](docs/demo-placeholder.png)

---

## Tech stack

- **Frontend** — React 19 + TypeScript + Vite + Tailwind, with `@xyflow/react`
  (React Flow v12) for the canvas. SPA workspace at `/app`, landing page at `/`,
  public tool reference at `/docs`.
- **Backend** — Node + Express + `ws` WebSocket. One long-lived WS per session;
  chat traces and canvas updates ride the same channel.
- **Agent** — ADK's `LlmAgent` wraps **Gemini 3 Flash** and runs the ReAct
  tool-call loop. Four custom tools (`update_canvas`, `push_results`,
  `run_pipeline`, `suggest_next_prompts`) are registered as `FunctionTool`s; the
  MongoDB MCP server is connected via `MCPToolset`. `beforeToolCallback` /
  `afterToolCallback` stream the visual trace timeline to the UI.
- **Database access** — `mongodb-mcp-server` spawned as a stdio subprocess in
  `--readOnly` mode. The agent's allow-list is narrow (grounding tools like
  `collection-schema`, `list-collections`, `list-databases`); all pipeline
  execution goes through the custom `run_pipeline` tool. See
  [deployment.md → Appendix A](./deployment.md#appendix-a--how-the-backend-talks-to-mongodb).
- **Hosting** — Cloud Run, single image. See [deployment.md](./deployment.md).

---

## Design choices worth a closer look

- **`run_pipeline` server tool with `$facet` previews.** The agent emits one
  aggregation pipeline; the server wraps it in `$facet` so every canvas stage
  gets its own preview row in a single round-trip. The underlying pipeline still
  sees the full collection — only the per-stage UI display is limited.
- **Branching-aware DAG layout.** The canvas lays out parallel branches
  side-by-side automatically: once a stage has multiple downstreams, subsequent
  branches get fresh columns. The user sees a tree, not a stack.
- **Cumulative agent-driven canvas.** `update_canvas` is the only way the
  diagram changes — every update is a superset of the prior schema. The UI
  normalizes layout and derives edges from `depends_on` without trusting the
  agent's positions.

---

## Three demos

1. **Vector / vibes-based search.** *"Find me movies about lone cowboys,
   ruthless outlaws, and dusty gunfights."* A purple "vector search" node
   appears; under the hood it runs `$match + $text` (no request-time embedding
   service here, so conceptually-vector queries route to text search).
2. **Join + branching.** *"Find all comments by Ned Stark. Join the movie
   details. Branch one filter to movies after 2000, another grouping by genre."*
   The canvas grows; the second branch lands beside the first.
3. **BI analytics.** *"Movies directed by Christopher Nolan, grouped by year
   with average IMDB rating + total awards, sorted chronologically, rounded."*
   Nested field paths (`imdb.rating`, `awards.wins`), multi-aggregation
   `$group`, `$sort`, `$round`.

---

## Features worth highlighting

- **Agent-suggested follow-ups** *(on by default)* — at the end of each turn the
  agent proposes 2–3 grounded follow-up chips tailored to the canvas state.
- **Per-stage result preview** — every node gets its own Results tab, all from
  one `$facet` aggregation.
- **Share a canvas via URL** — the pipeline schema is encoded in the URL
  fragment; copy-paste to share state, no backend storage.
- **Export as MQL** — download the current pipeline as a standalone
  `db.collection.aggregate([…])` script.
- **Stage-aware busy indicator** — the chat panel shows the live action
  ("Calling aggregate · step 2 · 612 ms") instead of a generic spinner.
- **Voice mode** *(off by default)* — always-on mic with VAD segmentation;
  built but text-first is the primary input.

---

## Project layout

```
.
├── server/                  # Node + Express + WebSocket
│   └── src/
│       ├── agent/           # ReAct loop (ADK), custom tools, system instruction
│       ├── mcp/             # MongoDB MCP client + response sanitization
│       └── websocket/       # Per-session WS handlers
├── ui/                      # React + Vite SPA
│   └── src/
│       ├── components/      # Canvas, chat, results panel, voice chrome
│       ├── pages/           # Landing page + main workspace + /docs
│       └── samples/         # Pre-built demo pipelines
├── Dockerfile               # Single-image build for Cloud Run
├── docker-compose.yml       # Local MongoDB + sample_mflix loader
├── README.md                # ← you are here
├── deployment.md            # Cloud Run + Atlas + Secret Manager guide
├── local-dev.md             # Local MongoDB setup
└── dev-log.md               # Deprecated attempts and the reasons behind them
```

---

## Submission facts

- **Project:** AtlasOrbit (repo `gemini-nosql-data-wrangler`).
- **Partner track:** MongoDB — the MongoDB MCP server is the database integration.
- **Model & orchestration:** Google **Gemini 3 Flash** via the **Google Agent
  Development Kit** (`@google/adk`).
- **Sample data:** MongoDB's official
  [`sample_mflix`](https://www.mongodb.com/docs/atlas/sample-data/sample-mflix/).
- **Hosted URL:** see **Live app** at the top of this file.
- **Demo video (< 3 min):** see **Demo video** at the top of this file.
- **License:** MIT — open source (see below).

---

## License

This project is open source under the **MIT License**. See [LICENSE](./LICENSE).
