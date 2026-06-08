# Local development with MongoDB on localhost

By default the app talks to MongoDB Atlas. That's the right setup for production / for sharing the app with judges, but Atlas free-tier M0 sits behind a network round-trip that adds 200ms–2s per query — over a 3–5 step demo, the cumulative wait is noticeable.

Running MongoDB locally (in Docker) drops query latency to **single-digit milliseconds**, makes the whole agent loop feel snappy, removes Atlas quota concerns, and works offline.

This guide sets up a local `mongod` with the same `sample_mflix` dataset Atlas's "Load Sample Data" provides, in about five minutes.

---

## What's in the box

- **`docker-compose.yml`** at the repo root — defines two services:
  - `mongodb` — `mongo:7` running on port 27017, with a named volume so data persists across restarts.
  - `mongo-init` — one-shot loader that downloads the official `sample_mflix` archive (~50 MB) from MongoDB's S3 mirror and runs `mongorestore` into the local DB. Idempotent — no-op when the data is already loaded.
- **`scripts/local-mongo-init.sh`** — the init container's entrypoint.

---

## Setup

### 1. Start the services

```bash
docker-compose up -d
```

No Docker Hub account needed — `mongo:7` is an official image and pulls anonymously. First run takes ~30 seconds for the ~200 MB image pull, plus another ~20 seconds for the init container to download + `mongorestore` the ~50 MB `sample_mflix` archive. Watch the loader's progress with:

```bash
docker-compose logs mongo-init -f
```

Look for `[mflix-loader] Done. sample_mflix.movies has ~21349 documents.` when it's finished.

Subsequent `docker-compose up -d` calls reuse the volume — `mongo-init` detects the existing data and exits immediately.

### 2. Point the app at localhost

Edit your project-root `.env` (copy from `.env.example` if you don't have one yet):

```bash
MONGODB_URI=mongodb://localhost:27017/
GEMINI_API_KEY=<your AI Studio key>
```

That's it. The server reads `MONGODB_URI` at session-init time. The Mongo MCP server gets spawned with `MDB_MCP_CONNECTION_STRING` pointing at localhost, and queries run against your local data.

### 3. Run the dev servers

```bash
npm install   # if you haven't already
npm run dev   # UI on :5173, server on :8080
```

Open <http://localhost:5173/app> and click **Connect** in the header. Atlas should show the green dot within a second (vs the 1–3s cold start hitting Atlas).

### 4. (Optional) Verify the data

```bash
docker exec -it gemini-wrangler-mongo mongosh
> use sample_mflix
> db.movies.countDocuments()             // ~21349
> db.embedded_movies.countDocuments()    // ~3483
> db.movies.getIndexes()                  // includes the text index used by Demo 1
```

---

## Connection-string precedence (important)

The app resolves which MongoDB URI to use in this order, **highest priority first**:

1. **UI setting** — whatever the user pastes into *Settings → MongoDB Atlas Connection String*. Sent in the init WebSocket message.
2. **Server env** — `MONGODB_URI` from `.env` (or whatever shell exported it).
3. **Nothing** — the server reports "no MongoDB URI configured" and the agent runs in canvas-only mode.

This means **the UI setting always wins**. If you've configured the local URI in `.env` but paste an Atlas URI into Settings, the next Connect uses Atlas — local stays untouched. Useful for A/B-ing the same demo against both endpoints.

---

## Switching back to Atlas

Either:

- Paste your Atlas URI into *Settings → MongoDB Atlas Connection String* (this overrides `.env`), or
- Update `.env`:
  ```
  MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority
  ```
  …and restart the server (`npm run dev:server`).

Stopping the local stack is just:

```bash
docker-compose down          # stop containers; keep the volume
docker-compose down -v       # also delete sample_mflix (forces re-download on next up)
```

---

## What works / doesn't work locally

| Feature | Local `mongod` | Atlas |
|---|---|---|
| `$match` / `$group` / `$sort` / `$project` / `$lookup` / `$unwind` | ✅ | ✅ |
| Text search (`$match: { $text: { $search: "…" } }` on the `movies` text index) | ✅ | ✅ |
| `$vectorSearch` against `embedded_movies.plot_embedding` | ❌ (vanilla mongod has no Atlas Vector Search) | ✅ (with an index — see deployment.md §1.4) |
| MFlix collections: `movies`, `embedded_movies`, `comments`, `users`, `theaters`, `sessions` | ✅ | ✅ |

The three demos use `$match + $text` (not `$vectorSearch`), so all of them work end-to-end against local MongoDB. If you want to extend the project to call real `$vectorSearch`, you need Atlas (vanilla `mongod` doesn't ship the Atlas Search component).

---

## Image registry

`docker-compose.yml` uses fully-qualified image references — `docker.io/library/mongo:7` — rather than the shorter `mongo:7`. The fully-qualified form explicitly pulls from the public Docker Hub registry. The short form would resolve through whatever the local Docker daemon's default registry is configured to be, which isn't always Docker Hub.

If your Docker daemon has `registry-mirrors` configured in `~/.docker/daemon.json`, those mirrors may or may not intercept the qualified pull. If you want the mirror to be used, drop the `docker.io/library/` prefix locally:

```yaml
image: mongo:7
```

Anonymous Docker Hub pulls are subject to a public rate limit (100 pulls per 6 hours per IP). One-time pulls of `mongo:7` are well under that. If you need more headroom, `docker login docker.io` with any free Docker Hub account raises the limit.

---

## Troubleshooting

**Loader hangs on download.** The script uses `curl` to fetch from `atlas-education.s3.amazonaws.com`. Check connectivity:
```bash
docker exec gemini-wrangler-mongo-init sh -c 'curl -I https://atlas-education.s3.amazonaws.com/sampledata.archive'
```

**Loader fails with "already_loaded" loop.** Clear the volume and start over:
```bash
docker-compose down -v
docker-compose up -d
```

**Port 27017 already taken.** You probably have a host-level `mongod` running. Either stop it (`brew services stop mongodb-community`) or change the host-side port mapping in `docker-compose.yml`:
```yaml
ports:
  - "27018:27017"
```
Then use `MONGODB_URI=mongodb://localhost:27018/`.

**Agent reports "MongoDB MCP not connected" even though `docker-compose ps` shows healthy.** Make sure `.env` is at the repo root (not inside `server/`), and that you restarted the dev server after editing it.
