#!/bin/sh
# Idempotent loader for the official MongoDB sample_mflix dataset. Run by
# the `mongo-init` service in docker-compose.yml. On first boot, downloads
# the ~50MB archive from MongoDB's public S3 bucket and restores it into
# the local mongodb service. On subsequent boots, detects that the data
# already exists and exits without doing anything.
#
# Manual one-off invocation (outside docker-compose):
#   docker run --rm --network host \
#     -v "$(pwd)/scripts/local-mongo-init.sh:/init.sh:ro" \
#     mongo:7 sh /init.sh

set -eu

HOST="${MONGO_HOST:-mongodb}"
ARCHIVE="/tmp/sampledata.archive"
ARCHIVE_URL="https://atlas-education.s3.amazonaws.com/sampledata.archive"

log() {
  printf '[mflix-loader] %s\n' "$*"
}

# Idempotency probe: is sample_mflix already loaded with the movies coll?
# `movies` is the largest sample collection; if it has any docs we assume
# the full dataset is present (mongorestore is atomic per-collection so
# partial restores are unlikely).
already_loaded() {
  mongosh --host "$HOST" --quiet --eval \
    "quit(db.getSiblingDB('sample_mflix').movies.estimatedDocumentCount() > 0 ? 0 : 1)" \
    >/dev/null 2>&1
}

if already_loaded; then
  log "sample_mflix already loaded into $HOST — skipping."
  exit 0
fi

log "sample_mflix not found in $HOST. Preparing download..."

# `mongo:7` is based on Ubuntu and ships with `mongosh` + `mongorestore`
# but NOT `curl` or `wget`. Install one of them on first boot. The image
# is throwaway (one-shot container), so `apt` state doesn't persist —
# that's fine, this only runs when sample_mflix isn't loaded yet.
download_archive() {
  if command -v curl >/dev/null 2>&1; then
    curl --fail --silent --show-error --location -o "$ARCHIVE" "$ARCHIVE_URL"
  elif command -v wget >/dev/null 2>&1; then
    wget --quiet -O "$ARCHIVE" "$ARCHIVE_URL"
  else
    log "Installing curl (one-time, ~10s)..."
    apt-get update -qq >/dev/null
    apt-get install -y --no-install-recommends curl >/dev/null
    curl --fail --silent --show-error --location -o "$ARCHIVE" "$ARCHIVE_URL"
  fi
}

log "Downloading sample_mflix archive (~50MB) from atlas-education.s3.amazonaws.com..."
download_archive

log "Restoring sample_mflix (only) — other sample_* DBs are skipped to save space..."
mongorestore --host "$HOST" \
  --archive="$ARCHIVE" \
  --nsInclude='sample_mflix.*' \
  --drop \
  --quiet

# Verify
if already_loaded; then
  COUNT=$(mongosh --host "$HOST" --quiet --eval \
    "print(db.getSiblingDB('sample_mflix').movies.estimatedDocumentCount())")
  log "Done. sample_mflix.movies has ~$COUNT documents."
else
  log "ERROR: restore appeared to complete but sample_mflix.movies is still empty."
  exit 1
fi

# Ensure the secondary indexes the demos rely on exist. `mongorestore` of the
# atlas-education archive already recreates `movies`' text index
# (cast/fullplot/genres/title) — the same one Atlas ships — so this is just a
# safety net for archives or partial restores that don't include it. It is
# idempotent: createIndex with a matching spec is a no-op when the index is
# already present.
#
# NOTE: the Atlas *Vector Search* index on `embedded_movies.plot_embedding`
# is an Atlas-managed search index, NOT a normal MongoDB index — it is not in
# any mongodump archive and cannot be created on vanilla `mongod`. That's why
# the demos route vibes queries through `$match + $text` on `movies` instead
# of `$vectorSearch`. See LOCAL_DEV.md.
ensure_indexes() {
  mongosh --host "$HOST" --quiet --eval '
    const db = db.getSiblingDB("sample_mflix");
    const hasText = db.movies.getIndexes().some(
      (ix) => ix.key && ix.key._fts === "text"
    );
    if (hasText) {
      print("[mflix-loader] movies text index already present — skipping.");
    } else {
      db.movies.createIndex(
        { cast: "text", fullplot: "text", genres: "text", title: "text" },
        { name: "cast_text_fullplot_text_genres_text_title_text" }
      );
      print("[mflix-loader] created movies text index.");
    }
  '
}

log "Ensuring demo indexes (movies text index)..."
ensure_indexes
