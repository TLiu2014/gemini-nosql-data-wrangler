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

- **Frontend** — React 19 + TypeScript + Vite + Tailwind, with `@xyflow/react` (React Flow v12) for the canvas. Single-page workspace at `/app`, marketing landing at `/`.
- **Backend** — Node + Express + `ws` WebSocket. One long-lived WS per session; the chat panel and canvas updates ride the same channel.
- **Agent** — Gemini 3 Flash via `@google/genai`'s `chats.create` + `sendMessage` for an explicit ReAct loop. Custom tools (`update_canvas`, `push_results`, `run_pipeline`) drive the UI; standard MCP tools (`aggregate`, `find`, `collection-schema`) drive the database.
- **Database access** — `mongodb-mcp-server` spawned as a stdio subprocess on each session. Tool declarations are auto-discovered + sanitized for Gemini's function-declaration schema.

---

## Three demos

1. **Vector / vibes-based search.** *"Find me movies about lone cowboys, ruthless outlaws, and dusty gunfights."* The agent renders a purple "vector search" node on the canvas, runs `$match + $text` under the hood (this environment doesn't have a query-time embedding service, so we route conceptually-vector queries to Atlas text search).
2. **Join + branching.** *"Find all comments by Ned Stark. Now join the movie details. Now create a branch that filters to movies after 2000. Now create a second branch that groups by genre."* The canvas grows; the second branch lands beside the first instead of replacing it.
3. **BI analytics.** *"Find all movies directed by Christopher Nolan. Group them by year and calculate average IMDB rating + total awards. Sort chronologically and round to one decimal."* Demonstrates nested field paths (`imdb.rating`, `awards.wins`), multi-aggregation `$group`, `$sort`, and `$round`.

Each demo opener is one click away — when the chat panel is empty and you're connected, three suggested-prompt chips fill the composer with the demo's first message so judges can replay them end-to-end without typing.

---

## Quickstart (local dev)

```bash
# Prereqs: Node 20+, an Atlas free M0 cluster with sample_mflix loaded,
# and a Gemini API key from aistudio.google.com.

git clone https://github.com/TLiu2014/gemini-nosql-data-wrangler.git
cd gemini-nosql-data-wrangler
cp .env.example .env
# Edit .env: MONGODB_URI=mongodb+srv://… and GEMINI_API_KEY=…

npm install
npm run dev
```

This boots the UI on `http://localhost:5173` (auto-opens `/app`) and the WebSocket server on `:8080`. The first WebSocket connect spawns the MongoDB MCP server (~3–5s cold start; subsequent sessions are near-instant).

For Cloud Run deployment, see **[deployment.md](./deployment.md)**.

---

## Features worth highlighting

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
