# Deployment Guide — Hosting on Google Cloud Run

A developer guide to self-hosting **AtlasOrbit** on Google
Cloud. The whole app — UI, `/health`, and the WebSocket — ships as a single
container served from one origin, so a deploy is one image + one Cloud Run
service.

> Just want to try the app? You don't need any of this — open the hosted URL
> in the [README](./README.md) and click **Connect**. This document is for
> developers who want to host their own instance.

The three pieces of infrastructure:

1. **MongoDB Atlas** (M0 free cluster, loaded with `sample_mflix`) — or any
   MongoDB the container can reach.
2. **Google Cloud Secret Manager** (holds `MONGODB_URI` and `GEMINI_API_KEY`)
   — *optional*; see [§2](#2-google-cloud-secret-manager-optional).
3. **Google Cloud Run** (one service — serves the UI, the `/health` endpoint,
   and the WebSocket from the same origin).

---

## TL;DR

Shortest path from `main` to a live URL:

1. Atlas M0 + `sample_mflix` ([§1](#1-mongodb-atlas--free-m0-cluster-with-sample_mflix)) — ~10 min.
2. (Optional) two Secret Manager secrets ([§2](#2-google-cloud-secret-manager-optional)) — `MONGODB_URI`, `GEMINI_API_KEY` — ~2 min.
3. Build + deploy ([§3](#3-google-cloud-run--single-service-for-ui--api--websocket)) — ~5 min:
   ```bash
   gcloud builds submit . --tag "$IMAGE" && gcloud run deploy …
   ```
4. Verify with the three demos in [§5](#5-verify-the-deployment).

Total fresh setup ≈ 20 minutes. Re-deploys after a code change are a single
`gcloud builds submit . && gcloud run deploy …`.

> Hosting for local development instead of Cloud Run? See
> **[local-dev.md](./local-dev.md)** for the Docker-based local MongoDB setup.

---

## 1. MongoDB Atlas — Free M0 Cluster with `sample_mflix`

### 1.1 Create the cluster
1. Sign in at <https://cloud.mongodb.com> and create a new Project, e.g. `gemini-wrangler`.
2. Click **Build a Database** → choose **M0 (Free)**.
3. Pick a cloud provider/region (a GCP region matching your Cloud Run region is ideal — e.g. `us-central1`).
4. Name the cluster (e.g. `wrangler-cluster`) and click **Create Deployment**.

### 1.2 Configure access
1. Under **Database Access**, create a database user with a strong password.
   Give it the **least privilege** you can:
   - For a read-only demo cluster, the built-in role **Read-only to any database**
     (or scoped to `sample_mflix`) is enough — the app spawns the MongoDB MCP
     server with `--readOnly`, so it never needs write access.
   - **Read and write to any database** also works if you intend to mutate data.
   Note the username and password.
2. Under **Network Access**, add an IP allow-list entry:
   - For local development: add your current IP.
   - For Cloud Run: add `0.0.0.0/0` (or, preferred, configure VPC peering / PrivateLink).

### 1.3 Load the `sample_mflix` dataset
1. In the Atlas UI, click the **`…`** menu on your cluster → **Load Sample Dataset**.
2. Confirm. Loading takes 5–10 minutes; you should see eight `sample_*` databases when it finishes.
3. Verify that `sample_mflix.embedded_movies` exists. This collection contains
   movies from the `Western`, `Action`, and `Fantasy` genres only (it's a
   subset of `sample_mflix.movies`). Each document carries a `plot_embedding`
   field — a pre-computed 1536-dim vector that ships with the sample dataset
   — useful only if you wire in a compatible embedding service at request
   time (see [§1.4](#14-optional-atlas-vector-search-index) below).

   Heads up for the agent: vibes-based queries will only ever return Western /
   Action / Fantasy results. The system instruction mentions this so the
   agent doesn't promise, say, a romcom search against this collection.

   For the canonical schema, see MongoDB's
   [official `sample_mflix` docs](https://www.mongodb.com/docs/atlas/sample-data/sample-mflix/).

### 1.4 (Optional) Atlas Vector Search index
This deployment does **not** require an Atlas Vector Search index. The system
instruction routes conceptual / "vibes-based" queries to `$match` with the
`$text` operator on `sample_mflix.movies` (which already has a text index on
`cast`, `fullplot`, `genres`, `title`). The visual `MQL_VECTOR_SEARCH` node
on the canvas is a UI choice — the execution underneath is text search.

Why not real `$vectorSearch`? The pre-loaded `plot_embedding` field on
`embedded_movies` is a 1536-dim vector produced by a third-party embedding
service. To query against it, the client would need to generate vectors
from the same model at request time. Gemini's text-embedding models
produce different dimensions and live in a different vector space, so
they aren't a drop-in substitute. See `dev-log.md` for the longer story.

If you do want to extend the project to call live `$vectorSearch`, create
an index in Atlas (`sample_mflix.embedded_movies` → Search Indexes → Atlas
Vector Search → JSON editor), name it `plot_vector_index`, and use
`numDimensions: 1536, similarity: "cosine", path: "plot_embedding"`. Then
add a server-side `embed_text` tool that calls a compatible embedding
service and update the system instruction to route vibes queries to
`$vectorSearch` with the returned vector.

### 1.5 Grab the connection string
1. Atlas → **Database** → **Connect** → **Drivers** → copy the URI.
2. Replace `<username>` / `<password>` placeholders. Final shape:
   ```
   mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
   ```
3. Save it — you'll store it in Secret Manager ([§2](#2-google-cloud-secret-manager-optional)),
   or skip secrets entirely and let users bring their own ([§2](#2-google-cloud-secret-manager-optional)).

---

## 2. Google Cloud Secret Manager (optional)

**Are server-side secrets required? No.** The app is "bring your own keys"
(BYOK): users can paste a **MongoDB connection string** and **Gemini API key**
into the in-app **Settings** menu, and those are sent per-session over the
WebSocket. So you have two hosting styles:

- **BYOK-only** — deploy with *no* secrets. Every user must open Settings and
  supply both values themselves. Simplest to host; nothing sensitive lives in
  your project. Skip to [§3](#3-google-cloud-run--single-service-for-ui--api--websocket).
- **Server-provisioned (recommended for a shareable demo)** — store
  `MONGODB_URI` and/or `GEMINI_API_KEY` as secrets so users can just click
  **Connect** without configuring anything. A value pasted in the UI always
  overrides the server's for that session.

Resolution order (highest priority first): **UI setting → server env
(`.env` / Secret Manager) → unset** (the component reports "not configured").
Same precedence applies whether the env value comes from a secret on Cloud Run
or a `.env` file in local dev — so configuring `.env` / secrets is *optional*
in both environments. See [local-dev.md](./local-dev.md#connection-string-precedence-important).

Secrets are pulled into Cloud Run at runtime; nothing is baked into the image.

### 2.1 One-time setup
```bash
# Replace with your actual project ID.
export PROJECT_ID="your-gcp-project"
gcloud config set project "$PROJECT_ID"

# Enable required APIs.
gcloud services enable \
  secretmanager.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com
```

### 2.2 Create the secrets (skip for BYOK-only hosting)
Only create the secrets you actually want to provision server-side. You can
create one and not the other (e.g. provide the Mongo URI but require users to
bring their own Gemini key), or skip both for pure BYOK.

```bash
# MongoDB connection string from §1.5
printf "mongodb+srv://...." | gcloud secrets create MONGODB_URI --data-file=-

# Gemini API key from https://aistudio.google.com/apikey
printf "AIza...." | gcloud secrets create GEMINI_API_KEY --data-file=-
```

### 2.3 Grant the Cloud Run service account access
```bash
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for SECRET in MONGODB_URI GEMINI_API_KEY; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor"
done
```

> **Production tip:** create a dedicated service account instead of using the
> default Compute Engine SA, then attach it to the Cloud Run service via
> `--service-account`.

---

## 3. Google Cloud Run — single service for UI + API + WebSocket

The repo's root `Dockerfile` builds a single image that:
- bundles the Vite-built UI into `/app/public`,
- runs the Node backend on `$PORT`,
- serves the UI from `/`, the health endpoint at `/health`, the WebSocket at
  `/ws`, and falls back to `index.html` for SPA routes (`/app`, `/docs`).

Because everything lives on one origin, the UI's hardcoded
`wss://${window.location.host}/ws` Just Works — no env var, no CORS,
no Vercel rewrites.

### 3.1 Build the container

You need a container image in Artifact Registry. Two ways to produce it —
**Option A** is the default (no local Docker required).

```bash
export REGION="us-central1"
export REPO="wrangler"
export IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/app:latest"

# One-time: create the Artifact Registry repo.
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker \
  --location="$REGION"
```

**Option A — Cloud Build (no local Docker).** Cloud Build reads the root
`Dockerfile` and the whole repo context (it needs both `ui/` and `server/`):

```bash
gcloud builds submit . --tag "$IMAGE"
```

First build is ~3–5 min (npm install + Vite + tsc). Subsequent builds reuse
Cloud Build's layer cache and finish in ~1–2 min.

**Option B — build locally with Docker, then push.** Useful if you want to
test the image locally first or you're iterating offline:

```bash
# Authenticate the local Docker CLI against Artifact Registry (one-time).
gcloud auth configure-docker "${REGION}-docker.pkg.dev"

# Build from the repo root (the Dockerfile expects ui/ and server/ in context).
# --platform is important on Apple Silicon: Cloud Run runs linux/amd64.
docker build --platform linux/amd64 -t "$IMAGE" .

# (Optional) smoke-test locally before pushing. The app needs the two env
# vars at runtime; pass them inline or via --env-file .env.
docker run --rm -p 8080:8080 \
  -e MONGODB_URI="mongodb+srv://…" \
  -e GEMINI_API_KEY="AIza…" \
  "$IMAGE"
# → open http://localhost:8080/app

# Push to Artifact Registry.
docker push "$IMAGE"
```

### 3.2 Deploy

```bash
gcloud run deploy wrangler \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --timeout 3600 \
  --cpu 1 --memory 1Gi \
  --min-instances 1 --max-instances 4 \
  --concurrency 80 \
  --set-secrets "MONGODB_URI=MONGODB_URI:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest"
```

Drop the `--set-secrets` flag entirely for BYOK-only hosting (users supply
keys in Settings). To provision just one value, pass only that secret.

Notes:
- **WebSockets** are supported out of the box on HTTPS endpoints; no flag
  required. `--timeout 3600` raises the per-connection max duration to one
  hour (Cloud Run's ceiling) so a slow session doesn't get cut off mid-turn.
- **Port**: Cloud Run injects `PORT=8080`; the server already binds to
  `process.env.PORT`.
- **Min instances**: set to `1` for any live-demo window so the first
  visitor doesn't hit a 3–5 s cold start on Connect. Drop back to `0` to stay
  free-tier when idle.
- **Concurrency**: 80 is fine for the UI + REST traffic; each open
  WebSocket counts as one concurrent request, so with `--max-instances 4`
  and `--concurrency 80` the service can hold ~320 simultaneous sessions
  before queueing.
- **Why not `--min-instances 0`?** Cold start is Cloud Run boot
  (~1–2 s) + Node startup (~1 s) + the MongoDB MCP probe with an 8 s
  timeout (`mongoClient.ts` `probe()`). A user clicking Connect on a
  cold instance can wait 8–10 s before the Atlas pill turns green and
  may think the app is broken.

After deploy, gcloud prints a single service URL — that's the one you share.
Example: `https://wrangler-xxxxxxxx-uc.a.run.app`.

---

## 4. (Optional) Custom domain

Cloud Run-issued URLs (`*.run.app`) work fine. For a shorter / branded URL:

```bash
gcloud run domain-mappings create \
  --service wrangler \
  --domain wrangler.example.com \
  --region "$REGION"
```

Follow the printed DNS instructions. Cloud Run issues a managed certificate
automatically; expect ~15 min before the cert is live.

If you prefer to keep the UI on a CDN host (Vercel, Netlify, GCS+Cloud CDN)
and only the API on Cloud Run, you need either a same-host proxy for `/ws`
and `/health` or the UI code needs to be extended to read a runtime
WebSocket URL from `import.meta.env`. The repo doesn't ship either —
single-Cloud-Run is the recommended deploy.

---

## 5. Verify the deployment

Run the three demos the app advertises in the empty-state chip strip — the
same scripts a first-time visitor would follow.

1. Open the service URL → click **Launch app**. On `/app`, click **Connect**
   in the header. The Atlas and Gemini pills both turn green within ~3 s.
   (BYOK-only hosting: open **Settings** first and paste your keys.)
2. **Demo 1 · Vibes search** (chip on the empty chat). Three turns:
   - "Find me movies about lone cowboys, ruthless outlaws, and dusty
     gunfights from the embedded_movies collection" — a purple
     `MQL_VECTOR_SEARCH` node + a `Source` node appear; the Source tab
     populates with movies and the `$vector` tab with 5–20 matches.
   - "Filter to movies after the year 2000." — a `$match` node is appended
     and its tab populates.
   - "Clean the result to only show the title, the year, the genres, and the
     plot." — `$project` node appended; result table now shows only those 4
     columns.
3. **Demo 2 · Join + branch**. Four turns ending in two parallel branches off
   the `$lookup` (one filtering to recent movies, one grouping by genre).
4. **Demo 3 · BI analytics**. Three turns culminating in a sorted/rounded
   per-year aggregate of Nolan films.

Each turn should resolve in ≤2 tool calls (`update_canvas` + `run_pipeline`),
plus an optional `suggest_next_prompts` when that setting is on. If you see
the agent firing `run_pipeline` more than once per turn, or the result tabs
show "0 documents" for stages you know have data, read the Cloud Run log and
check the `[agent] (internal) → aggregate` lines — those are the underlying
MongoDB calls.

```bash
gcloud run services logs read wrangler --region "$REGION" --limit 200
```

---

## 6. Pre-flight checklist

Before you share the URL, walk this list once:

- [ ] `/health` returns `{"status":"ok", …}`. If you provisioned secrets it
      also shows `"geminiKeyConfigured":true,"mongoUriConfigured":true` —
      confirms both are mounted. (Both `false` is expected for BYOK-only.)
- [ ] Connect on the workspace: both Atlas and Gemini pills green within 5 s.
- [ ] All three demos in [§5](#5-verify-the-deployment) complete end-to-end
      (per-stage tabs populated, final agent reply ≤1 sentence).
- [ ] Cloud Run service is **public** (`--allow-unauthenticated`) so visitors
      don't need IAM access.
- [ ] Cloud Run `--min-instances` ≥ 1 for the live window. Cold-start adds
      ~3–5 s for the first WS handshake plus ~3–8 s for the MongoDB MCP probe.
- [ ] Cloud Run `--max-instances` ≥ 4 to absorb concurrent sessions. Each
      WebSocket holds one instance for the session's duration.
- [ ] Atlas Network Access allow-list includes `0.0.0.0/0` (Cloud Run uses
      ephemeral IPs), or a VPC connector is attached if you use PrivateLink.
- [ ] Browser console clean — no 404 / mixed-content errors. The UI calls
      `/health` and opens `wss://<service-host>/ws`; if either is on a
      different origin you need CORS or a proxy in front.

---

## Appendix A — How the backend talks to MongoDB

The backend does **not** import a MongoDB driver directly. It uses the official
MongoDB MCP server (`mongodb-mcp-server`) as a subprocess and speaks to it over
stdio using `@modelcontextprotocol/sdk`. The root `Dockerfile` pre-installs
`mongodb-mcp-server` globally so the first `npx` invocation doesn't pay a
download cost on cold start. The backend launches the MCP server as:

```
npx -y mongodb-mcp-server@latest --readOnly
```

…with `MDB_MCP_CONNECTION_STRING=<your Atlas URI>` in the spawned env. We pass
`--readOnly` so the demo can't accidentally mutate the cluster.

The MCP server publishes ~16 tools. The agent's allow-list (see
`MCP_TOOLS_ALLOWLIST` in `server/src/agent/agentLoop.ts`) is intentionally
narrow:

- `list-databases`, `list-collections`, `collection-schema` — **grounding
  only**. The system instruction tells the agent NOT to call these for the
  known `sample_mflix` demo.

Notably absent: `aggregate`, `find`, `count`. The agent's only path to
executing a pipeline is the custom `run_pipeline` tool (defined in
`server/src/agent/customTools.ts`), which wraps the underlying `aggregate`
in `$facet` and fans out per-stage `push_results` events to populate every
results tab in one round-trip. Exposing `aggregate` directly let the model
skip the result-dispatch machinery and every tab ended up blank — see the
note above the allow-list in `agentLoop.ts`.

The legacy `MongoMcpClient` (used inside `run_pipeline`'s server-side
`$facet`, and by the Mflix-collections refresh) still has access to the
full tool surface — the restriction is only on what Gemini sees.

For the upstream MCP tool reference, see
<https://www.mongodb.com/docs/mcp-server/tools/>.

## Appendix B — Container build details

The root `Dockerfile` is a 3-stage build (see the file for the annotated
version):

1. **`ui-builder`** — `npm ci` + `npm run build --workspace ui` → Vite output
   in `/app/ui/dist`. Anything under `ui/public/` (e.g. `screenshots/`) is
   copied into the build verbatim and ends up served at the site root.
2. **`server-builder`** — `npm ci` + `npm run build --workspace server` →
   compiled JS in `/app/server/dist`.
3. **`runtime`** — `node:22-slim`, production deps only, the global
   `mongodb-mcp-server`, plus the two build outputs. The UI lands in
   `/app/public`; `CMD ["node", "server/dist/index.js"]`. Runs as the
   non-root `node` user and exposes `8080`.

There's nothing Cloud Run-specific in the image — it runs anywhere that can
run a container and set `PORT`, `MONGODB_URI`, and `GEMINI_API_KEY`.
