# syntax=docker/dockerfile:1.6
#
# Cloud Run-optimized image for the Node.js backend.
#
# Notes:
#  - Runtime needs `npx` so we can spawn `mongodb-mcp-server` as a subprocess.
#    `npx` ships with Node, so the standard `node:22-slim` base is enough.
#  - We pre-warm the MCP package into the image so cold-start doesn't pay a
#    download cost. The `mongodb-mcp-server` is **not** declared as a runtime
#    dep in package.json — it's a separate process — so we install it
#    independently into a known cache location.
#  - The server reads `PORT` from the environment (Cloud Run injects 8080).

# ─── 1. Builder ─────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Install deps with the lockfile for reproducible builds.
COPY package.json package-lock.json* ./
RUN npm ci --include=dev

# Compile TypeScript → dist/.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ─── 2. Runtime ─────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# Production deps only.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Pre-cache the MongoDB MCP server so `npx` doesn't download it on first call.
# It's installed globally so `npx mongodb-mcp-server@latest` resolves instantly.
RUN npm install -g mongodb-mcp-server@latest

# Drop in the compiled app.
COPY --from=builder /app/dist ./dist

# Run as non-root for Cloud Run's least-privilege default.
USER node

EXPOSE 8080
CMD ["node", "dist/index.js"]
