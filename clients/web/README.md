# MCP Inspector Web Client

The browser incarnation of the Inspector: a **Vite + React + [Mantine](https://mantine.dev)** single-page app backed by a small **Node (Hono)** server. The SPA is presentational — it renders data and fires callbacks; all MCP state comes from the shared `@inspector/core` hooks. The backend proxies MCP connections, serves the built SPA, and exposes `/api/*`.

This README covers what's specific to the web client. For the repo-wide picture (the `@inspector/core` shared package, the "dumb components" philosophy, the top-level `validate`/`coverage`/`local:gate` scripts, and publishing), see the [root README](../../README.md).

## Two halves: `src/` (browser) and `server/` (Node)

| Path      | Runs in | Purpose                                                       |
| --------- | ------- | ------------------------------------------------------------- |
| `src/`    | browser | The React SPA — components, hooks, theme, entry (`main.tsx`). |
| `server/` | Node    | The dev/prod backend wiring (never imported by the browser).  |

The `server/` directory holds the Node-only backend:

- **`vite-hono-plugin.ts`** — mounts the Hono `/api/*` middleware onto the Vite dev server (so `npm run dev` has a live backend).
- **`server.ts`** — the standalone Hono production server (serves `dist/` + `/api/*`).
- **`run-web.ts`** / **`start-vite-dev-server.ts`** — entry points the launcher calls for prod `--web` and `--web --dev`.
- **`web-server-config.ts`** — env parsing, the `GET /api/config` payload, the startup banner, the default origin allow-list.
- **`resolve-bind-host.ts`** — the shared bind-host guard (refuses an all-interfaces `HOST` unless `DANGEROUSLY_BIND_ALL_INTERFACES`), used by both bind points (`web-server-config.ts` + `vite.config.ts`); see [Host binding & the origin allow-list](#host-binding--the-origin-allow-list).
- **`inject-auth-token.ts`** — embeds the API token into the served `index.html` (see [Auth token](#auth-token)).
- **`sandbox-controller.ts`** — the MCP Apps sandbox HTTP server; **`app-origin-controller.ts`** — the dedicated app-origin server for `_meta.ui.domain` (see [MCP App dedicated origins](#mcp-app-dedicated-origins-metauidomain)); **`ensure-web-build.ts`** — builds `dist/` on demand for prod `--web`; **`vite-base-config.ts`** — shared `optimizeDeps` exclusions.
- **`browser-externalized-builtin-gate.ts`** — Vite-agnostic build-gate logic that fails `vite build` when a Node built-in reaches the browser bundle (#1769); the thin Vite plugin wiring lives in `vite.config.ts`. It sits under `server/` (rather than `src/`) as the home for Node-only, build-time tooling — it's imported by the Vite config, never by the browser — alongside the other `vite-*` config helpers here.

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

| Layer       | Count | What it is                                                                     |
| ----------- | ----- | ------------------------------------------------------------------------------ |
| `elements/` | ~48   | Leaf presentational pieces (badges, buttons, toggles) over Mantine primitives. |
| `groups/`   | ~64   | Composite pieces (cards, panels, modals, control bars).                        |
| `screens/`  | ~11   | Full tab screens (Tools, Resources, Servers, monitoring screens…).             |
| `views/`    | 1     | `InspectorView` — the top-level layout that composes the screens.              |

Every screen and element has a `*.stories.tsx` (see [Storybook](#storybook)). Styling follows the Mantine-first rules in [`AGENTS.md`](../../AGENTS.md) — theme variants and component props over CSS, `--inspector-*` tokens over raw colors.

## Tool-schema portability (`#1005`)

The Tools tab flags tools whose advertised `inputSchema` / `outputSchema`
carries a construct that is legal JSON Schema and is refused or mishandled by
real MCP clients — the reported case being Go's `jsonschema` package emitting a
bare `true` for an `interface{}` field, which Claude Code rejects with an
opaque `"Invalid input"`.

Two surfaces, one verdict: the sidebar row (`ToolListItem`) carries a
hover-labelled icon — red when something is refused outright, yellow when it is
merely handled unevenly — and selecting the tool renders a **Schema
portability** section (`SchemaFindingsList`) above the argument form, one block
per finding with its path, the problem, and a concrete fix.

Both read [`core/json/schemaLint.ts`](../../core/json/schemaLint.ts), which is
also what backs the TUI's detail pane and the CLI's `--strict` report — so the
three clients cannot disagree about whether a schema is portable. That module's
header explains why it is a portability lint rather than a JSON Schema
validator. `test-servers/configs/unportable-schemas-http.json` is a server that
exercises every rule.

## Non-component code: `src/lib` vs `src/utils`

Two grab-bag directories, split by one rule: **`utils` = functions that compute; `lib` = things that instantiate, adapt, or touch the environment.** If it does I/O or wraps a subsystem, it's `lib`; if it's a pure transform, it's `utils`.

- **`src/utils/`** — pure, side-effect-free functions (no DOM/`window`/`sessionStorage` I/O, no subsystem ownership), trivially unit-testable with no mocks. Examples: `jsonUtils`, `schemaUtils`, `toolUtils`, `maskSecrets`, `inspectorTabs`, `deepLink`, `mcpNetworkHeaders`, `errorFormat`, `stepUp`, and the toast ids/formatters under `utils/toasts/`. Carve-outs that stay `utils`:
  - _Diagnostic logging_ (`console.warn`/`console.error`) doesn't count as a side effect.
  - _Importing from `@inspector/core`_ — neither a type-only import nor re-exporting core's pure functions/constants is a subsystem dependency (what makes a module `lib` is wrapping core's stateful runtime).
  - _Pure domain types + their constructors_ (`customHeaders`) — there is no `types/` sub-bucket inside `lib`/`utils`.
- **`src/lib/`** — infrastructure / stateful adapters: modules that compose subsystems, wrap the `@inspector/core` **runtime**, or produce side effects. Examples: `environmentFactory`, `remoteOAuthStorage`, `oauthResume` (sessionStorage), `browserTabVisibility` (DOM listeners), `clearServerOAuthState`, `downloadFile`, `authToken` (`window.location` + `sessionStorage`), `protocolReplay` (re-issues through the live client).

The top-level `src/types/` is a separate sibling — ambient `.d.ts` module stubs, not the place for new domain types (the one that lingers there, dead `navigation.ts`, is tracked for removal in [#1785](https://github.com/modelcontextprotocol/inspector/issues/1785)).

Nothing _enforces_ the boundary — no path alias keys off it, and the coverage `include` in `vite.config.ts` lists both directories, so a move between them is coverage-neutral. It's a human-legible import-time signal. See [`AGENTS.md`](../../AGENTS.md) for the full rule (including the whitelist caveat — a module placed outside `components`/`lib`/`utils`/`server` falls out of the ≥90 gate).

## Core tab automation contract

The Tools, Resources, Prompts and Skills screens each expose a `data-testid` plus a
small set of `data-*` attributes, so a headless driver can `waitForSelector` on
a deterministic signal rather than on visible copy. `scripts/smoke-web-tabs.mjs`
drives all three against `test-servers/configs/web-tabs-http.json` ([#2148](https://github.com/modelcontextprotocol/inspector/issues/2148)).
Treat them as a public contract, for the same reason as the Apps ones below:

| Attribute                            | Where              | Meaning                                                                                                                                                     |
| ------------------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-testid="tools-screen"`         | Tools screen root  | The element carrying the two attributes below.                                                                                                              |
| `data-tool-count`                    | on `tools-screen`  | How many tools the list holds. `0` is a *populated screen with an empty list* — distinct from the screen being absent, which is what a driver waits out.     |
| `data-call-status`                   | on `tools-screen`  | `idle` → `pending` → `ok` / `error` for the current `tools/call`. Always a value; an absent call state reads `idle`, never empty.                            |
| `data-testid="structured-output"`    | result panel       | The `structuredContent` section of a tool result ([#1908](https://github.com/modelcontextprotocol/inspector/issues/1908)). Absent when a result carries none. |
| `data-testid="resources-screen"`     | Resources root     | The element carrying the three attributes below.                                                                                                            |
| `data-resource-count`                | on `resources-screen` | Entries from `resources/list`.                                                                                                                           |
| `data-template-count`                | on `resources-screen` | Entries from `resources/templates/list` — a **separate** call that can fail on its own, so it is reported separately.                                     |
| `data-read-status`                   | on `resources-screen` | `idle` → `pending` → `ok` / `error` for the current `resources/read`.                                                                                     |
| `data-testid="resource-preview"`     | preview panel      | The read resource's **rendered** contents. Assert this *and* `data-read-status`: the status flips as soon as the RPC resolves, so it alone stays true with the panel removed. |
| `data-testid="prompts-screen"`       | Prompts root       | The element carrying the two attributes below.                                                                                                              |
| `data-prompt-count`                  | on `prompts-screen`| Entries from `prompts/list`.                                                                                                                                |
| `data-get-status`                    | on `prompts-screen`| `idle` → `pending` → `ok` / `error` for the current `prompts/get`.                                                                                          |
| `data-testid="prompt-messages"`      | messages panel     | The fetched prompt's **rendered** messages — the `prompts/get` counterpart of `resource-preview`, and asserted alongside `data-get-status` for the same reason. |
| `data-testid="skills-screen"`        | Skills root        | The element carrying the two attributes below ([#2234](https://github.com/modelcontextprotocol/inspector/issues/2234)). Not driven by `smoke-web-tabs.mjs` yet — the attributes exist so it can be, and so a rename fails in the screen's unit test rather than later. |
| `data-skill-count`                   | on `skills-screen` | Entries accumulated from `skills/list`.                                                                                                                     |
| `data-skill-page-count`              | on `skills-screen` | Pages the last `skills/list` walk took — a **separate** fact from the count, and the one that shows pagination actually happened.                            |
| `data-testid="skill-manifest"`       | detail pane        | The selected skill's resource manifest. Absent for a `resources: "dynamic"` skill, which has no manifest to render.                                          |

Why attributes rather than text: a smoke that waited on a label fails the next
time the label is reworded, which is noise rather than signal — and it fails as
an opaque timeout, because there is nothing to compare against. The screen tests
pin each attribute name for the same reason: a rename should fail loudly in a
unit test, not silently in a five-minute gate.

## MCP Apps screen automation contract

The Apps screen exposes a small, stable set of `data-testid` / `data-*` attributes so an automated driver (deep-link auto-open, CI review harness) can `waitForSelector` on a deterministic signal instead of sleeping. Treat these as a public contract — drivers depend on them staying stable:

| Attribute                     | Where                | Meaning                                                                                                                                                                                                                |
| ----------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-testid="apps-form"`     | Apps content card    | The container that carries the status/error attributes below.                                                                                                                                                          |
| `data-app-status`             | on `apps-form`       | Renderer lifecycle: `idle` (nothing running) → `loading` (bridge building / `ui/initialize` in flight) → `ready` (view fired `notifications/initialized`) → `error` (bridge factory threw/rejected). Poll for `ready`. |
| `data-app-error`              | on `apps-form`       | The failure reason string when `data-app-status="error"` (e.g. no connected client); absent otherwise.                                                                                                                 |
| `data-testid="apps-error"`    | error panel          | Rendered below the frame when the app fails to load (factory throw/reject); shows the reason so the failure isn't a silent blank frame.                                                                                |
| `data-testid="open-app"`      | Open App button      | Launches the selected app.                                                                                                                                                                                             |
| `data-testid="apps-stage"`    | Stage-partial button | Snapshots the current form values for progressive-render testing.                                                                                                                                                      |
| `data-testid="apps-messages"` | messages panel       | `ui/message` submissions from the running view.                                                                                                                                                                        |
| `data-testid="apps-logs"`     | app-logs panel       | `notifications/message` log entries (default-expanded).                                                                                                                                                                |

App-rendered **elicitations** (#1854) render through the same `AppRenderer` but outside the Apps screen — one modal per request, from `AppElicitationHost` — and carry their own pair:

| Attribute                       | Where                 | Meaning                                                                                                                                                                                          |
| ------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `data-testid="app-elicitation"` | the elicitation modal | One per in-flight app-rendered elicitation. **Absent** means the request was answered by the native elicitation form instead, which is what a driver asserts to prove the negotiation gate held. |
| `data-app-elicitation-status`   | on `app-elicitation`  | The same `AppRendererStatus` for that modal's app. `ready` is when the host forwards the `elicitation/create` through its bridge.                                                                |

`scripts/smoke-web-elicitation.mjs` drives both halves against the public fixture (`test-servers/configs/app-elicitation-http.json` and its `-native-` sibling).

The renderer lifecycle itself is `AppRendererStatus` (`loading` | `ready` | `error`) reported via `AppRenderer`'s `onAppStatusChange`; the screen maps it to `data-app-status`. Resource-read failures (malformed/404 UI resource) are surfaced as a toast via the bridge factory's `onResourceError`; because the app never reaches `ready` in that case, a driver times out on `data-app-status` and reads the toast.

## Deep-link auto-connect

A driver (launcher, CLI `--print-handoff`, CI review harness) can reach a **connected** inspector with a single navigate by encoding the target in the URL query string. Parsing + security gating live in `src/utils/deepLink.ts` (`parseDeepLink`), and a returned `DeepLink` is proof the link passed validation.

```
http://127.0.0.1:6274/?serverUrl=<url>&transport=http|sse&autoConnect=<token>
```

| Param         | Meaning                                                                                                                                                                                                                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serverUrl`   | The MCP server URL. Restricted to `http:` / `https:` (a crafted `javascript:` / `data:` / `file:` value is rejected). Canonicalized via `URL.href` so it matches the OAuth store's key form.                                                                                                                                 |
| `transport`   | `http` (streamable-HTTP, the default) or `sse`. Unknown values fall back to `http`.                                                                                                                                                                                                                                          |
| `autoConnect` | **CSRF gate.** Must equal the per-launch `MCP_INSPECTOR_API_TOKEN`. The token is random per launch and only known to whatever started the server, so a third-party-minted link cannot satisfy it — this is the same exposure surface as the existing `?MCP_INSPECTOR_API_TOKEN=` param. Without a match the link is ignored. |

The deep link upserts a stable `deep-link` catalog row (so a reload reconnects to the same row instead of accumulating duplicates) and connects. Connection-level outcomes are surfaced on the `AppShell.Header` as a machine-readable contract, so a driver can `waitForSelector` and read the failure reason without scraping a transient toast:

| Attribute                         | Where                  | Meaning                                                                                                                                                                                                                                 |
| --------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-testid="connection-status"` | header                 | The element carrying the attributes below.                                                                                                                                                                                              |
| `data-status`                     | on `connection-status` | The live `ConnectionStatus` (`disconnected` → `connecting` → `connected` / `error`). Poll for `connected`.                                                                                                                              |
| `data-error-message`              | on `connection-status` | Why the last connect failed (handshake error, OAuth-start failure, deep-link automation failure); absent when there is no error.                                                                                                        |
| `data-deeplink`                   | on `connection-status` | `parsed` (a valid deep link drove this load), `rejected` (deep-link params present but the token/serverUrl gate failed), or `none`. Lets a driver distinguish "no deep link" from "rejected" — both otherwise leave `data-status` idle. |

### Landing on a rendered app

Three further params extend the deep link to pre-select — and optionally auto-open — an MCP App, so a driver reaches a rendered widget with zero clicks:

```
…&openApp=<toolName>&appArgs=<base64url(JSON)>&autoOpen=<token>
```

| Param      | Meaning                                                                                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `openApp`  | The app-tool name. Once the connection is up and the tool appears in the app list, the inspector switches to the Apps tab and pre-selects it.                                                                                                                |
| `appArgs`  | `base64url(JSON)` object of form values. Merged **over** the tool's schema defaults (`collectSchemaDefaults`) so a required-with-default field isn't left blank — which would otherwise disable "Open App". Malformed / non-object values fall back to `{}`. |
| `autoOpen` | **Same CSRF gate as `autoConnect`** — must equal the session token. When set, "Open App" fires automatically (a tool call from a URL), so the token gate is mandatory. Without a match the app is pre-selected but not opened.                               |

The app-side render lifecycle is observable through the [MCP Apps screen automation contract](#mcp-apps-screen-automation-contract) above (`data-app-status="ready"`), so a driver can `waitForSelector` the whole `connect → open → ready` chain deterministically.

## MCP App dedicated origins (`_meta.ui.domain`)

By default an MCP App is rendered by handing its HTML to the sandbox proxy as
`srcdoc`, inside an iframe sandboxed **without** `allow-same-origin`. That is
the isolation model from #1565 and it stays the default — but it gives the app
document an *opaque* origin, so every request it makes carries `Origin: null`.
An app whose backend allowlists origins (CORS, an OAuth callback, an API-key
allowlist) can't work that way, which is what the spec's `_meta.ui.domain`
exists to solve: a server uses it to ask its host for a stable, dedicated
origin.

**The Inspector's host-specific contract.** The spec makes `domain`'s format
host-dependent ("servers MUST consult host-specific documentation"), and the
Inspector owns no domain infrastructure — it cannot serve
`my-app.example.com`. So it treats the field as a **request, not an address**:

- Any **non-empty** `domain` string opts the resource in. The value itself is
  not parsed, matched, or reserved — declare whatever your production host
  expects.
- The Inspector answers with a real HTTP origin on loopback:
  `http://<host>:<MCP_APP_ORIGIN_PORT>`, default **`6278`** — in the same
  `627x` family as the web port `6274` and the sandbox port `6275`, so the
  three forward together. It is **not** `6276`: that is the fixed loopback
  OAuth callback the CLI and TUI listen on, which OAuth apps pre-register and
  which therefore cannot move. `6277` is skipped as v1's retired proxy port.
- The app document is served from there under an unguessable path, its
  per-app CSP delivered as a real response **header** (stronger than the
  `<meta>` the `srcdoc` path relies on) plus a `frame-ancestors` that admits
  only the two origins in its real ancestor chain — the sandbox proxy that
  frames it, **and** the Inspector page that frames the proxy. Both are
  required, not belt-and-braces: `frame-ancestors` is checked against every
  ancestor, so omitting the Inspector's own origin blocks the frame outright
  (see `appDocumentEmbedders`).
- The inner iframe is granted `allow-same-origin` on this path **only** —
  that is what makes the origin real rather than opaque. It is not a
  weakening of #1565: the listener is on its own port, so the app is
  cross-origin to both the sandbox proxy and the Inspector, and same-origin
  policy blocks the reach either way. The proxy refuses the grant outright if
  the URL's origin equals its own, and the grant is never reachable from the
  server-supplied `sandbox` string, which is still stripped.

**It is one shared origin, not one per app.** Every domain-declaring app is
served from the same port, keyed by path. That delivers the property the field
is *for* — a real, allowlistable origin — without minting a port or a DNS name
per app, at the cost of not being a per-app isolation boundary: two such apps
share `localStorage`, `sessionStorage`, and cookies for that origin.

**And the separate port does not isolate cookies from the rest of loopback.**
A distinct port makes a distinct *origin*, so the origin-scoped surfaces —
DOM/scripting access, `localStorage`, `sessionStorage`, IndexedDB — are isolated
from the sandbox proxy and from the Inspector page. **Cookies are not
origin-scoped**: they are keyed by host and path, ignoring port. An app served
here therefore shares the `127.0.0.1` cookie jar with the Inspector on `6274`
and with anything else on loopback — it can read any non-`HttpOnly` cookie set
for that host, and set `Path=/` cookies those services will receive.

This is not a hole in the Inspector's own auth: the API token travels in the
`x-mcp-remote-auth` header and lives in a `window` global and `sessionStorage`,
neither of which another origin can read. Closing the cookie gap properly needs
a distinct *host*, which this listener cannot mint (the Inspector owns no DNS,
and a second loopback address is not portable) — so it is stated rather than
papered over. Don't run the Inspector beside a loopback service whose session
cookie you would not hand to an app under test.

**Every failure falls back rather than blanking the app.** No app-origin
listener, a port that never bound, an older backend with no
`POST /api/app-document` route, a network error — each renders the app the
default (opaque-origin) way and logs a console warning naming `_meta.ui.domain`.
Losing the real origin degrades what the app can reach; losing the app itself
would be worse.

**One failure is outside that guarantee, deliberately: a published document the
browser cannot reach.** Every case above is one the *host* observes — publishing
returned nothing, so it falls back before choosing a render path. If publishing
succeeds and the browser then cannot load the URL (the port is not forwarded, or
a collision moved the listener to a dynamic port that is not), the frame stays
blank instead. There is no honest signal to fall back on: the navigation is
cross-origin, so `onerror` never fires for an HTTP error, `onload` fires for the
error page too, and nothing about the document is readable. The alternatives are
a timeout — which races an app that is merely slow, and "recovers" it by
re-running it at an opaque origin, executing its side effects twice — or a
reachability probe on every render, which proves the port answers rather than
that this fetch will. So the cause is removed instead of guessed at: every
documented remote workflow forwards the port (see below, the Docker section of
the root README, and the SSH recipe in `docs/mcp-app-review.md`).

**Forward `6278` too** if you need this off loopback (a container, a tunnel).
As with the sandbox port, a taken port falls back to an OS-assigned one with a
loud warning — the app still renders, but the origin an app's backend was told
to allowlist is then wrong, which is what the warning tells you.

## Theme (`src/theme/`)

Each customized Mantine component has a `Theme<Name>.ts` file (`Button.ts`, `Text.ts`, …, ~21 total) exporting a `Theme<Name>` constant; the barrel `index.ts` re-exports them and `theme.ts` assembles the `MantineProvider` theme. Theme files hold app-wide defaults and **variants** (flat CSS-in-JS); only pseudo-selectors, nested child selectors, keyframes, and native-HTML styling belong in `App.css`. Element components import from `@mantine/core` (never from `theme/`) — the theme layer is applied transparently by the provider.

**`cssVariables.ts` is the third piece, beside the component files and `App.css`.** It holds overrides for the CSS variables `MantineProvider` injects at runtime, which `App.css` cannot reach: the provider appends its generated `<style>` after the stylesheet imports, so a `:root` rule there loses on source order at equal specificity. `cssVariablesResolver` is the supported seam. It is passed at **all three** `MantineProvider` sites — the app (`main.tsx`), the Storybook preview, and `renderWithMantine` — so the running app, the stories, and the tests cannot disagree about a token's value. It currently corrects `--mantine-color-error`, whose Mantine defaults fail WCAG AA in both schemes at the size input error text renders.

## JSON editing and display (`JsonEditor`)

Every surface in this client where JSON is **typed**, plus `ContentViewer`'s read-only JSON branch, renders one element: **`elements/JsonEditor`**, an **Ace** editor (`react-ace` + `ace-builds`, declared in this client because they render React). Ace brings code folding, line numbers, brace auto-closing, and per-line error annotation from its JSON worker — the last three are why hand-writing a nested payload in a bare textarea was the actual pain ([#2151](https://github.com/modelcontextprotocol/inspector/issues/2151)).

`JsonEditor` is deliberately **text in, text out**: it never parses. The editing contracts above it disagree about what an unparseable draft means, and neither can be expressed by a component that decides for them:

| Consumer | While the draft is invalid |
| --- | --- |
| `elements/JsonObjectInput` (Server Settings → Request Metadata) | Parent is **not** told; the last valid object stands. There is no Save button to gate — `onChange` writes straight through — so emitting `{}` would discard configured metadata on a stray keystroke ([#1910](https://github.com/modelcontextprotocol/inspector/issues/1910)). |
| `SchemaJsonField` (the object/array/union fallback in `groups/SchemaForm`) | Parent is told `undefined`, **and** invalidity is reported up through `onValidityChange` so Execute / Open App / Submit are disabled ([#2020](https://github.com/modelcontextprotocol/inspector/issues/2020)). |
| `SchemaForm`'s **Edit as JSON** switch | Same as above, for the whole arguments object — the v1 escape hatch, restored. Seeded from what the form holds, so a root-union switch's pruning ([#2123](https://github.com/modelcontextprotocol/inspector/issues/2123)) is not undone by a round trip. |
| `groups/EditReplayModal` (Protocol → Edit and replay) | Send is disabled. Unlike the metadata editor this modal *has* a commit gesture to gate. |
| `groups/ImportServerJsonPanel`, `groups/ExperimentalFeaturesPanel` | The panel owns the text and validates it itself. |
| `elements/ContentViewer`'s JSON branch | Read-only — see below. |

**A raw-JSON draft is refused when the client would retype it.** `callTool`
converts every *string-valued* argument to the type the tool's `inputSchema`
declares, because the widget form hands everything over as text — so `"2"`
against a numeric field has to become `2`. A JSON draft already carries its own
types, so a value that conversion would touch is one whose visible text is not
what the wire would carry, and showing one payload while sending another is the
one thing an inspector must not do. Both JSON-authoring surfaces therefore
refuse such a draft and name the value to rewrite
([#2171](https://github.com/modelcontextprotocol/inspector/issues/2171)):
**Edit as JSON** in the Tools and Apps tabs (which had been sending it, coerced
and silently), and **Edit and replay**, which already did.

One helper decides it for both — `coercedArgumentNames` in
[`core/json/jsonUtils.ts`](../../core/json/jsonUtils.ts), which runs the real
conversion and compares rather than restating its rules, so a surface cannot
drift from what would actually be sent. `coercedArgumentsError` is the sentence
they share, so the same refusal cannot be worded two ways.

The check is **opt-in** (`SchemaFormProps.enforceToolArgumentTypes`), not
inferred from the schema: an elicitation renders through the same `SchemaForm`
and its values are never converted, so enforcing there would refuse a draft for
a reason that is not true of it. Only the Tools and Apps panels pass it.

**Read-only mode is what `ContentViewer` renders JSON as**, and through it every payload that reaches the app that way: Protocol and Network entries, tool results, structured output, resource previews, server cards. Highlighting is *not* what that buys — JSON already highlighted, via the lazily-imported Prism grammar `CodeHighlight` loads. What Ace adds is **folding**, line numbers and a gutter on a large payload. The Prism `json` grammar was dropped in the same change rather than kept beside it: two highlighters for one language drift, and nothing else asks for `json`. Two cases stay on the plain renderer — a `wrap={false}` caller (the server card's fixed-height, single-line box) and untyped text that only *looks* like JSON but does not parse, which in an editor would frame a server's prose as a malformed document.

Two read-only JSON displays deliberately do **not** go through `ContentViewer`, and so are not on this editor — worth knowing before assuming it is the route for all of them. `ExperimentalFeaturesPanel` renders its JSON-RPC **response** in a read-only `Textarea` (its *request* box is on the editor), and `ConnectionInfoContent/OAuthTokenField` renders a decoded JWT in a `Code` block beside the raw token, where the decoded/raw toggle and the copy affordance belong to the field rather than to a viewer. Both are candidates for the same treatment; neither is in [#2151](https://github.com/modelcontextprotocol/inspector/issues/2151)'s scope.

Five integration details are load-bearing:

- **The worker is imported as `?url`** so Vite emits it as an asset. Without it Ace fetches `worker-json.js` from a path that does not exist in a bundled app and silently loses its annotations. It is registered at **module scope** — the registration is global to Ace and idempotent, so it must not move into a per-mount effect.
- **Ace fires two change events for a replace** (a remove, then an insert), so a select-all-and-retype passes through a momentarily *empty* document. `JsonEditor` coalesces the pair in a microtask and reports only the settled text; acting on the first event reports the empty document as the user's answer.
- **The gutter's colors are overridden in `App.css`**, keyed off Ace's cssClass (`ace-github` / `ace-github-dark` — _not_ the `theme-github_dark` module name). Ace's own themes are 1.89:1 and 4.13:1 there, both under AA, and folding needs the gutter so it cannot simply be hidden. The read-only caret is hidden the same way (`.json-editor-readonly`), since `readOnly` has no option that removes it.
- **The label and error are wired to Ace's hidden textarea by hand.** `Input.Wrapper` associates a _Mantine_ input through context; Ace renders its own DOM, so the id, `aria-invalid` and `aria-describedby` are set on the textarea in an effect.
- **`ariaLabel` is required.** Ace names its hidden textarea "Cursor at row N", which is a position readout rather than a name — and it only recomputes that label when the cursor moves, so the option has to be applied *and* recomputed in `onLoad` to reach the DOM before the user clicks in.

**Testing it is split by necessity.** Ace's input path does not work under happy-dom — `userEvent.type` reaches the textarea and produces no edit — so a keyboard test in the unit project passes while asserting nothing. Unit tests drive the editor instance through `src/test/aceEditor.ts` (`setAceText` / `getAceText`, plus the `*ByLabel` variants for a screen holding more than one editor); real keyboard behaviour lives in the Storybook play functions, which run in Chromium. The same split applies to *reading* a payload back: Ace virtualizes its lines, so a read-only editor's text is not fully in the DOM and assertions go through the editor rather than `getByText`.

## Testing

Tests run under three Vitest **projects** (configured in `vite.config.ts`), each in the right environment:

| Project       | Env           | Scope                                                                                                  | Script                     |
| ------------- | ------------- | ------------------------------------------------------------------------------------------------------ | -------------------------- |
| `unit`        | happy-dom     | Components, hooks, utils (`*.test.tsx` beside the source)                                              | `npm test`                 |
| `integration` | node          | `@inspector/core` + transports + auth, spawning the real stdio test server (`src/test/integration/**`) | `npm run test:integration` |
| `storybook`   | real Chromium | Story **play functions** as interaction tests                                                          | `npm run test:storybook`   |

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

Storybook is first-class here because the components are presentational — each renders against fixture props. **Play functions double as interaction tests** and run headless in real Chromium via `@vitest/browser-playwright` + `@storybook/addon-vitest` (the `storybook` Vitest project). GitHub CI runs them directly (`npm run test:storybook`); the local pre-push gate runs them through `npm run local:storybook`, which installs the Chromium binary first. Either way they are kept out of the fast `validate` loop, since they need the browser.

## Auth token

The dev/prod backend guards every `/api/*` route with `x-mcp-remote-auth: Bearer <MCP_INSPECTOR_API_TOKEN>`. The browser recovers the token, in priority order (see `App.tsx` `getAuthToken()`): the `window.__INSPECTOR_API_TOKEN__` global injected into `index.html` on every page load (`server/inject-auth-token.ts`), then a `?MCP_INSPECTOR_API_TOKEN=…` query param, then `sessionStorage`. Injection is a no-op when auth is disabled (`DANGEROUSLY_OMIT_AUTH`). See the root [AGENTS.md](../../AGENTS.md) for the full rationale.

## Host binding & the origin allow-list

Both the prod backend (`server/web-server-config.ts`) and the dev Vite server (`vite.config.ts`) resolve their bind host through one shared guard, `server/resolve-bind-host.ts`. It binds **`127.0.0.1`** by default and **refuses an all-interfaces host** (`0.0.0.0`, `::`, empty, or any equivalent spelling — `0`, `0x0`, `0.0`, `::0`, `::ffff:0.0.0.0`, … are all folded to the wildcard and refused) — which would expose the process-spawning backend to the whole network, the exposure DNS-rebinding attacks target — unless `DANGEROUSLY_BIND_ALL_INTERFACES=true` is set. The Docker image sets that flag (a container must bind `0.0.0.0` to be reachable through `-p`); a bare `HOST=0.0.0.0` anywhere else exits with an actionable error.

**The default is the IPv4 loopback _address_, deliberately not the name `localhost`** (#1951). `server.listen(port, host)` resolves a name through `dns.lookup` and binds the **single** address it gets back; since Node 17 the default result order is `verbatim`, so on a glibc Linux host — whose `/etc/hosts` maps `localhost` to both `127.0.0.1` and `::1` — that first address is `::1`. `HOST=localhost` there binds IPv6 loopback **only** and refuses every IPv4 client. On a desktop this is invisible (the browser resolves `localhost` the same way and lands on `::1` too); it breaks wherever the connection is made by something that pins `127.0.0.1` — a VS Code dev container's port forwarder, `ssh -L 6274:127.0.0.1:6274`, a container healthcheck. Binding the address takes the resolver out of the decision. Browsing to `http://localhost:PORT` still works, since browsers fall back across address families and the loopback allow-list covers all three forms. An explicit `HOST=localhost` is still honored as typed — the single-family bind is then your choice.

The backend's `/api/*` routes also enforce an **origin allow-list** (`allowedOrigins`) as DNS-rebinding protection. When left to default on a loopback host, it expands to all three interchangeable loopback origin forms for the port — `http://localhost:PORT`, `http://127.0.0.1:PORT`, and `http://[::1]:PORT` — because `localhost` resolves to either IPv4 or IPv6 loopback and Node/Vite may bind the IPv6 form, so the browser can legitimately arrive at `http://[::1]:PORT`. Set `ALLOWED_ORIGINS` (comma-separated) to override; entries are canonicalized (`new URL(o).origin`), so a trailing slash / uppercase host / explicit `:80` still match. **Each entry must include the scheme** — `http://localhost:6274`, not `localhost:6274` (a scheme-less value is dropped with a warning). `ALLOWED_ORIGINS` **replaces** the default list (it does not merge), so **list every origin you'll browse from, including the loopback forms** you still want (`http://localhost:PORT`, `http://127.0.0.1:PORT`, `http://[::1]:PORT`) — otherwise local access stops working. A blank `ALLOWED_ORIGINS` does **not** disable the check — it falls back to the default (fail closed); there is no env knob to turn origin validation off.

### Hosting on a network

The guard blocks only the **wildcard** all-interfaces addresses. Binding a **specific** IP or hostname is allowed with no opt-in — that's a single, deliberate exposure, unlike the wildcard which binds every interface at once (the pattern DNS-rebinding exploits). To serve the Inspector on a LAN or the internet:

- **Bind a specific address.** `HOST=192.168.1.50` (a LAN IP) or a public IP works directly: the default origin allow-list follows the bind host, so `allowedOrigins` becomes `http://<that-host>:PORT` and a browser hitting that address is accepted with no extra config. (The host is canonicalized the way a browser is — so `HOST=127.1` advertises `http://127.0.0.1:PORT`, an IPv6 bind host is bracketed as `http://[2001:db8::1]:PORT`, and the port is dropped when it's the http default `:80` — matching what the browser sends.)
- **Behind TLS or a reverse proxy**, the browser's `Origin` becomes the public origin (e.g. `https://inspector.example.com`, often without a port), which won't match the auto-derived `http://<bind-host>:PORT`. Set `ALLOWED_ORIGINS` to the real public origin(s): `ALLOWED_ORIGINS=https://inspector.example.com`.
- **Using the `0.0.0.0` wildcard** (opt-in via `DANGEROUSLY_BIND_ALL_INTERFACES=true`, as the Docker image does): a wildcard bind also serves loopback, so the default allow-list is the loopback trio plus the canonical wildcard origins (`http://0.0.0.0:PORT`, `http://[::]:PORT`), and **local access works out of the box** — `docker run -p 127.0.0.1:6274:6274` browsed at `http://localhost:6274` connects with no extra config. Reaching it at a **non-loopback** address (a LAN IP, a public hostname) still needs `ALLOWED_ORIGINS` — but since that **replaces** the default, keep the loopback forms in the list if you also browse locally: `ALLOWED_ORIGINS=http://localhost:PORT,http://127.0.0.1:PORT,http://192.168.1.50:PORT,https://inspector.example.com`.

The bind-host guard and the `ALLOWED_ORIGINS` allow-list apply to both the prod server and `--dev`. Note that in **`--dev`** the Vite dev server _additionally_ enforces its own `server.allowedHosts` Host-header check, whose default accepts loopback and IP-literal hosts. The host you **bind** is auto-allowed (Vite adds the resolved `server.host` — which this config sets from `HOST` — to the allow-list), so `HOST=<hostname>` works out of the box under `--dev` too. What needs an explicit `server.allowedHosts` entry is reaching the dev server at a **different** name than the one bound — e.g. a wildcard bind reached by hostname, or a reverse-proxy domain. For those, prefer the prod server (`mcp-inspector --web`) or add the host to `server.allowedHosts`.

**MCP Apps caveats.** The MCP Apps sandbox runs on a **separate** port — `MCP_SANDBOX_PORT`, defaulting to a fixed **`6275`** (#2008; it was OS-assigned before, which meant it changed every run and so could never be named in a `forwardPorts` / `-p` / tunnel config written ahead of time). For the Apps tab to work off loopback, that sandbox port must be independently reachable from the browser — expose/forward `6275` alongside `6274`, or set `MCP_SANDBOX_PORT` to pick another. If the port is already taken the sandbox falls back to an OS-assigned one and warns, so a second Inspector still gets a working Apps tab locally — but the forwarded port is then wrong, which is what the warning tells you. (Under a `0.0.0.0` wildcard bind the sandbox URL is advertised as `localhost`, which is reachable — a wildcard bind serves loopback — so only the port needs handling.) Also note the sandbox iframe is gated by a `frame-ancestors` CSP, and **a bracketed IPv6 literal is not a valid CSP host-source** — so MCP Apps requires browsing the app at a name or IPv4 (`localhost`, `127.0.0.1`, a hostname, a LAN IPv4), **not** a bare `http://[::1]:…` address. Finally, the sandbox URL is always `http://` — so **behind TLS** (an `https://` app page) the browser blocks the `http://…/sandbox` iframe as mixed content and MCP Apps can't render; the Apps tab needs a plain-`http` app origin today.

In every case, exposing the Inspector beyond loopback also means anyone who can reach it can drive its backend — keep authentication on (do **not** set `DANGEROUSLY_OMIT_AUTH`) and prefer a specific bind address over the wildcard.

## HTTP proxy support

The web backend connects to remote MCP servers through the shared Node fetch (`core/mcp/node/proxyFetch.ts`), which honors the conventional proxy environment variables: `HTTPS_PROXY` / `HTTP_PROXY` (and their lowercase forms) select the proxy, and `NO_PROXY` exempts hosts. Routing uses [`undici`](https://www.npmjs.com/package/undici)'s own `fetch` bound to its `EnvHttpProxyAgent`, imported lazily only when a proxy variable is set, so runs without a proxy configured pay no cost.

The proxy sits at the **bottom** of the fetch stack rather than wrapping the transport's fetch, and both undici halves must come from the same copy — see [HTTP proxy support](../cli/README.md#http-proxy-support) in the CLI README for why ([#2067](https://github.com/modelcontextprotocol/inspector/issues/2067)).
