# Deployment Guide — Gemini NoSQL Data Wrangler

This guide walks through the four pieces of infrastructure required to run the
project end-to-end:

1. **MongoDB Atlas** (M0 free cluster, loaded with `sample_mflix`)
2. **Google Cloud Secret Manager** (holds `MONGODB_URI` and `GEMINI_API_KEY`)
3. **Google Cloud Run** (hosts the Node.js backend container)
4. **Frontend hosting** (Vercel or Google Cloud Storage + Cloud CDN)

---

## 1. MongoDB Atlas — Free M0 Cluster with `sample_mflix`

### 1.1 Create the cluster
1. Sign in at <https://cloud.mongodb.com> and create a new Project, e.g. `gemini-wrangler`.
2. Click **Build a Database** → choose **M0 (Free)**.
3. Pick a cloud provider/region (GCP region matching your Cloud Run region is ideal — e.g. `us-central1`).
4. Name the cluster (e.g. `wrangler-cluster`) and click **Create Deployment**.

### 1.2 Configure access
1. Under **Database Access**, create a database user with a strong password and
   the built-in role **Read and write to any database**. Note the username and password.
2. Under **Network Access**, add an IP allow-list entry:
   - For local development: add your current IP.
   - For Cloud Run: add `0.0.0.0/0` (or, preferred, configure VPC peering / PrivateLink).

### 1.3 Load the `sample_mflix` dataset
1. In the Atlas UI, click the **`…`** menu on your cluster → **Load Sample Dataset**.
2. Confirm. Loading takes 5–10 minutes; you should see eight `sample_*` databases when it finishes.
3. Verify that `sample_mflix.embedded_movies` exists. This collection contains
   movies from the `Western`, `Action`, and `Fantasy` genres only (it's a
   subset of `sample_mflix.movies`). Each document includes:
   - `plot_embedding` — 1536-dim OpenAI `text-embedding-ada-002` vector,
     stored as `binData` (this is what we query with `$vectorSearch`).
   - `plot_embedding_voyage_3_large` — 2048-dim Voyage AI vector, also `binData`.

   Heads up for the agent: vibes-based queries will only ever return Western /
   Action / Fantasy results. The system instruction must mention this so the
   agent doesn't promise, say, a romcom search against this collection.

### 1.4 (Optional) Atlas Vector Search index
This deployment does **not** require an Atlas Vector Search index. The system
instruction routes conceptual / "vibes-based" queries to `$match` with the
`$text` operator on `sample_mflix.movies` (which already has a text index on
`cast`, `fullplot`, `genres`, `title`). The visual `MQL_VECTOR_SEARCH` node
on the canvas is a UI choice — the execution underneath is text search.

Why not real `$vectorSearch`? The pre-loaded `plot_embedding` field on
`embedded_movies` is a 1536-dim OpenAI ada-002 vector. To query against it
the client would need to generate ada-002 embeddings at request time, which
requires an OpenAI key we don't ship with the demo. Gemini's
`text-embedding-004` is 768-dim and lives in a different vector space, so
it isn't a drop-in substitute. See `dev-log.md` for the longer story.

If you do want to extend the project to call live `$vectorSearch`, create the
index in Atlas (`sample_mflix.embedded_movies` → Search Indexes → Atlas
Vector Search → JSON editor), name it `plot_vector_index`, and use
`numDimensions: 1536, similarity: "cosine", path: "plot_embedding"`. Then
add a server-side `embed_text` tool that calls ada-002 and update the
system instruction to route vibes queries to `$vectorSearch` with the
returned vector.

### 1.5 Grab the connection string
1. Atlas → **Database** → **Connect** → **Drivers** → copy the URI.
2. Replace `<username>` / `<password>` placeholders. Final shape:
   ```
   mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
   ```
3. Save it — you will store it in Secret Manager in step 2.

---

## 2. Google Cloud Secret Manager

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

### 2.2 Create the secrets
```bash
# MongoDB connection string from step 1.5
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

## 3. Google Cloud Run — Node.js Backend

### 3.1 Build and push the container
The repository ships with a `Dockerfile` in `server/` optimized for Cloud Run.

```bash
export REGION="us-central1"
export REPO="wrangler"
export IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/server:latest"

