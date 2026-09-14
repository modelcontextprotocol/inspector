---
name: project-structure
description: Where things live in the Inspector repo — which client owns which surface, what is in core/ versus clients/web, and what each top-level directory is for. Use when locating code, deciding where a new module belongs, or answering which package owns or contains a given area of the codebase.
user-invocable: false
disable-model-invocation: false
---

# Project structure

The Inspector is one npm package, `@modelcontextprotocol/inspector`, with three
clients (Web, TUI, CLI) over a shared `core/`. It is **not** an npm workspace —
each client under `clients/*` keeps its own `package.json` and `node_modules`
(see `/local-dev`).

```
inspector/
├── clients/
│   ├── web/          Vite + React + Mantine SPA with a Node backend
│   │   ├── src/         Browser app: components, hooks, lib/, utils/, theme/
│   │   ├── server/      Node-only dev/prod backend wiring (see below)
│   │   └── static/      sandbox_proxy.html — served for the MCP Apps tab
│   ├── cli/          Scriptable CLI (tsup bundle, @inspector/core alias)
│   ├── tui/          Ink + React terminal UI (tsup bundle)
│   └── launcher/     The `mcp-inspector` bin; dispatches to web/cli/tui in-process
├── core/             Shared code, consumed via the `@inspector/core` alias (no package.json)
├── test-servers/     Composable MCP test servers + JSON configs used by tests and by hand
├── scripts/          Root build/verify tooling: install cascade, smokes, the verify:* guards
├── docs/             Task-oriented guides (see docs/README-style index in the root README)
├── specification/    Design/build specifications
└── AGENTS.md         The rules contract — read this before changing anything
```

## `core/` — the shared runtime

Its entry point is the **`InspectorClient`** class, which owns the connection to
an MCP server, the request/response lifecycle, and a set of state stores.

| Directory | Owns |
| --- | --- |
| `core/mcp/` | `InspectorClient`, transports, state stores, config import, URI templates, task/subscription/App-elicitation protocol helpers |
| `core/mcp/node/` | Node stdio transport factory; `proxyFetch.ts` (the shared HTTPS_PROXY/NO_PROXY fetch) |
| `core/mcp/remote/` | Browser HTTP/SSE transport + remote logger/fetch, and (under `node/`) the Hono backend it talks to |
| `core/mcp/state/` | The stores `core/react/` hooks read |
| `core/auth/` | OAuth end to end — providers, discovery, storage, endpoint overrides, scopes, revocation, mid-session recovery — split into isomorphic logic plus `browser/`, `node/` and `remote/` backends |
| `core/auth/node/` | Node OAuth storage + loopback callback server, **and** the `SecretStore` backends (keychain / file / memory) and their selection policy |
| `core/client/` | Install-level client config (`client.json`): browser-safe parse plus Node load/save, remote backend, secrets, runner |
| `core/json/` | JSON + parameter/argument conversion; the schema normalizations all three form builders share (nullable unions, root composition) and the tool-schema portability lint |
| `core/react/` | React hooks over the state stores — consumed by both the web and TUI React trees. Every subscription reads its snapshot **during render** via `useSyncExternalStore` (#1955); `useStoreSnapshot.ts` caches the fresh-value-per-read getters |
| `core/node/` | Node-only helpers: version reader, host normalization/detection |
| `core/storage/` | File I/O helpers used by the OAuth persist backends |
| `core/logging/` | Silent pino logger singleton |

`core/` is isomorphic (browser + Node) and has **no `package.json`** — it is not
published on its own. Its tests live in `clients/web/src/test/core/`, and its
browser-consumed runtime is inside the web coverage gate.

## `clients/web/server/` — the Node backend

| File | Role |
| --- | --- |
| `vite-hono-plugin.ts` | Hono middleware on the Vite dev server |
| `server.ts` | Standalone Hono prod server |
| `start-vite-dev-server.ts` | In-process Vite starter for the launcher |
| `web-server-config.ts` | Env parsing, initial-config payload, startup banner |
| `sandbox-controller.ts` | The MCP Apps sandbox HTTP server |
| `app-origin-controller.ts` | The dedicated app origin for `_meta.ui.domain` |
| `inject-auth-token.ts` | Embeds the API token into served `index.html` |
| `resolve-bind-host.ts` | Bind-host policy (defaults to `127.0.0.1`; refuses a wildcard bind without the opt-in) |
| `browser-externalized-builtin-gate.ts` | Fails `vite build` on a browser-externalized Node built-in |
| `ensure-web-build.ts` | Builds `clients/web/dist` on demand for prod `--web` |

Each of these files carries a header comment explaining the *why*; read the
source rather than looking for a second copy of it here.

## Web source layout: `src/lib` vs `src/utils`

**`utils` = functions that compute; `lib` = things that instantiate, adapt, or
touch the environment.** If it does I/O or wraps a subsystem it's `lib`; if it's
a pure transform it's `utils`. Cross-directory imports point **one way,
`lib → utils`**.

The full rule, its carve-outs (domain types, diagnostic logging, type-only core
imports), and the coverage-whitelist hazard are in
[`AGENTS.md`](../../../AGENTS.md).

## Web components

Presentational ("dumb") components: they take data and callbacks as props and
contain only display logic. State comes from the `@inspector/core` hooks, wired
in near the top of the tree. Element components live in
`clients/web/src/components/elements/`, theme variants in
`clients/web/src/theme/`, each Mantine component's variants in its own file.

## Where to put a new file

| It is… | It goes in |
| --- | --- |
| Logic two or more clients need | `core/<area>/` |
| Browser-only React or DOM code | `clients/web/src/` |
| A pure transform used by web | `clients/web/src/utils/` |
| A stateful adapter / subsystem wrapper used by web | `clients/web/src/lib/` |
| Node-only web backend wiring | `clients/web/server/` |
| A build/verify script | `scripts/` (with a sibling `*.test.mjs` if it has pure logic) |
| A test fixture MCP server | `test-servers/src/` + a config in `test-servers/configs/` |

Test placement is a separate question with its own rules — see `/testing`.
