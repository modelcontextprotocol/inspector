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

## Two ways to use a fixture — pick the right one first

A fixture is used in **one of two shapes**, and almost everything below is about
the second. Establish which one you are in before reading further, because the
config file, the protocol-era table and the staleness hazard belong to only one
of them.

- **In-process — an automated test.** The test *constructs* the server from the
  `@modelcontextprotocol/inspector-test-server` API and owns its lifecycle. No
  subprocess is spawned, no JSON config is read, and no showcase config is
  picked. **This is what an integration test does**, and it is the shape you
  want whenever the caller is a test rather than a person.
- **Two processes — a manual check.** You run `server-composable.js --config
  <name>.json` in one terminal and the Inspector in another, then click. Picking
  the showcase config and the protocol era applies here, and `Run one by hand`
  below is this path.

### In-process: build the server from the API

```ts
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
  createEchoTool,
} from "@modelcontextprotocol/inspector-test-server";

let server: TestServerHttp | null = null;

afterEach(async () => {
  // Stop it even when the assertion threw, or the port leaks into the next test.
  if (server) {
    try {
      await server.stop();
    } catch {
      // ignore
    }
    server = null;
  }
});

it("…", async () => {
  const started = createTestServerHttp({
    serverInfo: createTestServerInfo("excluded-tools-test", "1.0.0"),
    tools: [createEchoTool()],
    // `modern: {}` opts the fixture into the 2026-07-28 handler; omit it for legacy.
  });
  await started.start();
  server = started;

  // `started.url` is the bound URL — read it, never reconstruct it from a port.
  // …connect an InspectorClient to it and assert.
});
```

The reference test is
[`clients/web/src/test/integration/mcp/inspectorClient-excluded-tools.test.ts`](../../../clients/web/src/test/integration/mcp/inspectorClient-excluded-tools.test.ts)
— read it before writing a new one; it is the shape every fixture-backed
integration test in this repo follows.

Four mechanics of this path:

- **The factories come from one barrel.** `createTestServerHttp` /
  `createTestServerStdio` build the server; the `create*Tool`,
  `create*Resource` and `create*Prompt` fixtures in
  `test-servers/src/test-server-fixtures.ts` populate it;
  `createTestServerInfo` fills in `serverInfo`. Prefer an existing fixture
  factory to hand-writing a `ToolDefinition` — that is what makes the fixture a
  shared one.
- **`start()` then `stop()`, and `stop()` in an `afterEach`.** The server binds a
  real port, so a test that throws before stopping leaks it into the rest of the
  file.
- **Read `started.url`.** `createTestServerHttp` resolves through
  `findAvailablePort()`, which walks upward when the port is taken, so an
  assumed port is the same bug the two-process path has.
- **Era is a constructor option, not a config file.** `modern: {}` on the config
  object selects the modern handler; the client side picks its own negotiation
  (`eraToVersionNegotiation`). The showcase-config era table below does not
  apply.

⚠️ **The barrel is an alias to the BUILD, not to the source** —
`vitest.shared.mts` maps `@modelcontextprotocol/inspector-test-server` to
`test-servers/build/index.js`. So the `Build first` section applies to this path
in full, including the stale-build hazard: an edit to `test-servers/src` that is
not rebuilt is invisible to an in-process test exactly as it is to a spawned one.

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

## Run one by hand (two processes)

This is the **manual-check** path from the section above; an automated test
builds the server in-process instead. Two processes: the test server, then the
Inspector.

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
| A token endpoint the SDK refuses  | `oauth-insecure-token-endpoint-http.json` (legacy) |
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
