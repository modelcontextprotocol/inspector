---
name: test-servers
description: Run a composable MCP test server by hand — pick the showcase config for a feature or bug, build it, and connect with the right protocol era. Use when a change, a PR or a smoke test needs a real server to exercise it; when reproducing a reported bug by hand; when choosing which fixture or protocol era to run; when a fixture keeps serving stale code after an edit; or when the config or preset you need does not exist yet.
disable-model-invocation: false
---

# Running a test server

`test-servers/` provides **composable MCP servers** so tests and manual checks
exercise a real server over a real transport instead of mocks. A server is
assembled from **presets** (fixture factories in
`test-servers/src/preset-registry.ts`) and configured declaratively with a JSON
file under `test-servers/configs/`.

The full catalogue of showcase configs — one per feature, each with what to click
and what the broken build did — is
[`docs/test-servers.md`](../../../docs/test-servers.md). This skill is how to
run one.

## Build first

The servers are spawned as real subprocesses, so the build output must exist:

```sh
cd clients/web && npm run test-servers:build   # tsc -p test-servers → test-servers/build/
```

Scripts reach this through `scripts/ensure-test-servers.mjs`, which builds
**unconditionally** (once per process per repo root).

⚠️ **Unconditional emit is not a clean.** A **deleted** source file leaves its
stale `.js` behind, existence checks pass against it, and anything still
importing that module silently runs the old code — reported not as staleness but
as a product failure in whatever was being tested. So after deleting or renaming
a source file:

```sh
rm -rf test-servers/build
```

The `.tsbuildinfo` is pinned inside `build/` so that clean actually invalidates
the cache.

## Run one

Two processes: the test server, then the Inspector.

```sh
# 1. The server, from the repo root, with the config you picked:
node test-servers/build/server-composable.js --config test-servers/configs/<name>.json
```

```sh
# 2. The Inspector, in another terminal (needs a built launcher — `npm run build`):
node clients/launcher/build/index.js --web
```

Then add the server in the Inspector using the URL the first process announced.

Two mechanics that bite:

- **The server announces its URL on _stderr_**, not stdout (`console.error` in
  `server-composable.ts`). Watching stdout alone looks like a server that never
  started.
- **The bound port is not necessarily the config's.** `createTestServerHttp`
  resolves through `findAvailablePort()`, which walks upward when the configured
  port is taken — so read the announced URL rather than assuming.

## Pick the right protocol era

Each config in [`docs/test-servers.md`](../../../docs/test-servers.md) says
which era to connect with. The default is **legacy**; configs setting
`transport.modern` need **Protocol Era = Modern**. Connecting with the wrong era
usually looks like a missing capability rather than an error.

## Common starting points

| Want to see | Config |
| --- | --- |
| An MCP App in the Apps tab | `mcp-app-http.json` (legacy) |
| An App-rendered elicitation | `app-elicitation-http.json` (legacy) |
| `Mcp-*` headers + the modern error taxonomy | `modern-network-http.json` |
| A tool result's `structuredContent` section | `structured-output-http.json` (legacy) |
| RFC 6570 resource-template expansion | `rfc6570-templates-http.json` |
| OAuth token revocation on clear | `oauth-revocation-http.json` (legacy) |
| A token endpoint the SDK refuses (SEP-2207) | `oauth-insecure-token-endpoint-http.json` (legacy) |
| Cancelling a call mid-flight | `cancellation-modern-http.json` (modern) |

## Adding a config or preset

- Presets live in `test-servers/src/preset-registry.ts`; configs in
  `test-servers/configs/*.json`.
- A new showcase config gets a row in `docs/test-servers.md` saying what to do
  and what the broken build did — the "what it looked like broken" half is what
  makes the fixture reproducible later.
- ⚠️ **An `outputSchema` override must ride a tool that returns structured
  content.** A conforming client validates the result against the advertised
  schema, so an override on a preset returning none makes every call fail with
  "declares an output schema but returned no structured content".
