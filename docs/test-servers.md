# Test servers

The catalogue below is the reference. For how to build and run one, use the `/test-servers` skill.

`test-servers/` provides **composable MCP servers** used by the integration and smoke suites, so tests exercise a real server over a real transport instead of mocks. A server is assembled from **presets** (fixture factories in `test-servers/src/preset-registry.ts` — tools, resources, prompts, tasks, elicitation, sampling, OAuth, …) and can be driven two ways:

- **In-process** — import the factories (`createTestServerHttp`, `createEchoTool`, …) and run the server inside the test's event loop (used by the HTTP integration paths).
- **As a subprocess** — `test-servers/build/test-server-stdio.js` is spawned as a real stdio child (used by the CLI smoke and stdio integration tests).

Configure a server declaratively with a JSON config (see `test-servers/configs/*.json`) selecting presets, then load it via `--config`. Because the servers are spawned as real subprocesses, the build output must exist first:

```bash
npm run test-servers:build   # (from clients/web) → tsc -p test-servers, emits test-servers/build/
```

The Vite alias `@modelcontextprotocol/inspector-test-server` (in `clients/web/vite.config.ts`) points at `test-servers/build/index.js` so `getTestMcpServerPath()` resolves to a real `.js` path.

## Serving the modern protocol era

A streamable-HTTP server can also serve the **modern (2026-07-28) protocol era** via the SDK's `createMcpHandler`:

- Set `transport.modern` in the JSON config — `true` for dual-era stateless serving, or `{ "legacy": "reject" }` for modern-only strict.
- Or pass `modern` on the `ServerConfig` for an in-process `createTestServerHttp`.

This is what lets an Inspector connection negotiating `protocolEra: "auto" | "modern"` reach the modern leg (populated `server/discover`, sessionless). See `test-servers/configs/modern-http.json`.

## Showcase configs

Each config below is a ready-made server for exercising one feature by hand.
Load one with `--config` and connect with the era its row names — every row says
which, because the two are not interchangeable and the wrong one usually presents
as a missing capability rather than an error.

