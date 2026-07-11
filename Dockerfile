# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage — install everything, build all clients, and pack the exact
# tarball npm would publish. `npm install` runs the root postinstall cascade
# (per-client installs, since v2 is not a workspace); `npm pack` runs `prepack`
# (`npm run build`) and emits `modelcontextprotocol-inspector-<version>.tgz`.
# ---------------------------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /build
COPY . .
RUN npm install && npm pack

# ---------------------------------------------------------------------------
# Runtime stage — install just the packed tarball (production deps only),
# yielding a clean global `mcp-inspector` bin: the same artifact a user gets
# from `npm i -g @modelcontextprotocol/inspector`. The package's postinstall
# early-exits under node_modules, and the tarball ships only each client's
# build/ output, so there is nothing to build here.
# ---------------------------------------------------------------------------
FROM node:22-slim AS runner
ENV NODE_ENV=production

COPY --from=builder /build/modelcontextprotocol-inspector-*.tgz /tmp/inspector.tgz
RUN npm install -g /tmp/inspector.tgz && rm /tmp/inspector.tgz

# Serve on all interfaces so the UI is reachable from outside the container, and
# never try to open a browser from inside it.
ENV HOST=0.0.0.0 \
    CLIENT_PORT=6274 \
    MCP_AUTO_OPEN_ENABLED=false
EXPOSE 6274

# Default to the web UI; override the args to run --cli / --tui.
ENTRYPOINT ["mcp-inspector"]
CMD ["--web"]
