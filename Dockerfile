# syntax=docker/dockerfile:1.6
#
# Single-image build for Cloud Run. The compiled UI is served from the same
# origin as the WebSocket, so judges only need one URL.
#
# Stages:
#   1. ui-builder      → Vite-built UI in /app/ui/dist
#   2. server-builder  → Compiled server in /app/server/dist
#   3. runtime         → node:22-slim with prod deps + the two outputs above

# ─── 1. UI builder ──────────────────────────────────────────────────────────
FROM node:22-slim AS ui-builder
WORKDIR /app
ENV NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false

COPY package.json package-lock.json* ./
COPY ui/package.json ./ui/
COPY server/package.json ./server/
RUN npm ci --include-workspace-root

COPY ui ./ui
RUN npm run build --workspace ui

# ─── 2. Server builder ──────────────────────────────────────────────────────
FROM node:22-slim AS server-builder
WORKDIR /app
ENV NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false

COPY package.json package-lock.json* ./
COPY ui/package.json ./ui/
COPY server/package.json ./server/
RUN npm ci --include-workspace-root

COPY server ./server
RUN npm run build --workspace server

# ─── 3. Runtime ─────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
# HOME is set explicitly so `npx`'s per-user cache directory resolves
# under Cloud Run too (Cloud Run's env passed to the container doesn't
# always populate $HOME for non-root users). The default npm cache
# (~/.npm) is left at /home/node/.npm — that path lives in the IMAGE
# layer, persists across cold starts, and is writable under Cloud Run's
# RW overlay. /tmp would NOT work — Cloud Run mounts a fresh tmpfs over
# /tmp per container, so anything pre-warmed there at build time would
# vanish at runtime.
ENV NODE_ENV=production \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    HOME=/home/node

# Production deps only, scoped to the server workspace.
COPY package.json package-lock.json* ./
COPY ui/package.json ./ui/
COPY server/package.json ./server/
RUN npm ci --omit=dev --workspace server --include-workspace-root

# Pre-cache the MongoDB MCP server globally (drops the binary on PATH at
# /usr/local/bin/mongodb-mcp-server) AND make sure /home/node exists
# with the right ownership so the npx prewarm below can write into
# /home/node/.npm without permission grief.
RUN npm install -g mongodb-mcp-server@latest \
 && mkdir -p /home/node/.npm \
 && chown -R node:node /home/node

# Built artifacts.
COPY --from=server-builder /app/server/dist ./server/dist
COPY --from=ui-builder /app/ui/dist ./public

# Seed npx's `_npx/<hash>/node_modules/mongodb-mcp-server` cache tree as
# the `node` user (matches runtime UID, so file perms line up). At
# runtime, `npx -y mongodb-mcp-server@latest --readOnly` finds the
# package in cache and skips the npm-registry round-trip — which is the
# step that was failing on Cloud Run with "MCP error -32000: Connection
# closed". The `--help` invocation exits 0 after printing help; we only
# care about the side effect of populating the cache.
USER node
RUN npx -y mongodb-mcp-server@latest --help > /dev/null 2>&1 || true

EXPOSE 8080
CMD ["node", "server/dist/index.js"]
