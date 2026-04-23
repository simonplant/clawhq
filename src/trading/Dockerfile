# syntax=docker/dockerfile:1.7

# Multi-stage build for the Market Engine sidecar.
#
# Stage 1 (builder) — install dev deps, compile TS to JS.
# Stage 2 (runtime) — production-only deps, non-root user, read-only rootfs.
#
# Build context is staged at `engine/market-engine/` and contains:
#   package.json, tsconfig.json, src/ (trading sources), Dockerfile (this file).

# ── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Needed for native compile of better-sqlite3.
RUN apk add --no-cache python3 make g++ sqlite

WORKDIR /build

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# sqlite runtime lib for better-sqlite3 (the binary from stage 1 is linked).
# The base image already provides uid 1000 (node user) — reuse it.
RUN apk add --no-cache sqlite-libs tini

WORKDIR /app

COPY --from=builder /build/package.json ./
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist

RUN chown -R node:node /app

USER node

ENV NODE_ENV=production \
    TRADING_DEPLOY_DIR=/deploy

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
