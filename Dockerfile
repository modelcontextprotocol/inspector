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
# never try to open a browser from inside it. Binding 0.0.0.0 is refused by
# default (it exposes the process-spawning backend to the network); a container
# is the sanctioned exception, so opt in explicitly via DANGEROUSLY_BIND_ALL_INTERFACES.
ENV HOST=0.0.0.0 \
    DANGEROUSLY_BIND_ALL_INTERFACES=true \
    CLIENT_PORT=6274 \
    MCP_SANDBOX_PORT=6275 \
    MCP_APP_ORIGIN_PORT=6278 \
    MCP_AUTO_OPEN_ENABLED=false
# 6275 is the MCP Apps sandbox and 6278 the dedicated app origin (#2056) — two
# further listeners the browser reaches DIRECTLY, so neither works through the
# 6274 publish alone. Both are only needed for the Apps tab (6278 only for an
# App declaring `_meta.ui.domain`), so they are EXPOSEd but publishing them is
# optional — see the Docker section of the root README.
EXPOSE 6274 6275 6278

# Run as the non-root `node` user the base image ships. The inspector resolves
# its runtime-state dir (default catalog, OAuth token storage) from `HOME`
# (core/storage/store-io.ts), so set it explicitly to the node user's writable
# home and work from there.
ENV HOME=/home/node

# Create the runtime-state dir up front, owned by `node`. Docker seeds a named
# volume's ownership from the image's directory at the mount point — and when
# that directory does not exist it creates it `root:root`, which the non-root
# `node` user then cannot write. Without this, `-v inspector-data:/home/node/.mcp-inspector`
# (the recipe for keeping your saved servers across `docker run --rm`) makes
# every "add server" fail with `EACCES ... open '/home/node/.mcp-inspector/mcp.json.tmp-*'`.
RUN mkdir -p /home/node/.mcp-inspector && chown -R node:node /home/node/.mcp-inspector

USER node
WORKDIR /home/node

# Report readiness by probing the served SPA (`/` needs no auth). Uses Node's
# global fetch — no curl/wget in the slim image. Assumes the default `--web`
# mode; running `--cli`/`--tui` has no web server, so add `--no-healthcheck` to
# `docker run` for those.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.CLIENT_PORT||6274)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Default to the web UI; override the args to run --cli / --tui.
ENTRYPOINT ["mcp-inspector"]
CMD ["--web"]
