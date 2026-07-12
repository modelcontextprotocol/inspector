# MCP Inspector Web Client

The browser incarnation of the Inspector: a **Vite + React + [Mantine](https://mantine.dev)** single-page app backed by a small **Node (Hono)** server. The SPA is presentational — it renders data and fires callbacks; all MCP state comes from the shared `@inspector/core` hooks. The backend proxies MCP connections, serves the built SPA, and exposes `/api/*`.

This README covers what's specific to the web client. For the repo-wide picture (the `@inspector/core` shared package, the "dumb components" philosophy, the top-level `validate`/`coverage`/`ci` scripts, and publishing), see the [root README](../../README.md).

## Two halves: `src/` (browser) and `server/` (Node)

| Path | Runs in | Purpose |
| --- | --- | --- |
| `src/` | browser | The React SPA — components, hooks, theme, entry (`main.tsx`). |
| `server/` | Node | The dev/prod backend wiring (never imported by the browser). |

The `server/` directory holds the Node-only backend:

- **`vite-hono-plugin.ts`** — mounts the Hono `/api/*` middleware onto the Vite dev server (so `npm run dev` has a live backend).
- **`server.ts`** — the standalone Hono production server (serves `dist/` + `/api/*`).
- **`run-web.ts`** / **`start-vite-dev-server.ts`** — entry points the launcher calls for prod `--web` and `--web --dev`.
- **`web-server-config.ts`** — env parsing, the `GET /api/config` payload, the startup banner.
- **`inject-auth-token.ts`** — embeds the API token into the served `index.html` (see [Auth token](#auth-token)).
- **`sandbox-controller.ts`** — the MCP Apps sandbox HTTP server; **`ensure-web-build.ts`** — builds `dist/` on demand for prod `--web`; **`vite-base-config.ts`** — shared `optimizeDeps` exclusions.

## Development

```bash
npm run dev        # Vite dev server + Hono /api middleware, HMR
```

For the launcher-driven prod/dev flows (`npm run web` / `web:dev`), see the root README — those run the built launcher.

## Build

```bash
npm run build      # tsc -b  →  vite build  →  build:runner
```

Two artifacts come out, both of which ship in the published package:

- **`dist/`** — the browser SPA (`vite build`). Served statically by the prod backend.
- **`build/`** — the Node prod-server runner (`build:runner` = `tsup --config tsup.runner.config.ts`), which bundles `server/` + `@inspector/core` into one ESM file and externalizes npm deps.

`build:client` runs only the `vite build` half when you just need fresh `dist/`.

## Component layers

Components live under `src/components/` in four layers, smallest to largest:

| Layer | Count | What it is |
| --- | --- | --- |
| `elements/` | ~31 | Leaf presentational pieces (badges, buttons, toggles) over Mantine primitives. |
| `groups/` | ~63 | Composite pieces (cards, panels, modals, control bars). |
| `screens/` | ~11 | Full tab screens (Tools, Resources, Servers, monitoring screens…). |
| `views/` | 1 | `InspectorView` — the top-level layout that composes the screens. |

Every screen and element has a `*.stories.tsx` (see [Storybook](#storybook)). Styling follows the Mantine-first rules in [`AGENTS.md`](../../AGENTS.md) — theme variants and component props over CSS, `--inspector-*` tokens over raw colors.

## MCP Apps screen automation contract

The Apps screen exposes a small, stable set of `data-testid` / `data-*` attributes so an automated driver (deep-link auto-open, CI review harness) can `waitForSelector` on a deterministic signal instead of sleeping. Treat these as a public contract — drivers depend on them staying stable:

| Attribute | Where | Meaning |
| --- | --- | --- |
| `data-testid="apps-form"` | Apps content card | The container that carries the status/error attributes below. |
| `data-app-status` | on `apps-form` | Renderer lifecycle: `idle` (nothing running) → `loading` (bridge building / `ui/initialize` in flight) → `ready` (view fired `notifications/initialized`) → `error` (bridge factory threw/rejected). Poll for `ready`. |
| `data-app-error` | on `apps-form` | The failure reason string when `data-app-status="error"` (e.g. no connected client); absent otherwise. |
| `data-testid="apps-error"` | error panel | Rendered below the frame when the app fails to load (factory throw/reject); shows the reason so the failure isn't a silent blank frame. |
| `data-testid="open-app"` | Open App button | Launches the selected app. |
| `data-testid="apps-stage"` | Stage-partial button | Snapshots the current form values for progressive-render testing. |
| `data-testid="apps-messages"` | messages panel | `ui/message` submissions from the running view. |
| `data-testid="apps-logs"` | app-logs panel | `notifications/message` log entries (default-expanded). |

The renderer lifecycle itself is `AppRendererStatus` (`loading` | `ready` | `error`) reported via `AppRenderer`'s `onAppStatusChange`; the screen maps it to `data-app-status`. Resource-read failures (malformed/404 UI resource) are surfaced as a toast via the bridge factory's `onResourceError`; because the app never reaches `ready` in that case, a driver times out on `data-app-status` and reads the toast.

## Deep-link auto-connect

A driver (launcher, CLI `--print-handoff`, CI review harness) can reach a **connected** inspector with a single navigate by encoding the target in the URL query string. Parsing + security gating live in `src/utils/deepLink.ts` (`parseDeepLink`), and a returned `DeepLink` is proof the link passed validation.

```
http://127.0.0.1:6274/?serverUrl=<url>&transport=http|sse&autoConnect=<token>
```

| Param | Meaning |
| --- | --- |
| `serverUrl` | The MCP server URL. Restricted to `http:` / `https:` (a crafted `javascript:` / `data:` / `file:` value is rejected). Canonicalized via `URL.href` so it matches the OAuth store's key form. |
| `transport` | `http` (streamable-HTTP, the default) or `sse`. Unknown values fall back to `http`. |
| `autoConnect` | **CSRF gate.** Must equal the per-launch `MCP_INSPECTOR_API_TOKEN`. The token is random per launch and only known to whatever started the server, so a third-party-minted link cannot satisfy it — this is the same exposure surface as the existing `?MCP_INSPECTOR_API_TOKEN=` param. Without a match the link is ignored. |

The deep link upserts a stable `deep-link` catalog row (so a reload reconnects to the same row instead of accumulating duplicates) and connects. Connection-level outcomes are surfaced on the `AppShell.Header` as a machine-readable contract, so a driver can `waitForSelector` and read the failure reason without scraping a transient toast:

| Attribute | Where | Meaning |
| --- | --- | --- |
| `data-testid="connection-status"` | header | The element carrying the attributes below. |
| `data-status` | on `connection-status` | The live `ConnectionStatus` (`disconnected` → `connecting` → `connected` / `error`). Poll for `connected`. |
| `data-error-message` | on `connection-status` | Why the last connect failed (handshake error, OAuth-start failure, deep-link automation failure); absent when there is no error. |
| `data-deeplink` | on `connection-status` | `parsed` (a valid deep link drove this load), `rejected` (deep-link params present but the token/serverUrl gate failed), or `none`. Lets a driver distinguish "no deep link" from "rejected" — both otherwise leave `data-status` idle. |

The `openApp` / `appArgs` / `autoOpen` params extend this to land on a rendered MCP App; see the [MCP Apps screen automation contract](#mcp-apps-screen-automation-contract) above for the app-side `data-*` signals.

## Theme (`src/theme/`)

Each customized Mantine component has a `Theme<Name>.ts` file (`Button.ts`, `Text.ts`, …, ~21 total) exporting a `Theme<Name>` constant; the barrel `index.ts` re-exports them and `theme.ts` assembles the `MantineProvider` theme. Theme files hold app-wide defaults and **variants** (flat CSS-in-JS); only pseudo-selectors, nested child selectors, keyframes, and native-HTML styling belong in `App.css`. Element components import from `@mantine/core` (never from `theme/`) — the theme layer is applied transparently by the provider.

## Testing

Tests run under three Vitest **projects** (configured in `vite.config.ts`), each in the right environment:

| Project | Env | Scope | Script |
| --- | --- | --- | --- |
| `unit` | happy-dom | Components, hooks, utils (`*.test.tsx` beside the source) | `npm test` |
| `integration` | node | `@inspector/core` + transports + auth, spawning the real stdio test server (`src/test/integration/**`) | `npm run test:integration` |
| `storybook` | real Chromium | Story **play functions** as interaction tests | `npm run test:storybook` |

- `npm test` runs the fast **unit** project (happy-dom). `test:watch` for the loop.
- **Integration** tests run in a real Node env (no happy-dom, 30s timeouts) and spawn `test-servers/build/test-server-stdio.js` as a subprocess, so `pretest`/the coverage script build the test servers first (`test-servers:build`).
- **`npm run test:coverage`** runs unit **and** integration under v8 instrumentation and enforces the **per-file ≥90%** gate (lines/statements/functions/branches) — the same gate CI runs. Genuinely-unreachable branches are annotated with a justified `/* v8 ignore … */`, not waved through.

Integration tests live under `src/test/integration/` mirroring the `core/` layout; anything placed there is picked up by the `integration` project automatically. Render components with `renderWithMantine` (`src/test/renderWithMantine.tsx`) so they get the project theme.

## Storybook

```bash
npm run storybook        # dev server on :6006
npm run build:storybook  # static build
npm run test:storybook   # run every story's play function in headless Chromium
```

Storybook is first-class here because the components are presentational — each renders against fixture props. **Play functions double as interaction tests** and run headless in real Chromium via `@vitest/browser-playwright` + `@storybook/addon-vitest` (the `storybook` Vitest project). They're part of `npm run ci` (which installs the Chromium binary first) but kept out of the fast `validate` loop since they need the browser.

## Auth token

The dev/prod backend guards every `/api/*` route with `x-mcp-remote-auth: Bearer <MCP_INSPECTOR_API_TOKEN>`. The browser recovers the token, in priority order (see `App.tsx` `getAuthToken()`): the `window.__INSPECTOR_API_TOKEN__` global injected into `index.html` on every page load (`server/inject-auth-token.ts`), then a `?MCP_INSPECTOR_API_TOKEN=…` query param, then `sessionStorage`. Injection is a no-op when auth is disabled (`DANGEROUSLY_OMIT_AUTH`). See the root [AGENTS.md](../../AGENTS.md) for the full rationale.

## HTTP proxy support

The web backend connects to remote MCP servers through the shared Node transport (`core/mcp/node/transport.ts`), which honors the conventional proxy environment variables: `HTTPS_PROXY` / `HTTP_PROXY` (and their lowercase forms) select the proxy, and `NO_PROXY` exempts hosts. Routing is powered by [`undici`](https://www.npmjs.com/package/undici)'s `EnvHttpProxyAgent`, imported lazily only when a proxy variable is set, so runs without a proxy configured pay no cost. See the CLI README for more detail.