| Config                                    | Demonstrates                                        | Issue                                                                  |
| ----------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| `mcp-app-http.json` **(legacy era)**      | An MCP App (UI resource + app tool) in the Apps tab | [#1859](https://github.com/modelcontextprotocol/inspector/issues/1859) |
| `app-elicitation-http.json` **(legacy era)** | An MCP App rendering a form elicitation           | [#1854](https://github.com/modelcontextprotocol/inspector/issues/1854) |
| `mcp-app-domain-http.json` **(legacy era)** | An MCP App asking for a dedicated origin (`_meta.ui.domain`) | [#2056](https://github.com/modelcontextprotocol/inspector/issues/2056) |
| `modern-mrtr-http.json` **(modern era)**                   | A single MRTR round-trip                           | —                                                                      |
| `mrtr-showcase-http.json` **(modern era)**                 | Every MRTR preset in one server                    | [#1860](https://github.com/modelcontextprotocol/inspector/issues/1860) |
| `modern-network-http.json` **(modern era)**                | Network tab: `Mcp-*` headers + error taxonomy      | [#1628](https://github.com/modelcontextprotocol/inspector/issues/1628) |
| `xmcpheader-modern-http.json` **(modern era)**             | Tools tab: `x-mcp-header` mirroring and exclusions | [#1632](https://github.com/modelcontextprotocol/inspector/issues/1632) |
| `pagination-http.json` **(legacy era)**                    | Page-by-page list fetching                         | [#1721](https://github.com/modelcontextprotocol/inspector/issues/1721) |
| `structured-output-http.json` **(legacy era)**             | Tools tab: a result's `structuredContent` section  | [#1908](https://github.com/modelcontextprotocol/inspector/issues/1908) |
| `duplicate-tool-names-http.json` **(legacy era)**          | A `tools/list` that repeats a tool name            | [#1957](https://github.com/modelcontextprotocol/inspector/issues/1957) |
| `nullable-fields-http.json` **(legacy era)**               | Tools tab: nullable (`anyOf` + `null`) arguments   | [#1928](https://github.com/modelcontextprotocol/inspector/issues/1928) |
| `root-union-schemas-http.json` **(legacy era)** | Tool schemas whose arguments are a root `anyOf` / `oneOf` | [#2123](https://github.com/modelcontextprotocol/inspector/issues/2123) |
| `unportable-schemas-http.json` **(legacy era)** | Tool schemas a real client rejects, flagged in all three clients | [#1005](https://github.com/modelcontextprotocol/inspector/issues/1005) |
| `rfc6570-templates-http.json` **(legacy era)**             | Resources tab: RFC 6570 resource-template expansion | [#1919](https://github.com/modelcontextprotocol/inspector/issues/1919) |
| `advertised-extensions-http.json` **(legacy era)**         | Tool registration gated on advertised extensions    | [#1739](https://github.com/modelcontextprotocol/inspector/issues/1739) |
| `oauth-custom-resource-metadata-http.json` **(legacy era)** | OAuth discovery driven by the challenge's `resource_metadata` | [#2071](https://github.com/modelcontextprotocol/inspector/issues/2071) |
| `oauth-revocation-http.json` / `oauth-no-revocation-http.json` **(legacy era)** | RFC 7009 token revocation on clear, with and without a `revocation_endpoint` | [#2144](https://github.com/modelcontextprotocol/inspector/issues/2144) |
| `oauth-rfc8414-at-oidc-path-http.json` **(legacy era)** | Plain OAuth 2.0 AS metadata served at the OIDC well-known path | [#2172](https://github.com/modelcontextprotocol/inspector/issues/2172) |
| `logging-{legacy,modern}-http.json` **(era per file)** | Logging, both eras                                  | [#1629](https://github.com/modelcontextprotocol/inspector/issues/1629) |
| `subscriptions-{legacy,modern}-http.json` **(era per file)** | Resource subscriptions, both eras                   | [#1630](https://github.com/modelcontextprotocol/inspector/issues/1630) |
| `subscriptions-never-acknowledged-http.json` **(modern era)** | A `subscriptions/listen` answered with a bare result  | [#2097](https://github.com/modelcontextprotocol/inspector/issues/2097) |
| `tasks-{legacy,modern}-http.json` **(era per file)** | Tasks, both eras                                    | [#1631](https://github.com/modelcontextprotocol/inspector/issues/1631) |
| `cancellation-modern-http.json` **(modern era)**           | Cancelling a call by closing its response stream    | [#2140](https://github.com/modelcontextprotocol/inspector/issues/2140) |
| `skills-http.json` **(either era)** | Skills tab: `skills/list`, digest verification, and the non-conforming cases | [#2234](https://github.com/modelcontextprotocol/inspector/issues/2234) |

## Skills (SEP-2640)

`skills-http.json` advertises the `io.modelcontextprotocol/skills` extension
with `directoryRead: true` and serves four skills over two `skills/list` pages.
It works on **either era**: `skills/list`, `skills/get` and
`resources/directory/read` are consumer-owned extension methods that neither
era codec defines, so the SDK's era gate skips them entirely — which is why
this fixture, unlike the tasks ones, needs no per-era variant.

Three of the four skills are deliberately non-conforming, because the checks
the Skills tab runs are untestable without them:

| Skill | What it exercises |
| --- | --- |
| `data-analysis` | The clean case — **Verify all** reports `verified` for every file. |
| `tampered-notes` | An advertised digest that does not match the bytes served, so verification reports a **digest mismatch** with both digests shown. |
| `dynamic-report` | `resources: "dynamic"` — a generated file set, so integrity cannot be verified at all and the tab says so rather than staying silent. |
| `wrong-folder` | A URI path segment (`wrong-folder`) that disagrees with `frontmatter.name` (`right-name`), the one structural invariant SEP-2640 states outright. |

Connection Info shows the extension and its `directoryRead` sub-flag; the
Inspector surfaces that flag but does not call `resources/directory/read` yet.

## Cancelling a call

`cancellation-modern-http.json` serves `slow_task`, which reports progress once
a second for up to 60 seconds and stops early if it is cancelled, printing how
far it got to **the server's terminal**. Connect with **Protocol Era = Modern**.

Watch the terminal you started the server in, run `slow_task` from the Tools
tab, and click **Cancel** after a few seconds. The progress must stop
immediately, the Inspector must report the call cancelled, and the server must
print `[slow_task] cancelled after Ns`. On the broken build the progress kept
arriving until the tool completed all 60 seconds and the server printed
`completed all 60s without being cancelled`, because the Inspector was sending
the wrong cancellation signal
([#2140](https://github.com/modelcontextprotocol/inspector/issues/2140)).

The server's terminal is the place to watch, not the Inspector's result panel:
cancellation closes the very stream the tool's result would travel on, so on a
successful cancel the tool's return value is undeliverable by construction and
the Inspector shows a cancelled call rather than a result. Which is the point —
what has to stop is the *work*, and only the server can report that.

The 2026-07-28 spec makes this
[transport-specific](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation#transport-specific-cancellation):
for Streamable HTTP, **closing the request's SSE response stream is the
cancellation signal**, and a `notifications/cancelled` is "neither required nor
expected"; stdio, which has no per-request stream to close, keeps the
notification. A spec-compliant server therefore answers the notification `202
Accepted` and drops it — which is precisely what the reporter observed, with the
task running on to completion while the Inspector reported it cancelled.

The SDK already implements that fork, off `transport.hasPerRequestStream`. Every
Inspector connection is wrapped in `MessageTrackingTransport` (it feeds the
Protocol and Network tabs), which did not forward the flag — so the SDK saw
`undefined` and took the stdio branch on **every** client, CLI and TUI included.
The web client needed two more links in the chain: its browser-side transport
answers for the real upstream one that lives on the Node backend, and the abort
has to survive the `POST /api/mcp/send` hop to reach it.

Watch it on the wire in the **Protocol** tab: cancelling now emits no
`notifications/cancelled` frame at all, and the `tools/call` entry ends as an
aborted request rather than a completed one. Switch the same server to
**Legacy** and the notification comes back — that era has no per-stream
mechanism, so it is still the correct signal there.

## MCP Apps

`mcp-app-http.json` serves the `mcp_app_demo` tool (`_meta.ui.resourceUri`) alongside its `mcp_app_demo_widget` UI resource, so the **Apps** tab has a real App to render. It is a plain streamable-HTTP server — connect with the **default (legacy)** protocol era, not Modern.

Open the Apps tab, select `mcp_app_demo`, give it a title and click **Open App**: the widget renders inside the sandbox iframe and exercises the host-side UI protocol surface — host-context render, `size-changed`, `ui/message`, and a log line into the **App logs** panel. Because the widget is served through the sandbox proxy page, this config is also what reproduces [#1859](https://github.com/modelcontextprotocol/inspector/issues/1859) (a missing `clients/web/static/sandbox_proxy.html` surfaces here as a "Sandbox not loaded" message in place of the widget) — a failure that only ever appeared in an installed package, never in the repo.

For the scripted version of the same flow (`--app-info` probe → deep link → rendered widget), see [Reviewing an MCP App](./mcp-app-review.md).

## An App's dedicated origin

`mcp-app-domain-http.json` serves the same `mcp_app_demo` widget as above, with one addition: its UI resource declares `_meta.ui.domain`. Plain streamable-HTTP; connect with the **default (legacy)** protocol era.

That field is how a server asks its host for a stable, dedicated origin. Without one, an App renders into a `srcdoc` frame sandboxed without `allow-same-origin`, so its document has an *opaque* origin and every request it makes carries `Origin: null` — which no CORS policy, OAuth callback, or API-key allowlist can admit ([#2056](https://github.com/modelcontextprotocol/inspector/issues/2056)).

Open the Apps tab and run `mcp_app_demo`. The widget renders identically to `mcp-app-http.json` — the difference is not visual. Inspect the inner iframe in devtools: on this server it is served from `http://127.0.0.1:6278/app-document/<id>` and `location.origin` is that real origin, where on `mcp-app-http.json` it is `about:srcdoc` with an origin of `null`. (The host is whatever the Inspector bound to — `127.0.0.1` by default, an *address* rather than the name `localhost`, for the reason `resolve-bind-host.ts` documents.)

The spec makes `domain`'s format **host-dependent**, and the Inspector owns no domain infrastructure — so it reads any non-empty value as a *request* rather than an address, and answers with a real loopback origin of its own. See [MCP App dedicated origins](../clients/web/README.md#mcp-app-dedicated-origins-metauidomain) for the full contract, including what the one shared origin does and does not isolate, and how every failure falls back to the default render rather than blanking the app.

## App-rendered form elicitations

`app-elicitation-http.json` serves `app_choose_option` alongside the `choose_option_app` UI resource (`ui://demo/choose-option.html`). The tool sends a completely ordinary form `elicitation/create` — the only thing added is `_meta.ui.resourceUri` naming that app. Plain streamable-HTTP; connect with the **default (legacy)** protocol era.

Run `app_choose_option` from the Tools tab. The server's app renders in a modal instead of the built-in elicitation form, and clicking **Option A**, **Decline**, or **Cancel** returns the standard `ElicitResult` straight to the server, which echoes it into the tool result.

App rendering is selected only when **all four** conditions hold ([#1854](https://github.com/modelcontextprotocol/inspector/issues/1854), per [ext-apps#733](https://github.com/modelcontextprotocol/ext-apps/pull/733) / SEP-3118):

1. the client advertises `elicitation.form`;
2. the client advertises `extensions["io.modelcontextprotocol/ui"].mimeTypes` including `text/html;profile=mcp-app`;
3. **both** the client and the server advertise the nested `elicitation` setting on that same extension;
4. the request carries a valid absolute `ui://` URI in `_meta.ui.resourceUri`.

Only the **web** client advertises the nested client-side setting, and only because it has a sandbox renderer to back it; the CLI and TUI advertise the MIME type (they know what an App is) but never claim they can resolve an elicitation through one, so the same server falls back to their native prompts. Turning **Server Settings → Advertised Extensions → MCP Apps UI** off, or turning form elicitation off, removes the claim on web too.

Everything else falls back to the built-in elicitation form, by design: metadata that is absent or not an absolute `ui://` URI, a resource that fails to load, a sandbox or bridge that fails to initialize, an app that did not advertise `elicitation`, a request that times out, and any result that is not a valid `ElicitResult` for the requested schema. An explicit `decline` or `cancel` is **not** a fallback — it is a completed elicitation and goes back to the server as-is.

> The Inspector speaks the ext-apps#733 wire protocol but does not yet consume its helpers: the released `@modelcontextprotocol/ext-apps` (1.7.5) predates that PR. `core/mcp/appElicitation.ts` and `clients/web/src/components/elements/AppRenderer/requestAppElicitation.ts` mirror it exactly and are marked for deletion in favour of the package's own exports once a release containing it ships.

## MRTR

`modern-mrtr-http.json` serves the `mrtr_confirm` tool (preset `mrtr_confirm`, `createMrtrTool`) over the modern leg. Its handler returns `inputRequired(...)` embedding a form elicitation, so invoking it produces a real round-trip: `input_required` → the client fulfils the embedded elicitation and retries with a new id → `complete`.

The Inspector drives MRTR manually (`inputRequired: { autoFulfill: false }`), so the embedded elicitation pauses at the pending-request modal (tagged "input_required") for you to answer, then the retry completes. Useful for eyeballing both that pending-request UX and the Protocol view's MRTR conversation grouping.

`mrtr-showcase-http.json` bundles every MRTR preset in one server:

| Preset          | Behavior                                                                       |
| --------------- | ------------------------------------------------------------------------------ |
| `mrtr_confirm`  | Single round                                                                   |
| `mrtr_two_step` | Two elicitation rounds via `requestState`                                      |
| `mrtr_sample`   | Embedded sampling → the Sampling panel                                         |
| `mrtr_roots`    | Embedded `roots/list`, auto-answered silently from configured roots (no modal) |
| `mrtr_edge`     | An `inputRequests`-only round, then a `requestState`-only round                |
| `mrtr_empty`    | Completes with an empty result — no `content`, no `structuredContent`          |
| `mrtr_loop`     | Never completes → trips the `MRTR_MAX_ROUNDS` bound                            |

Run `mrtr_empty` and answer its single elicitation: the Protocol tab groups the
exchange as an MRTR conversation ending **COMPLETE**, and the Results panel says
**"Empty result — The tool call completed successfully and returned no content."**
On the broken build that same result rendered as **"No results yet"**, the panel's
pre-run placeholder ([#1860](https://github.com/modelcontextprotocol/inspector/issues/1860)) —
so a call the user had just watched succeed read as a call that never ran. An
empty `content` array with no `structuredContent` is a legal `CallToolResult`,
and the panel only ever mounts once a result exists, so the placeholder wording
could not be true there. (The neighbouring half of the same gap — a result whose
payload lives only in `structuredContent` — was closed by
[#1908](https://github.com/modelcontextprotocol/inspector/issues/1908).)

> The legacy `collect_elicitation` preset calls `server.elicitInput`, which errors on the 2026-07-28 leg — server→client requests aren't allowed there. MRTR is the modern replacement.

## Network tab — standardized headers and error taxonomy

`modern-network-http.json` covers SEP-2243 / SEP-2575. It serves a `get_weather` tool whose `city` argument carries an `x-mcp-header: "City"` annotation, so a modern client mirrors it to `Mcp-Param-City`.

It also serves four `trigger_*` tools that the modern leg's spec-error injector (`transport.modern.injectSpecErrors: true`) answers with a real HTTP status plus JSON-RPC error body:

| Tool                          | Response                                 |
| ----------------------------- | ---------------------------------------- |
| `trigger_header_mismatch`     | `400` / `-32020`                         |
| `trigger_missing_capability`  | `400` / `-32021`                         |
| `trigger_unsupported_version` | `400` / `-32022` (with `data.supported`) |
| `trigger_method_not_found`    | `404` / `-32601`                         |

Open the Network tab to see the mirrored `Mcp-*` headers highlighted, sentinel values decoded, and each error rendered distinctly.

> **`Mcp-Param-*` mirroring is built by the Inspector, not the SDK.** The SDK only mirrors inside `client.callTool()`, and skips it in the browser (`detectProbeEnvironment() !== "browser"`). The Inspector routes `tools/call` through `client.request()` to drive MRTR manually, so it builds the mirrored headers itself ([#1846](https://github.com/modelcontextprotocol/inspector/issues/1846)) — on **every** client, web included, since the web client's upstream request is issued by the Node backend rather than the browser. So `get_weather` is callable from web, CLI, and TUI alike, in both the plain and "Run as task" forms.

## `x-mcp-header` in the Tools tab

`xmcpheader-modern-http.json` serves:

- `echo` — plain tool.
- `get_weather` — a **valid** `x-mcp-header: "City"` annotation on its `city` argument.
- `invalid_header_tool` — an annotation using the header name `"Bad Header"`. The space makes it an invalid RFC 9110 token, so the whole tool definition is invalid.
- `trigger_invalid_params` — answered with a real `-32602 Invalid params` error whose message is _not_ about a missing tool.

Open the Tools tab: `get_weather`'s detail panel shows a **"Mirrored request headers (SEP-2243)"** section (`city → Mcp-Param-City`), and `invalid_header_tool` appears struck-through under an **"Excluded (SEP-2243)"** divider with the reason on hover. A conforming Streamable HTTP client MUST drop it from `tools/list`; the Inspector surfaces _why_.

Under SDK v2 a `tools/call` rejecting with `-32602` renders as a distinct error panel rather than an `isError` result — headed **"Unknown Tool"** when the message names a missing tool, or **"Invalid Parameters"** otherwise (run `trigger_invalid_params`).

## Page-by-page fetching

`pagination-http.json` serves 12 tools, 12 resources, and 12 prompts (presets `numbered_tools` / `numbered_resources` / `numbered_prompts`, `count: 12`) with a `maxPageSize` of 4 each, so every list paginates into three pages.

Turn on **"Fetch Lists One Page at a Time"** (Server Settings — the `paginatedLists` setting, or the **Paginated** switch in a list sidebar) and the lists load page 1 only (4 items) with a **Load next page** control and an _N pages loaded_ status. Each click fetches the next 4 and appends them; Refresh resets to page 1. With the switch off (the default), the same lists auto-aggregate all three pages on connect.

## Structured output

`structured-output-http.json` serves `list_items` (nested `structuredContent` — objects inside arrays inside an object, the shape from [#1908](https://github.com/modelcontextprotocol/inspector/issues/1908)), `get_temp` (a flat three-key payload), and `echo` (no `outputSchema` at all). It is a plain streamable-HTTP server — connect with the **default (legacy)** protocol era.

Run `list_items` from the Tools tab: the result panel shows the `content[]` text summary ("Found 2 items.") **and** a collapsible **Structured Output** section rendering the schema-validated payload as pretty-printed, copyable JSON. That section is what v2 was dropping — a tool declaring an `outputSchema` returns its real data there, and the text block usually only summarizes it. Run `echo` to confirm the section is absent when a result carries no `structuredContent`.

## Duplicate tool names

`duplicate-tool-names-http.json` serves `get_weather`, `get_temp`, `echo`, and `add`, then repeats `get_weather` and `echo` at the end of `tools/list` with the same `name` and a `(duplicate)` title (`duplicateToolNames`). No preset can produce this shape — the SDK's `registerTool` rejects a repeated name — but a real server can and does, and the Inspector has to render it faithfully.

Connect (default legacy era), open the Tools tab, and type `get` into **Search tools**: the list must narrow to exactly the three `get_*` rows. On the broken build it kept a stale `echo` row, because the sidebar keyed rows by `tool.name` alone and the colliding keys orphaned a child during reconciliation ([#1957](https://github.com/modelcontextprotocol/inspector/issues/1957)).

The duplicated copies are appended rather than placed beside their twin on purpose. React matches a leading run of same-key children first, so a head-adjacent duplicate happens to line up and the defect hides; separating the pair is what makes it observable — and it is also the realistic shape, two tool sources concatenated.

## Nullable arguments

`nullable-fields-http.json` serves `record_shipment`, whose four arguments are each declared with Zod's `.nullish()` — "optional **and** explicitly nullable". That compiles to `anyOf: [<branch>, { "type": "null" }]`, so the real type (and, for the enum, its `enum` list) sits on a branch rather than at the top level. `get_temp` sits alongside it with a plain, non-nullable `units` enum for comparison. Plain streamable-HTTP — connect with the **default (legacy)** protocol era.

Open the Tools tab and select `record_shipment`: `direction` must render as a **Select** (`envio` / `recebimento`) with a clear button that sets it back to `null`, `reference` as a text input, `quantity` as a number input, and `express` as a checkbox. On the broken build every one of them fell through to the raw-JSON textarea, which re-escaped its own contents on each keystroke until the value was unusable ([#1928](https://github.com/modelcontextprotocol/inspector/issues/1928)). The tool echoes the arguments it received, so the result panel shows exactly what was sent.

The **TUI** had the same gap and is worth checking against the same server (`--tui`, then test `record_shipment`): `direction` is a select, `quantity` an integer field, `express` a boolean. Both clients now share one collapse step — `normalizeNullableUnion` in [`core/json/nullableUnion.ts`](../core/json/nullableUnion.ts) — precisely so they cannot drift on which schemas they can render.

## Root-level unions

`root-union-schemas-http.json` serves two tools whose arguments are declared as a **composition at the root** of `inputSchema` rather than as a flat `properties` map — `echo` with an `anyOf` beside its own `message` property, and `get_weather` with an OpenAPI-style `discriminator` over a `oneOf`. Plain streamable-HTTP — connect with the **default (legacy)** protocol era.

The 2026-07-28 revision makes this shape explicitly legal: `type: "object"` is required at the root, and beyond that "any JSON Schema 2020-12 keyword may appear alongside `type`, including composition keywords (`oneOf`, `anyOf`, `allOf`, `not`)".

Open the Tools tab and select `echo`. Above the fields is a **Variant** picker listing the union's alternatives — labelled from each branch's `title`, else its discriminator `const`, else its position — and choosing one swaps in that branch's fields with the discriminator already filled in. A field the schema pins with `const` renders read-only, and is filled in automatically only where the schema also **requires** it: `const` constrains a value that is present rather than demanding one, so an optional pinned field stays omittable.

The two tools show the two halves of the old behavior. On the broken build `echo` rendered its root `message` and **nothing from either branch**, so it could only ever be called with half its arguments; `get_weather`, whose fields live entirely on its `oneOf`, rendered **nothing but the Execute Tool button** — no picker, no fields, not even the raw-JSON editor a union-typed _property_ falls back to ([#2123](https://github.com/modelcontextprotocol/inspector/issues/2123)).

Switching branches drops the values that belonged to the outgoing one. They are no longer on screen, so the user can neither see nor clear them, and submitting them would describe a shape the call is not making.

The **TUI** has the same gap and is worth checking against the same server (`--tui`, then test `echo`). ink-form is static — there is no picker to hide the alternatives behind — so each branch becomes its own **section**, preceded by a **Variant** select naming which one the call means. The fields in a branch section are rendered optional whatever the branch says: only one alternative applies to a call, so requiring them would build a form that can never be submitted. That makes the *form* satisfiable, not the call, so the chosen branch's own `required` list is checked at submit and reported — never sent as a call already known to violate the schema.

The sections are not as independent as they look, which is why the select is not cosmetic: ink-form keeps one value object for the whole form, keyed by field name alone, so two branches both declaring `kind` would be **one** field and the later section's initial value would decide what the earlier one submits. Each branch's fields are therefore rendered under a prefixed name and translated back on submit, where every branch but the chosen one is dropped.

The **CLI** has no form at all, but the same flattening decides how `--tool-arg` values are typed: a branch's `count: { "type": "number" }` is what turns `--tool-arg count=3` into `3` rather than `"3"`. Which branch is *inferred* rather than chosen — a discriminated union pins its discriminator with `const`, so the supplied arguments either identify one branch or they do not. When nothing identifies one, only the names every branch that declares them types the same way are coerced; a name one branch calls a number and another a boolean is passed through as the string it was typed as, rather than run through an arbitrary branch's schema.

All three read one helper, [`core/json/rootUnion.ts`](../core/json/rootUnion.ts), so they cannot drift on which schemas they can render.

What it declines to flatten is as deliberate as what it flattens, and every case falls back to whatever the schema's own `properties` describe rather than claiming something untrue:

- **A union whose members are not all field-carrying object schemas** — including one whose member `type` rules objects out, since tool arguments are a JSON object and such a member can never match. A picker whose options render nothing is no better than no picker.
- **A branch that restates a constraint the root already states.** The two are conjunctive, so root `minimum: 10` under branch `minimum: 0` is still 10, disjoint `enum`s leave nothing satisfiable, and `type: "string"` under `type: "number"` describes a value that cannot exist — rendering either side would accept what the schema rejects. A property both declare *compatibly* is merged rather than replaced, so a root's `minimum` survives a branch's `maximum`, and a disagreement about `title`/`description` is not a conflict at all.
- **A composition member stating anything the merge cannot apply.** Only `type`, `properties` and `required` are folded in, so a member carrying a nested `allOf`/`anyOf`, a `not`, an `additionalProperties`, or a `$ref` would have that constraint erased along with the keyword — turning an unsatisfiable schema (`allOf: [false, …]` admits nothing) into a fillable form. `allOf` members are checked against the accumulated merge rather than the root alone, so two of them contradicting each other is caught even when neither contradicts the root.
- **A `oneOf` whose alternatives are not mutually exclusive.** `oneOf` demands that *exactly one* alternative match, which flattening cannot preserve — the branches are offered as if any would do. It is only safe with a discriminator: a property every branch pins to a `const` of its own **and requires**, since an optional one leaves `{}` matching every branch. An undiscriminated `oneOf` is declined; `anyOf` makes no such claim and is offered either way.
- **A union that adds fields under a restrictive root `additionalProperties`.** That keyword constrains whatever its *sibling* `properties` does not name, so a root `additionalProperties: false` rejects every field the branches add — flattening would move them beside the keyword, where they read as allowed. An empty schema (`{}`) constrains nothing and is treated as permissive.
- **A schema carrying both `oneOf` and `anyOf`** — independent keywords a value satisfies *together*, not two spellings of one union, so reading one and dropping the other omits real constraints while looking complete. Satisfying both honestly means the cross product of their alternatives, which no real schema has yet asked for.
- **`not`**, which is not interpreted at all: there is no faithful form for "anything except this".

Declining changes what *renders*, never whether the tool is treated as taking arguments: a declined union still has fields, so an App tool carrying one still asks for them rather than auto-invoking with `{}`.

## Unportable tool schemas

`unportable-schemas-http.json` serves four tools, three of whose advertised
schemas carry constructs that are legal JSON Schema and are refused or
mishandled by real MCP clients:

| Tool | What it carries |
| --- | --- |
| `get_temp` | `outputSchema.properties.data` as a bare `true` — what Go's `jsonschema` package emits for `interface{}`, the case reported in [#1005](https://github.com/modelcontextprotocol/inspector/issues/1005) |
| `echo` | an array-form `"type": ["null","boolean"]`, and an `opts` property that constrains nothing |
| `add` | a property pointing at a remote `$ref` |
| `get_weather` | nothing — left clean, so a flagged tool sits beside an unflagged one |

Plain streamable-HTTP — connect with the **default (legacy)** protocol era.
Every tool here is still **runnable**: the override replaces only the
*advertised* schema, and the flagship bare-`true` rides `get_temp` (which
returns structured content) rather than `echo` — see the ⚠️ caveat at the end
of this section for why that placement matters.

The Inspector is where a server author looks first, so a construct that will
fail downstream is named here rather than passed through silently. All three
clients report the same verdict from
[`core/json/schemaLint.ts`](../core/json/schemaLint.ts), each with the room it
has:

```bash
mcp-inspector --cli http://127.0.0.1:6603/mcp --method tools/list --strict   # exits 6
```

- **CLI** — `--strict` prints the full report (path, issue, suggested fix) on
  stderr and exits `6` on an error-severity finding; without it, one summary
  line. See [Schema portability](../clients/cli/README.md#schema-portability---strict).
- **TUI** — the tools list marks `get_temp` with a red `!` and `echo`/`add`
  with a yellow `?`; the detail pane lists each finding under **Schema
  Portability**.
- **Web** — the Tools sidebar row carries the same flag as a hover-labelled
  icon, and selecting the tool shows a **Schema portability** section above the
  argument form.

This is deliberately **not** a JSON Schema validator. A census of 617 public
servers (14,804 tool schemas) reported on that issue found **0** that fail the
SDK's own `ListToolsResultSchema.safeParse`, so a conformance check would
report nothing on essentially every real server. What bites is the narrower
subset each consumer accepts, and each rule here is a construct known to be
refused or degraded by a shipping client. The schemas are supplied through the
test server's `rawToolSchemas` override, because the Zod-built presets cannot
express any of them — which is the same reason a real server hits this only
when its schemas come from another generator.

⚠️ **If you add an `outputSchema` override of your own, put it on a tool that
returns structured content.** A conforming client validates a tool result
against the advertised output schema, so an override on a preset that returns
none makes every call to it fail with "declares an output schema but returned
no structured content" — a confusing thing to hit from a fixture. That is why
the bare `true` rides `get_temp` here and not `echo`.

## RFC 6570 resource templates

`rfc6570-templates-http.json` serves two resource templates straight out of [#1919](https://github.com/modelcontextprotocol/inspector/issues/1919) — `events_by_topic` (`foobar://events/{topic}`) and `events_by_query` (`foobar://events{?topic}`) — each echoing the URI it was matched against, plus a plain `foobar://events` resource (see below). Plain streamable-HTTP; connect with the **default (legacy)** protocol era.

Open the Resources tab and pick **events_by_topic**, then enter `foo/bar`. The request must go out as `foobar://events/foo%2Fbar`, and the result echoes back the URI the server matched. On the broken build the value was spliced in raw, so the slash created a second path segment and the SDK's matcher answered `-32602 Resource not found: foobar://events/foo/bar` — the exact failure in the issue. The same holds for `?`, `#`, `%`, spaces, and non-ASCII text.

**events_by_query** is the half that was invisible: the old `/\{(\w+)\}/g` scan could not see an expression carrying an operator, so no `topic` input was rendered at all. It now appears, marked **Optional** — RFC 6570 drops the whole expression when the variable is undefined, so reading with the field blank requests `foobar://events`, and filling it in requests `foobar://events?topic=foo%2Fbar`. The URI preview beside the title shows the partially-expanded form as you type, leaving unfilled expressions standing as written.

> The plain `foobar://events` resource is registered deliberately, not as filler. The SDK's `UriTemplate.match()` compiles `{?topic}` to a **required** `\?topic=([^&]+)`, so a template alone cannot serve the blank read — `match("foobar://events")` returns `null`. A real server exposes the unfiltered collection as its own resource; the showcase does the same so that step actually resolves.

The web client and the TUI expand through one shared helper, [`core/mcp/uriTemplate.ts`](../core/mcp/uriTemplate.ts) — the web Resources form directly, the TUI via `InspectorClient.readResourceFromTemplate` — and both derive their **form fields** from its parser too, which is the half that makes the sharing real: a form submits values under the names it rendered, so a parser that mangles a name silently drops the value at expansion time. (The CLI is not a consumer: it has no template form, and its `resources/read` passes the already-expanded `--uri` straight through.)

The SDK's `UriTemplate` is still used, but only to _validate_ a template (constructing it is what rejects an unclosed expression). Its expander is not, because it is incomplete in five ways — each measured against the pinned SDK, not inferred:

| Shape           | SDK behavior                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `{a,b}`         | raw-joins the values — no encoding, operator prefix dropped                                                    |
| `{;id}`         | `;` is missing from its operator list, so the variable parses as `;id`                                         |
| `{id:3}`        | the prefix modifier is folded into the name, giving `id:3`                                                     |
| `{+v}` / `{#v}` | `encodeURI` mangles reserved `[`/`]` (`[::1]` → `%5B::1%5D`) and double-encodes pct-triplets (`%2F` → `%252F`) |
| `{v}`           | `encodeURIComponent` leaves the sub-delims `!'()*` bare, which RFC 6570 requires encoded                       |

The `;` and `:3` rows are the ones a user sees directly: on the SDK's parse the form renders fields literally labelled `;id` and `id:3`. The `+`/`#` row is silent corruption rather than over-escaping — an IPv6 literal or an already-encoded path arrives at the server altered.

A template that cannot be expanded at all — an out-of-grammar modifier (`{id:abc}`), or an expression declaring no variable (`{}`, `{a,}`, `{?}`) — **withholds the read** rather than sending something. Pick **events_malformed** (`foobar://events/{topic:abc}`) to see it: Read Resource is disabled, the reason is printed under the form, and the preview shows the template as the server declared it. The alternative is worse than it looks: `x://{}` would otherwise expand to `x://` with no inputs rendered, so the form's "everything required is filled" check passes vacuously and it reads a URI that is not the template the server published.

Literals are pct-encoded on expansion too (RFC 6570 §3.1): `café/{var}` sends `caf%C3%A9/value`, not raw UTF-8 in the path — something the SDK's expander does not do either. And the _names_ a template may use are RFC 6570's `varchar` plus a labelled tolerance for `-` and `~`: the conformance suite rejects `{default-graph-uri}`, but real servers publish such names and the SDK's matcher round-trips them, so the Inspector expands them and marks the variable `conforming: false` rather than refusing a resource that demonstrably works.

An **undefined** variable is what omits its expression — a variable defined as the empty string expands (`x{?q}` gives `x?q=`, `x{;q}` gives `x;q`, per RFC 6570 §3.2.7). The expander honors that distinction, so a caller such as `readResourceFromTemplate` can request either URI. Collapsing the two is a _form_ concern, not a template one: both clients seed every declared variable with `""` and a text input cannot express "defined but empty", so each form drops its blanks (`definedValues`) on the way in.

Requiredness is a property of the **expression**, not the variable: RFC 6570 drops undefined names from a multi-name expression, so `{a,b}` with only `a` filled is expandable and a form must not block it. `requiredGroups` returns one entry per non-omittable expression and `hasRequiredValues` asks that each be satisfied by any one of its names — which no per-variable flag can express once a name recurs across expressions (`{a,b}{a,c}` is satisfied by filling `b` and `c`).

## Advertised extensions

`advertised-extensions-http.json` serves `echo` (always) and a `get_weather` tool **gated on the `io.modelcontextprotocol/tasks` extension** (`extensionGatedTools`): the tool is registered but starts disabled, and the server enables it on `notifications/initialized` only when the client declared that extension in its `capabilities.extensions`.

1. Connect — the Inspector advertises the Tasks extension by default, so the Tools list shows both `echo` and `get_weather`.
2. Open **Server Settings → Advertised Extensions**, uncheck **Tasks (io.modelcontextprotocol/tasks)**, and reconnect.
3. The client now advertises no extensions, the server never enables `get_weather`, and the Tools list shows only `echo`.

This is the debugging knob for a server legitimately changing tool registration based on what the client advertises. Legacy stateful leg only — the modern per-request leg has no persistent `oninitialized`.

## OAuth `resource_metadata` at a non-default path

`oauth-custom-resource-metadata-http.json` is an OAuth-protected server (combined AS + resource, DCR enabled) that serves its RFC 9728 protected-resource metadata document **only** from `/custom/protected-resource`, and advertises it on every 401:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="http://127.0.0.1:8082/custom/protected-resource"
```

The default `/.well-known/oauth-protected-resource` route is deliberately left unserved, so a client that ignores the advertised URL cannot discover the document at all. Plain streamable-HTTP — connect with the **default (legacy)** protocol era.

Add the server, click **Connect**, and watch the Inspector's first protected-resource metadata request in the Network tab: it must go to `/custom/protected-resource`. On the broken build the challenge's `resource_metadata` was parsed and then dropped before the SDK's `auth()` ever saw it ([#2071](https://github.com/modelcontextprotocol/inspector/issues/2071)), so discovery probed locations derived from the MCP server URL, 404'd, and authorization failed for any server that puts the document somewhere other than the well-known path.

The same server is worth running against `--cli` / `--tui`, which reach it by a different route: with no stored token in the legacy era the Inspector connects with no auth provider (so the SDK cannot open a browser before the callback server is listening), the 401 surfaces as the SDK's headerless `UnauthorizedError`, and the client calls `authenticate()` with no challenge in hand. The transport therefore *observes* every 401/403 passively, so the advertised URL is still available on that path.

The value now rides the normalized `AuthChallenge` as a string — it has to be serializable, because the web client's challenge crosses the remote-backend boundary as JSON — and is converted to a `URL` at the OAuth boundary, where it is handed to `auth()` as `resourceMetadataUrl` and to the CIMD pre-registration probe, which runs *before* `auth()` and would otherwise do its own default-location discovery. A malformed value is ignored rather than surfaced, matching the SDK's own `WWW-Authenticate` parser: discovery falls back to the default locations instead of failing the whole authorization on a bad header. The callback leg needs nothing extra — SDK `auth()` persists the URL in its discovery state, so it survives both the web full-page redirect and the CLI/TUI loopback callback.

## Revoking tokens on clear (RFC 7009)

`oauth-revocation-http.json` and `oauth-no-revocation-http.json` are the same OAuth-protected server (combined AS + resource, DCR, refresh tokens) differing in one thing: the first advertises a `revocation_endpoint`, the second advertises none. Plain streamable-HTTP — connect with the **default (legacy)** protocol era.

Add either server, connect and complete authorization, then use **Clear OAuth state and disconnect** (Server Settings → Authorization) and watch the Network tab.

- On `oauth-revocation-http.json` a `POST /oauth/revoke` goes out naming the **refresh token**. RFC 7009 §2.1 asks the authorization server to invalidate the access tokens issued under the same grant, so one request ends both halves — the fixture implements that linkage, so re-sending the old bearer token to `/mcp` afterwards gets a 401. The request is built from the stored state *before* the local clear and sent *after* it, so the clear never waits on the network; in the Network tab the POST therefore follows the local teardown rather than preceding it.
- On `oauth-no-revocation-http.json` nothing is sent at all, and the clear behaves exactly as it did before the feature existed. That no-op path is what makes this safe against every authorization server with no RFC 7009 support ([#2144](https://github.com/modelcontextprotocol/inspector/issues/2144)).

On the broken build both servers behaved like the second: the Inspector deleted its local copy and the grant stayed valid at the authorization server until it expired on its own — which for a refresh token is a long time, by design.

Uncheck **Revoke tokens on clear** in the same panel (persisted as `oauth.revokeOnClear: false`) and the first server behaves like the second. That is not only an escape hatch: a client that disconnects still holding live tokens is a case worth reproducing when the server is the thing under test.

The same behavior is reachable from the other clients — the TUI's **Clear OAuth State**, and the CLI's `--relogin` (with `--no-revoke` as the per-run opt-out).

## Plain OAuth 2.0 metadata at the OIDC well-known path

`oauth-rfc8414-at-oidc-path-http.json` is an OAuth-protected server (combined AS + resource, DCR enabled) whose RFC 8414 authorization-server metadata is served **only** from `/.well-known/openid-configuration`. It is a plain OAuth 2.0 authorization server — no ID tokens, no `jwks_uri`, no `sub` claims — and RFC 8414 §5 explicitly permits that filename for general OAuth metadata. `/.well-known/oauth-authorization-server` is deliberately left unserved. Plain streamable-HTTP — connect with the **default (legacy)** protocol era.

Add the server and click **Connect**: authorization must proceed normally. On the broken build it failed before the browser ever opened, with a `ZodError` naming three fields the server had no reason to publish:

```
"path":["jwks_uri"] … "path":["subject_types_supported"] … "path":["id_token_signing_alg_values_supported"]
```

The cause is upstream. `discoverAuthorizationServerMetadata` in `@modelcontextprotocol/client@2.0.0` picks its validation schema from the well-known **filename that resolved**, not from the document that came back — anything found at `openid-configuration` is parsed as OpenID Connect Discovery 1.0 provider metadata, which requires those three fields. And because the parse *throws* rather than continuing the candidate loop, discovery aborts outright instead of falling through ([#2172](https://github.com/modelcontextprotocol/inspector/issues/2172), filed upstream as [typescript-sdk#2733](https://github.com/modelcontextprotocol/typescript-sdk/issues/2733)).

`core/auth/oidcDiscoveryCompat.ts` works around it without fabricating anything. When the RFC 8414 candidate comes back 4xx, it fetches the OIDC candidates the SDK would try next; if one returns a document that satisfies `OAuthMetadataSchema` but *fails* the OIDC schema, that document is returned as the response to the RFC 8414 request — so the SDK validates it under the schema that actually describes it. A genuine OpenID provider document is left alone and takes the SDK's normal OIDC leg. Issuer validation is untouched, since the substituted document is the one the server published, `issuer` included.

The metadata shown in the Auth tab is exactly what the server sent — no invented `jwks_uri`. In the Network tab the substituted response is captured against the RFC 8414 URL (the wrapper sits on the base fetch, below the tracker, because that is the only seam that also covers the discovery the SDK runs from inside the transport), so it carries an `x-inspector-oauth-metadata-source` response header naming the URL its body was actually fetched from. The same URL is printed as a console warning.

## Logging, both eras

`logging-legacy-http.json` and `logging-modern-http.json` both serve `logging: true` plus a `send_notification` tool that emits a `notifications/message` at a chosen level. The legacy one is a plain streamable-HTTP server; the modern one sets `transport.modern: true`.

- **Legacy** — the **Logs** tab gives a session-scoped **Set Active Level** selector + **Set** button. Calling `send_notification` streams the log into the panel.
- **Modern** — the same tab instead shows **Log Level per Request**. Pick a level to opt in and the client stamps `_meta["io.modelcontextprotocol/logLevel"]` on every subsequent request (verify in the Network tab's request body). Calling `send_notification` streams the log over the request's SSE response. Set it back to **Off** and the same call is silently gated — the request omits the `logLevel` key, so the log never arrives.

That gating is faithful to the spec ("a server MUST NOT emit `notifications/message` for a request that didn't opt in") because `send_notification` emits through the SDK's request-scoped, threshold-aware `extra.log` (`ctx.mcpReq.log`). On the modern leg it reads the per-request `logLevel` opt-in from the request envelope and drops the message when the client didn't opt in or the level is below the requested severity; on legacy it honors the session level from `logging/setLevel`. Because it emits through the request's `notify`, the modern response upgrades to SSE and the log rides the originating request's stream.

## Resource subscriptions, both eras

`subscriptions-legacy-http.json` and `subscriptions-modern-http.json` both serve three `numbered_resources` with `subscriptions: true`. The legacy one also serves an `update_resource` tool; the modern one sets `transport.modern: true`.

- **Legacy** — open a resource in the **Resources** tab and click **Subscribe**. The client sends `resources/subscribe` and the Subscriptions section lists the URI with no stream chrome. Call `update_resource` with that URI and the server updates the content and emits `notifications/resources/updated`, stamping the subscribed tile's last-updated time.
- **Modern** — the same Subscribe instead sends **`subscriptions/listen`** (its filter carries `resourceSubscriptions` plus the `resourcesListChanged` opt-in) and resolves on `notifications/subscriptions/acknowledged`. The Subscriptions section then shows a stream-status badge (`Connecting…` → `Listening`) in its header, and reconnects by re-listing if the long-lived stream drops.

The modern config deliberately **omits** `update_resource`. The SDK's modern leg is stateless/per-request (`createMcpHandler(() => createMcpServer(config))`), so the tool would run against a throwaway server instance — the content change wouldn't persist for the next `resources/read`, and its `resources/updated` wouldn't reach the separate listen stream. More confusing than useful.

So the live update-notification round-trip is demonstrated on the legacy (stateful-session) server, and the modern server is for the subscribe/listen/badge behavior. The Inspector's _receive_ path is era-transparent, so a real stateful modern server that routes `resources/updated` onto the listen stream drives the subscribed tile the same way.

## A listen that is never acknowledged

`subscriptions-never-acknowledged-http.json` serves the same three `numbered_resources` on the modern leg. It acknowledges the first `subscriptions/listen` **that subscribes to a resource** normally, and answers every resource-subscription listen after it with a bare JSON-RPC `result` instead of a `notifications/subscriptions/acknowledged`. A listen carrying only list-change opt-ins is always acknowledged — including the one the Inspector opens at connect time ([#1920](https://github.com/modelcontextprotocol/inspector/issues/1920)), which is why the counting is per *resource-subscription* listen: otherwise that connect-time listen spends the allowance before you have clicked anything and the very first Subscribe is refused. Connect with **Protocol Era = Modern**.

That result is not a malformed message. On the 2026-07-28 era the listen request is long-lived, and the `result` for its id is reserved as the [graceful-closure](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions#graceful-closure) marker — so a server sending it up front is saying "acknowledged and closed in the same breath". It is deliberately bare, with no `resultType` discriminator, matching the payload from the original report rather than the spec's example.

Open the Resources tab and **Subscribe** to `resource_1`: an ordinary acknowledged stream, badge **Listening**. Now **Subscribe** to `resource_2`. Changing the filter re-lists, this one is refused, and:

- the subscribe fails with the reason spelled out — *"The server closed the subscription without acknowledging it… Not retrying"*;
- the Subscriptions badge turns an orange **Not acknowledged** and the panel carries the same sentence as a notice;
- the Protocol tab shows exactly **one** further `subscriptions/listen`.

On the broken build that second click produced eight `subscriptions/listen` requests with increasing ids over roughly a minute, the badge flickering `Reconnecting…` between them, and a final bare **Stream ended** that said nothing about why ([#2097](https://github.com/modelcontextprotocol/inspector/issues/2097), split out of [#2063](https://github.com/modelcontextprotocol/inspector/issues/2063), where it read as the Inspector "accepting" an invalid response). The condition is deterministic — the server answers the same way every time — so retrying it is noise, not recovery.

The first resource-subscription listen is acknowledged **so the badge is reachable at all**: it is gated on a live subscription, which a server refusing from the outset never lets you hold. That variant — refuse every listen, the literal shape in the report — is what the integration tests drive; it is the same code path, minus the badge. And `never-acknowledged` is a status of its own rather than **Stream ended** on purpose: `ended` covers the two *expected* closes (a server tearing an established stream down, and reconnection abandoned after repeated failures), and reading a deterministic conformance failure as either of them is the silence the issue is about.

## Tasks, both eras

**Legacy** (`tasks-legacy-http.json`) advertises `capabilities.tasks` (`tasks: { list, cancel }`) with the `simple_task` / `progress_task` / `elicitation_task` presets. Run one of those tools with **Run as task** on, and the **Tasks** tab lists it (populated via `tasks/list`), polls `tasks/get`, fetches the payload with the blocking `tasks/result`, and cancels with `tasks/cancel`.

**Modern** (`tasks-modern-http.json`) sets `transport.modern: true` and `tasksExtension: true`, advertising the `io.modelcontextprotocol/tasks` extension (SEP-2663) and serving `modern_task` / `modern_input_task`. The **Tasks** tab is gated on the negotiated extension, not `capabilities.tasks`.

- Run `modern_task` as a task — the `tools/call` returns a `CreateTaskResult` (`resultType: "task"`, visible in the Protocol/Network tabs), the client polls **`tasks/get`** (no `tasks/list`), and the completed task inlines its result (no blocking `tasks/result`).
- Run `modern_input_task` — the task moves to `input_required`, surfacing an embedded elicitation through the pending-request modal. Answering it sends **`tasks/update`** with the `inputResponses`, and the next poll completes.

SDK v2 removed all tasks support **and** era-gates the `tasks/*` spec methods out of the modern era on both sides. So the Inspector drives the extension itself — the `resultType: "task"` frame is rewritten at the transport into a `CallToolResult` carrying the handle, and `tasks/get` / `update` / `cancel` ride a raw-wire request channel with the full modern envelope. The test server serves `tasks/*` from an Express interceptor ahead of the SDK handler, since the SDK's modern leg would answer them `-32601`.

The Tasks tab's **Refresh** re-polls the handles already known to the client — modern has no server-side task list.

