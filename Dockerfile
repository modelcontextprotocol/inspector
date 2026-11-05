# syntax=docker/dockerfile:1

# The base for both stages, pinned by digest (#2833) so a rebuild of the same
# commit gets the same Node and the same Debian packages rather than whatever
# `node:22-slim` points at that day. The digest is the multi-arch INDEX, so it
# covers linux/amd64 and linux/arm64 alike. Bumping it is a deliberate edit:
#   docker buildx imagetools inspect node:22-slim   # the "Digest:" line
# and keep the Node it carries inside the root package.json `engines` range.
# No sweep reports a stale digest yet (#2885), so Node and Debian security
# fixes reach the image only when this line is bumped.
ARG NODE_IMAGE=node:22-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da

# ---------------------------------------------------------------------------
# Build stage — install everything from the committed lockfiles, build all
# clients, and pack the exact tarball npm would publish.
#
# `npm ci` rather than `npm install` (#2833): it installs exactly what each
# lockfile records and fails if a manifest has drifted from it, so the image is
# built from the dependency tree CI tested instead of one resolved fresh. The
# root postinstall cascade runs `npm install` in each client, so it is skipped
# here and each client gets its own `npm ci` — each one exits the RUN on
# failure, since a `for` loop returns only its last iteration's status and
# would otherwise build on a partial tree. `npm pack` runs `prepack`
# (`npm run build`) and emits `modelcontextprotocol-inspector-<version>.tgz`.
#
# Then the runtime tree is assembled HERE rather than in the runtime stage: the
# tarball is unpacked and its production dependencies installed with `npm ci`
# against the root `package-lock.json` — the same lockfile the build above used
# — so the shipped tree is the tested one, not a fresh resolution of the
# manifest's caret ranges. `--ignore-scripts` keeps every lifecycle script out
# (the published package's only one is its own postinstall, which is a no-op
# outside a source checkout). The bins are made executable by hand because
# `npm ci` links the dependencies' bins, never the root package's own.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /build
COPY . .
RUN INSPECTOR_SKIP_CLIENT_INSTALL=1 npm ci \
    && for client in web cli mcpdo tui launcher; do npm ci --prefix "clients/$client" || exit 1; done \
    && npm pack
RUN mkdir -p /opt/mcp-inspector \
    && tar -xzf modelcontextprotocol-inspector-*.tgz --strip-components=1 -C /opt/mcp-inspector \
    && cp package-lock.json /opt/mcp-inspector/ \
    && cd /opt/mcp-inspector \
    && npm ci --omit=dev --ignore-scripts \
    && chmod +x clients/launcher/build/index.js clients/mcpdo/build/mcp-bin.js

# ---------------------------------------------------------------------------
# Runtime stage — the assembled tree, copied in. Nothing is installed with npm
# here, so no install script runs and nothing is downloaded from the registry;
# the old `npm install -g` also left its ~200 MB download cache in /root/.npm
# and the tarball in an earlier layer, both of which this stage never creates.
# The tree lands where a global install would put it, root-owned and therefore
# read-only to the `node` user the container runs as, and the three bins the
# package declares are linked onto PATH as `npm install -g` would link them.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production

# tini as PID 1 (#2833). Node does not reap orphaned grandchildren, and stdio
# MCP servers launched through `npx` create exactly those, so without an init
# they pile up as zombies for the life of the container; tini also forwards
# signals, so `docker stop` reaches the launcher. It is installed from Debian
# rather than relying on `docker run --init`, which nobody remembers to pass.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/mcp-inspector /usr/local/lib/node_modules/@modelcontextprotocol/inspector
RUN cd /usr/local/bin \
    && ln -s ../lib/node_modules/@modelcontextprotocol/inspector/clients/launcher/build/index.js mcp-inspector \
    && ln -s ../lib/node_modules/@modelcontextprotocol/inspector/clients/launcher/build/index.js inspector \
    && ln -s ../lib/node_modules/@modelcontextprotocol/inspector/clients/mcpdo/build/mcp-bin.js mcpdo

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

# Report readiness by probing the unauthenticated `/healthz` route (#2438).
# The probe connects to the address derived from the same `HOST` the server
# binds (a wildcard maps to loopback), so overriding `HOST` to one interface
# keeps the healthcheck valid (#2424), and uses https when both
# `INSPECTOR_TLS_*` paths are set, without verifying the certificate (#2825)
# — see the script's header. Only `--web` has a
# server to probe, so the script reads the launch mode from PID 1's argv and
# reports a `--cli`/`--tui` container healthy while it runs (#2415).
COPY --from=builder /build/scripts/docker-healthcheck.mjs /usr/local/lib/mcp-inspector-healthcheck.mjs
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "/usr/local/lib/mcp-inspector-healthcheck.mjs"]

# Default to the web UI; override the args to run --cli / --tui. tini execs
# the launcher as its child and stays PID 1; the healthcheck reads the launch
# mode through it (scripts/docker-healthcheck.mjs, `launchMode`).
ENTRYPOINT ["/usr/bin/tini", "--", "mcp-inspector"]
CMD ["--web"]
