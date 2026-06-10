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
ENV NODE_ENV=production \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# Production deps only, scoped to the server workspace.
COPY package.json package-lock.json* ./
COPY ui/package.json ./ui/
COPY server/package.json ./server/
RUN npm ci --omit=dev --workspace server --include-workspace-root

# Pre-cache the MongoDB MCP server so `npx` doesn't download it on first call.
RUN npm install -g mongodb-mcp-server@latest

# Built artifacts.
COPY --from=server-builder /app/server/dist ./server/dist
COPY --from=ui-builder /app/ui/dist ./public

USER node
EXPOSE 8080
CMD ["node", "server/dist/index.js"]
