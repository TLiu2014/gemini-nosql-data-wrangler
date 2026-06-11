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

Prerequisites for everything below — required whether or not you use Secret
Manager. Skip ahead if you've already done a GCP deploy from this machine.

**1. Create (or pick) a Google Cloud project with billing enabled.**
Cloud Run and Cloud Build need a billing account attached even though the
free tier covers this app's footprint. Create a project at
<https://console.cloud.google.com/projectcreate>, then enable billing on it
from the project's *Billing* page. Note the project **ID** (not the
display name — they can differ).

**2. Install the `gcloud` CLI.** Pick your OS from the
[official install guide](https://cloud.google.com/sdk/docs/install):

```bash
# macOS — Homebrew (one-liner). Adds gcloud, gsutil, bq.
brew install --cask google-cloud-sdk

# Or any platform — interactive installer:
curl https://sdk.cloud.google.com | bash && exec -l $SHELL

# Verify.
gcloud --version
```

Linux package-manager installs and the Windows MSI live at the same link
above.

**3. Authenticate and select the project.**

```bash
# Replace with the project ID from step 1.
export PROJECT_ID="your-gcp-project"

gcloud auth login                          # opens a browser for OAuth
gcloud config set project "$PROJECT_ID"

# Sanity check — both lines should match your account + project.
gcloud config list
```

If you're behind a corporate proxy (e.g. Zscaler) that blocks the browser
flow, fall back to `gcloud auth login --no-launch-browser` and paste the
verification code manually.

> **Already use gcloud with a corporate account?** `gcloud auth login`
> writes credentials to `~/.config/gcloud/`, which would overwrite your
> work setup. Keep them isolated by pointing this project's gcloud at a
> separate config directory and auto-switching with
> [direnv](https://direnv.net/):
>
> ```bash
> # One-time bootstrap of a personal config dir (outside the repo).
> mkdir -p ~/.config/gcloud-personal
> CLOUDSDK_CONFIG=~/.config/gcloud-personal gcloud auth login
> CLOUDSDK_CONFIG=~/.config/gcloud-personal gcloud config set project "$PROJECT_ID"
>
> # One-time direnv setup (Mac).
> brew install direnv
> echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc && source ~/.zshrc
>
> # Inside the repo, declare the per-directory env override.
> echo 'export CLOUDSDK_CONFIG="$HOME/.config/gcloud-personal"' > .envrc
> echo '.envrc' >> .gitignore
> direnv allow .
> ```
>
> Now `cd`ing into the repo flips gcloud to the personal config (you'll
> see `direnv: loading … .envrc` in the prompt); `cd` out flips it
> back to your corporate setup. `gcloud config list` confirms which
> profile is active.
>
> Heads-up: `gcloud config set project` only updates your local config;
> it does **not** verify the project exists on GCP. If you typo the ID
> or paste with macOS smart-quotes (curly `"…"` instead of ASCII `"…"`),
> later API calls fail with `Project … not found or permission denied`.
> Use `gcloud projects list` to see what your account can actually see,
> and type project IDs directly in the terminal rather than pasting from
> Notes/iMessage.

**4. Enable the APIs this deploy uses.**

```bash
gcloud services enable \
  secretmanager.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com
```

First-time enablement takes ~30 s per API. (If you're going pure BYOK and
skipping §2.2/§2.3, you can drop `secretmanager.googleapis.com` from this
list — the other three are required for §3.)

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
export REPO="atlasorbit"
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
gcloud run deploy atlasorbit \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --timeout 3600 \
  --cpu 1 --memory 1Gi --cpu-boost \
  --min-instances 0 --max-instances 4 \
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
- **`--cpu-boost`**: gives the cold-starting container extra CPU during
  boot. Free on request-billed deploys. Roughly halves cold-start time
  (~4-5 s instead of ~8-10 s), which is what makes `--min-instances 0`
  acceptable as a default — see the cost table in
  [Appendix C](#appendix-c--free-tier--expected-costs).
- **Min instances**: `0` keeps you on the free tier; the first visitor
  every ~15 min of idle pays ~4-5 s of cold start (boot + MCP probe).
  Bump to `1` for a high-stakes demo window using the no-rebuild path
  in [§7](#7-operations--post-deploy-tasks) — it's the one flag that
  takes you out of free tier (~$1.50-2/day at always-allocated CPU).
- **Concurrency**: 80 is fine for the UI + REST traffic; each open
  WebSocket counts as one concurrent request, so with `--max-instances 4`
  and `--concurrency 80` the service can hold ~320 simultaneous sessions
  before queueing.

After deploy, gcloud prints a single service URL — that's the one you share.
Example: `https://atlasorbit-1013253724354.us-central1.run.app` (the form is
`https://<service-name>-<project-number>.<region>.run.app`).

---

## 4. (Optional) Custom domain

Cloud Run-issued URLs (`*.run.app`) work fine. For a shorter / branded URL:

```bash
gcloud run domain-mappings create \
  --service atlasorbit \
  --domain atlasorbit.example.com \
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
gcloud run services logs read atlasorbit --region "$REGION" --limit 200
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

## 7. Operations — post-deploy tasks

Day-to-day after the first deploy. None of these require a rebuild.

### Scale min-instances up or down

```bash
# Right before a demo / judging window opens — pay for warm capacity.
gcloud run services update atlasorbit --region us-central1 --min-instances 1

# Back to free tier when idle.
gcloud run services update atlasorbit --region us-central1 --min-instances 0
```

Each call creates a new revision that reuses the existing image and
secrets. Takes ~10-30 s. Cost while `min-instances=1`: roughly
**$1.50-2/day** at `cpu=1 memory=1Gi` (always-allocated CPU is the line
item that falls outside the free tier — see
[Appendix C](#appendix-c--free-tier--expected-costs)).

### Rotate a secret without rebuilding the image

If the Gemini key hits a quota wall and you want to swap to a paid one,
or the Mongo password leaks:

```bash
# Add a NEW version. Don't delete the old one — Secret Manager keeps
# history, so rollback is one command.
printf 'NEW_VALUE' | gcloud secrets versions add GEMINI_API_KEY --data-file=-

# `--set-secrets …:latest` resolves the version at container boot. Force
# a fresh container so the new value is picked up — no image rebuild.
gcloud run services update atlasorbit --region us-central1 \
  --update-labels rotate=$(date +%s)
```

`gcloud secrets versions list <SECRET>` shows the version history.
Rollback by adding the old payload as a new version, OR by pinning
`--set-secrets MONGODB_URI=MONGODB_URI:N` to a specific version `N` on
the next deploy.

### View logs

```bash
gcloud run services logs read atlasorbit --region us-central1 --limit 200

# Tail with structured fields (useful when diagnosing `[mcp]` / `[agent]` lines).
gcloud run services logs read atlasorbit --region us-central1 --limit 500 \
  --format='value(timestamp, textPayload)'
```

### Tear down (after the hackathon)

```bash
# Stop the only meaningful ongoing bill.
gcloud run services delete atlasorbit --region us-central1

# Optional cleanup — the Artifact Registry storage costs ~$0.05/month.
gcloud artifacts repositories delete atlasorbit --location us-central1

# Optional — drop the secrets too (irreversible; back up the values first if
# you might redeploy later).
gcloud secrets delete MONGODB_URI
gcloud secrets delete GEMINI_API_KEY
```

The Atlas M0 cluster is independent of GCP — manage it from the Atlas
UI. Free tier never bills, so there's no Atlas cost to stop.

---

## 8. Troubleshooting

### `MCP error -32000: Connection closed` on Connect

The MongoDB MCP subprocess died before completing the JSON-RPC `initialize`
handshake. On Cloud Run the most common cause is `npx`'s registry/cache
round-trip failing under the non-root runtime user — the Dockerfile's
prewarm step in [Appendix B](#why-the-runtime-stage-pre-warms-the-npx-cache)
exists precisely to avoid this. If you see this error and you wrote your
own Dockerfile, replicate the prewarm.

If the prewarm is in place and the error still appears, pull stderr from
the failing subprocess:

```bash
gcloud run services logs read atlasorbit --region us-central1 --limit 500 \
  --format='value(timestamp, textPayload)' \
  | grep -B 2 -A 10 mcp.connect
```

Look for a line *immediately before* `mcp.connect() failed` — that's the
actual error from inside `mongodb-mcp-server` (URI parse failure,
authentication rejection, etc.).

### `[mcp] MongoDB probe timed out after 8000ms`

Atlas Network Access doesn't include Cloud Run's egress IPs. Cloud Run
runs from Google's dynamic ranges. The Mongo driver hangs until the 8 s
probe timeout in `mongoClient.ts` `probe()` fires, then the server
reports the cluster as unreachable.

Fix: Atlas → **Network Access** → **Add IP Address** → **Allow Access
From Anywhere** (`0.0.0.0/0`). Propagation is ~30 s. For production use
VPC peering or PrivateLink, but for an M0 demo against a read-only DB
user `0.0.0.0/0` is acceptable.

### `/health` shows `mongoUriConfigured: false` or `geminiKeyConfigured: false`

The secret didn't reach the container. Check:

1. The Secret Manager secret has at least one enabled version:
   `gcloud secrets versions list <NAME>`.
2. The runtime SA has `roles/secretmanager.secretAccessor` — re-run
   [§2.3](#23-grant-the-cloud-run-service-account-access).
3. The deploy command included the right `--set-secrets` mapping (LHS
   is the env var name, RHS is `SECRET_NAME:VERSION`).
4. The container restarted after you fixed any of the above (a label
   bump from [§7](#7-operations--post-deploy-tasks) forces a restart
   without a rebuild).

### Agent works but turns occasionally fail with quota / rate-limit errors

Almost always the Gemini AI Studio free key hitting per-minute caps.
Rotate to a paid key using the no-rebuild flow in [§7](#7-operations--post-deploy-tasks).

### `gcloud config set project foo` succeeds but later commands say "Project not found or permission denied"

`gcloud config set project` only writes to local config — it never
contacts the API. If you typed an ID that doesn't exist or that your
account can't see, every subsequent command fails. The "Are you sure
you wish to set property [core/project] …?" prompt at the time was
gcloud warning you it couldn't verify. Fix:

```bash
gcloud projects list             # what this account can actually see
gcloud config set project <correct-id>
```

GCP project IDs are globally unique across all customers — `atlas-orbit`
may have been taken, in which case the console auto-appended a suffix
(e.g. `atlas-orbit-426917`). Always use the **ID**, not the display name.

### `INVALID_ARGUMENT` from gcloud when pasting values

macOS smart-quote substitution. The literal you pasted contains curly
`"…"` (U+201C / U+201D) instead of ASCII `"…"`. Type the command in
the terminal directly, or quote with single quotes — `'$VALUE'`-style
prevents the shell from doing anything with the content.

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

### Why the runtime stage pre-warms the `npx` cache

The server spawns the MCP subprocess as
`npx -y mongodb-mcp-server@latest --readOnly`. On localhost that "just
works" because the developer's home dir has a populated npm cache. On
Cloud Run it does not — the runtime image's filesystem is read-only
except for an in-memory overlay, the container runs as the unprivileged
`node` user, and `npx`'s default behavior is to (a) hit the npm registry
for a freshness check on `@latest` and (b) write the resolved package
into `~/.npm/_npx/<hash>/`. Under Cloud Run that combination dies — `npx`
exits non-zero before launching `mongodb-mcp-server`, the stdio pipe
closes, and the `@modelcontextprotocol/sdk` client surfaces
`MCP error -32000: Connection closed`.

The fix lives entirely in the `runtime` stage:

```dockerfile
ENV HOME=/home/node

RUN npm install -g mongodb-mcp-server@latest \
 && mkdir -p /home/node/.npm \
 && chown -R node:node /home/node

USER node
RUN npx -y mongodb-mcp-server@latest --help > /dev/null 2>&1 || true
```

That last `RUN` runs as the `node` user (matches runtime UID), populates
`/home/node/.npm/_npx/<hash>/node_modules/mongodb-mcp-server` inside the
image, and the layer persists across cold starts (unlike `/tmp`, which
Cloud Run mounts as a fresh tmpfs per container). At runtime, the
identical `npx -y` invocation finds the package already cached and skips
the registry round-trip — subprocess starts in ~50 ms.

There's nothing Cloud Run-specific in the rest of the image — it runs
anywhere that can run a container and set `PORT`, `MONGODB_URI`, and
`GEMINI_API_KEY`. The prewarm is just defensive against any container
runtime that restricts npm cache writes for non-root users.

## Appendix C — Free tier & expected costs

| GCP service | Free? | Notes |
|---|---|---|
| Cloud Build | ✅ Yes | 120 build-min/day. Our build is ~3–5 min. |
| Artifact Registry | ⚠️ Almost | 0.5 GB free; our image is ~600–900 MB → **~$0.05–$0.10/month** for storage. Negligible. |
| Secret Manager | ✅ Yes | 10k access ops/month + 6 active versions free. Two secrets, well under cap. |
| Cloud Run, request-billed (`--min-instances 0`) | ✅ Yes | 180k vCPU-sec + 360k GiB-sec + 2M requests/month free. Hackathon traffic never approaches it. |
| Cloud Run, instance-billed (`--min-instances ≥ 1`) | ❌ No | Always-allocated CPU bills 24/7. Roughly **$45–$55/month** at `cpu=1 memory=1Gi`. |

**Gemini AI Studio API** — free tier is rate-limited per minute but
zero-dollar. Plenty for one concurrent demo session. Multiple concurrent
judges in the same minute can hit RPM caps; swap to a paid Gemini key
just for the live window via the no-rebuild flow in
[§7](#7-operations--post-deploy-tasks). MongoDB Atlas M0 is
forever-free, independent of GCP.

### Recommended pattern for a hackathon judging window

| Phase | Setting | Cost |
|---|---|---|
| Building / verifying | `--min-instances 0 --cpu-boost` | Free (~4–5 s cold start) |
| Demo / judging window | `--min-instances 1` (no rebuild — see [§7](#7-operations--post-deploy-tasks)) | ~$1.50–$2/day |
| After judging | Back to `--min-instances 0` or `gcloud run services delete` | Free / nothing |

A 48-hour judging window at `--min-instances 1` costs about **$3–$4**.
Deleting the service immediately after stops all billing; the
Artifact-Registry storage line item alone is ~$0.05/month if you leave
the image behind for future redeploys.