# One-time: create the Artifact Registry repo.
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker \
  --location="$REGION"

# Build with Cloud Build (no local Docker required).
gcloud builds submit ./server --tag "$IMAGE"
```

### 3.2 Deploy
```bash
gcloud run deploy wrangler-server \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --timeout 3600 \
  --cpu 1 --memory 1Gi \
  --min-instances 0 --max-instances 4 \
  --set-secrets "MONGODB_URI=MONGODB_URI:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest"
```

Notes:
- **WebSockets**: Cloud Run supports WebSockets out of the box on HTTPS endpoints;
  no special flag is required. `--timeout 3600` raises the max stream duration
  to one hour (Cloud Run's ceiling) which is the relevant knob for long voice
  sessions.
- **Port**: Cloud Run injects `PORT=8080`; the server must bind to `process.env.PORT`.
- **Cold start**: leave `--min-instances 0` for the hackathon to stay free-tier;
  bump to `1` for demos to avoid the first-WebSocket handshake delay.

After deploy, note the printed service URL (e.g.
`https://wrangler-server-xxxxxxxx-uc.a.run.app`). The UI uses
`wss://<that-host>` as its WebSocket endpoint.

---

## 4. Frontend — Vite React App

Two simple options. Pick one.

### Option A — Vercel (fastest)
1. `cd ui && npx vercel link` (one-time).
2. Set the env var `VITE_WS_URL=wss://wrangler-server-xxxxxxxx-uc.a.run.app` in
   the Vercel project settings.
3. `npx vercel --prod`.

### Option B — Google Cloud Storage + Cloud CDN
```bash
cd ui
VITE_WS_URL="wss://wrangler-server-xxxxxxxx-uc.a.run.app" npm run build

export BUCKET="gs://${PROJECT_ID}-wrangler-ui"
gsutil mb -l "$REGION" "$BUCKET"
gsutil iam ch allUsers:objectViewer "$BUCKET"
gsutil -m rsync -r -d dist "$BUCKET"
gsutil web set -m index.html -e index.html "$BUCKET"
```
Optionally front the bucket with an HTTPS Load Balancer + Cloud CDN for a
custom domain.

---

## 5. Smoke test
1. Open the frontend URL.
2. Grant microphone permission.
3. Say *"List the databases you can see."* — the canvas should remain idle while
   the agent calls the MCP `list_databases` tool and speaks the result.
4. Say *"Find movies about a heist gone wrong."* — a purple `$vectorSearch`
   node should appear on the canvas, followed by a `$project` / result table.
5. Say *"Now only movies from before 1980."* — a standard (non-purple) `$match`
   node should be appended.

If any of these fail, check Cloud Run logs:
```bash
gcloud run services logs read wrangler-server --region "$REGION" --limit 200
```

---

## Appendix — How the backend talks to MongoDB

The backend does **not** import a MongoDB driver directly. It uses the official
MongoDB MCP server (`mongodb-mcp-server`) as a subprocess and speaks to it over
stdio using `@modelcontextprotocol/sdk`. The container's `Dockerfile` should
include `npx`/Node so this spawn works at runtime. The backend launches the
MCP server as:

```
npx -y mongodb-mcp-server@latest --readOnly
```

…with `MDB_MCP_CONNECTION_STRING=<your Atlas URI>` in the spawned env. We pass
`--readOnly` so the hackathon demo can't accidentally mutate the cluster.
The Dockerfile pre-installs `mongodb-mcp-server` globally so the first
`npx` invocation doesn't pay a download cost on cold start.

The MCP server exposes these tool names (kebab-case — the agent's system
instruction must use these exact identifiers):
- `list-databases`, `list-collections`, `collection-schema`
- `find`, `count`, `aggregate`
- `insert-many`, `update-many`, `create-collection`
- plus `atlas-*` tools that we ignore for this demo.

For the full and current list, see <https://www.mongodb.com/docs/mcp-server/tools/>.
