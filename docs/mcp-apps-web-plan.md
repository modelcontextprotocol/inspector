# MCP Apps support for Web - implementation plan

This document outlines a detailed plan to add MCP Apps support to the web app. The plan is informed by **reading PR 1044** (main implementation), PR 1043 (tests), and PR 1075 (tool-result fix), and by the current client and web codebases.

**As-built (Phase 1 completed):** Phase 1 is implemented. Differences from the original plan are noted in **Section 9 (As-built notes)**. Manual verification: all **19 MCP app servers** in `configs/mcpapps.json` have been verified to work in the web app.

## Phases

- **Phase 1 (initial):** Get to a working version quickly so we can verify MCP apps functionality. Use a **fixed sandbox port (6277)** and pass a **client proxy** from `InspectorClient.getAppRendererClient()` to mcp-ui (see **AppRendererClient** below). Accept the known limitation: when an app is open, mcp-ui's `setNotificationHandler` overwrites InspectorClient's, so Tools/Resources/Prompts list updates may stop until the app is closed—until Phase 2 multiplexing is implemented. No dynamic port, no sandbox API.
- **Phase 2 (follow-on):** Production-ready plumbing. **Dynamic port and on-demand sandbox server** (ephemeral server, bind to port 0 or on-demand start; expose sandbox URL via API). **Notification multiplexing:** use the existing **AppRendererClient** proxy’s `setNotificationHandler` interception to route app handlers to InspectorClient’s multiplexer (`addAppNotificationHandler`), so both InspectorClient and the app receive notifications. Phase 2 removes the single-handler limitation and avoids fixed-port conflicts.

## 1. Context and references

### 1.1 Current state

- **Client package (reference; we are not modifying it):** Has full MCP Apps support:
  - **AppsTab** - lists tools with `_meta.ui.resourceUri`, app selection, input form, open/close/maximize.
  - **AppRenderer** - embeds the app UI via `@mcp-ui/client`'s `McpUiAppRenderer` with sandbox, tool input, and host callbacks.
  - Sandbox URL comes from the MCP proxy: `${getMCPProxyAddress(config)}/sandbox`.
  - Tab is always available; `listTools` is triggered when the Apps tab is active and server supports tools.
- **Web:** Uses InspectorClient + useInspectorClient; has Tools, Resources, Prompts, etc., but **no Apps tab** and no MCP Apps dependencies.

### 1.2 Reference PRs (read and use to inform this plan)

- **PR 1044** - **Main implementation PR.** "Add MCP Apps support to Inspector." Implements detection, listing, and interactive rendering of MCP apps with full bidirectional communication. Details from the PR:
  - **New components:** AppsTab (detects/displays tools with `_meta.ui.resourceUri`), AppRenderer (full MCP App lifecycle, AppBridge integration).
  - **Files added:** `client/src/components/AppsTab.tsx`, `AppRenderer.tsx`, their tests; **server/static/sandbox_proxy.html** - sandbox proxy refactored to match [basic-host](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host): nested iframe for security, `sandbox.ts` logic inlined in the HTML. Served on a **different port** via the proxy (client uses `getMCPProxyAddress(config)` + `/sandbox`). The **server** (Express) already has the `/sandbox` endpoint (rate-limited, no-cache) that serves this file; web only needs to point at the correct sandbox URL (same origin when web is served with that server, or configured base).
  - **Files modified in 1044:** `client/App.tsx` (Apps tab integration, auto-fetch when tab active, resource wiring); **ListPane** - only show Clear button if `clearItems` is passed (AppsTab does not pass it); ListPane.test, AuthDebugger.test (relative imports); client package.json (ext-apps, mcp-ui/client); client jest.config.cjs (ES modules from ext-apps); **server/src/index.ts** (add `/sandbox` endpoint, serve sandbox_proxy.html, rate limiting); server package.json (shx, express-rate-limit, copy static to build).
  - **Features (from PR):** App detection; auto-population when Apps tab becomes active; resource fetching for `ui://` via MCP; MCP-UI AppRenderer integration (client, tool name, resource content, host context); PostMessage transport (JSON-RPC iframe ↔ host); sandboxed rendering with configurable permissions; theme (light/dark); error handling.
  - **Architecture (from PR):** Host: AppsTab → AppRenderer → MCP Client; AppBridge ↔ MCP Server; PostMessage transport; sandboxed iframe (MCP App UI). Use this when porting so web matches the same flow.
  - **Tests in 1044:** AppsTab 18 tests (detection/filtering, grid, refresh, error, selection/deselection, dynamic tool list, resource content). AppRenderer 8 tests (loading, resource fetching, error states, iframe attributes, AppBridge init/connection, JSON/HTML parsing, permissions, lifecycle). PR 1043 added more; mirror coverage in web with Vitest.
  - **PR discussion notes:** Console.logs were left in for debugging; remove or gate when porting. Nested iframe in sandbox addressed CodeQL XSS concerns. Some example servers (budget-allocator, pdf-server, etc.) didn't work initially; budget-allocator is fixed by PR 1075 (tool result). Advanced sandbox permissions may be a follow-up.
- **PR 1043** - Adds comprehensive tests for MCP Apps (AppsTab + AppRenderer). Use for test patterns and Jest config (transform for `@modelcontextprotocol/ext-apps` ESM); adapt to Vitest for web.
- **PR 1075** - Bug fix: Apps tab was missing **tool result** data. Apps received `ui/notifications/tool-input` but not `ui/notifications/tool-result`, breaking apps that depend on initial tool result (e.g. budget allocator). Fix: run tools/call when app/tool input changes, pass result into the iframe via `toolResult` (emits `ui/notifications/tool-result`), with AbortController + run-id for stale-result safety and error fallback (failed tools/call → error result with `isError: true`). **When porting AppRenderer to web, include this tool-result behavior.**

### 1.3 Client dependencies (MCP Apps)

- `@mcp-ui/client` - `AppRenderer` (McpUiAppRenderer), `McpUiHostContext`, `RequestHandlerExtra`.
- `@modelcontextprotocol/ext-apps` - `getToolUiResourceUri` from `app-bridge`; types `McpUiMessageRequest`, `McpUiMessageResult` (used by AppRenderer).

### 1.4 MCP primitives, bridge, and InspectorClient

**What MCP Apps use (ext-apps spec + @mcp-ui/client):**

- **Primitives:** Standard MCP only. The View (iframe) asks the Host to run **resources/read** (including `ui://` URIs for the app HTML) and **tools/call**. The Host bridges by passing the **raw MCP Client** to McpUiAppRenderer; the library calls `client.request({ method: "resources/read", params: { uri } })` and `client.request({ method: "tools/call", params })` on that client. So the transport and primitives are the same connection InspectorClient already uses.
- **Events server → host:** There are no app-specific server notifications. The Host gets tool results from **responses** to tools/call and then pushes `ui/notifications/tool-input` / `ui/notifications/tool-result` to the View over postMessage. So "events" to the app are synthesized by the Host from data it already has.
- **Bidirectional bridge:** Yes. The client (host) must bridge comms back to the server: when the app calls a tool or reads a resource, the Host uses the same MCP connection to perform the request. Web passes **AppRendererClient** from `getAppRendererClient()` to mcp-ui (see 1.5).

**Why we use AppRendererClient (and not the raw Client):**

- The **SDK Client** allows only **one** `setNotificationHandler` per notification method. **InspectorClient** registers handlers in `connect()` for `notifications/tools/list_changed`, etc. **@mcp-ui/client** also registers for those same methods when McpUiAppRenderer mounts. If we passed the raw SDK Client into AppRenderer, mcp-ui's `setNotificationHandler` would overwrite InspectorClient's and list updates would break while an app is open.
- **Solution (implemented):** InspectorClient no longer exposes the raw client. It exposes **`getAppRendererClient()`**, which returns an **AppRendererClient**—a **proxy** that delegates to the internal MCP Client. The proxy **intercepts only `setNotificationHandler`**. In Phase 1 the interception is a pass-through (we can add behavior later). In **Phase 2** we will route intercepted `setNotificationHandler` calls to InspectorClient's multiplexer (`addAppNotificationHandler`) so both InspectorClient and the app receive notifications. Web receives `appRendererClient` from the hook and passes it to AppsTab/AppRenderer.

**Phase 1 vs Phase 2**

- **Phase 1 (as-built):** Web passes **`appRendererClient`** from `useInspectorClient` (which calls `inspectorClient.getAppRendererClient()`) to AppRenderer. The proxy is **cached** in InspectorClient so the same reference is returned for the lifetime of the connection—avoiding React effect loops. Known limitation: when an app is open, mcp-ui's `setNotificationHandler` still overwrites InspectorClient's (interception is pass-through until Phase 2), so Tools/Resources/Prompts lists may not update until the app is closed.
- **Phase 2:** Use the existing **AppRendererClient** proxy’s `setNotificationHandler` hook: instead of forwarding to the internal client, call **`inspectorClient.addAppNotificationHandler(schema, handler)`**. InspectorClient’s single SDK registration (in `connect()`) will dispatch to its own logic and to all handlers registered via `addAppNotificationHandler`. Web already passes the proxy; no change needed. Optional later: shared "is app tool" helper (e.g. wrap `getToolUiResourceUri`).

### 1.5 AppRendererClient proxy and notification multiplexing

**What we implemented:** InspectorClient exposes **`getAppRendererClient(): AppRendererClient | null`**. The return type **AppRendererClient** is a type alias for the MCP SDK `Client`; it denotes the app-renderer–scoped proxy, not the raw client. The hook exposes **`appRendererClient`** (not `client`); web passes **`appRendererClient`** to AppsTab and AppRenderer so it’s clear this is the proxy for the Apps tab only.

**How the proxy works:**

- The proxy is a **JavaScript `Proxy`** around InspectorClient’s internal MCP Client. It **forwards all property/method access** to the internal client (so `callTool`, `listTools`, `readResource`, `request`, etc. behave identically).
- **Only `setNotificationHandler` is intercepted:** the proxy’s `get` handler returns a wrapper that can add behavior before delegating. Currently the wrapper just forwards to the internal client (pass-through). **Phase 2:** change the wrapper to call **`inspectorClient.addAppNotificationHandler(schema, handler)`** instead of forwarding, so app handlers are registered in a list; InspectorClient’s existing SDK registration in `connect()` will be extended to also invoke every handler in that list. Result: both InspectorClient and the app receive list_changed (and any other notifications).
- The proxy is **cached** in InspectorClient (`appRendererClientProxy`). We create it once when first needed (when connected) and return the same instance until disconnect or reconnect. That keeps the reference stable across React renders and prevents effect loops in AppRenderer.

**Phase 2 implementation (remaining):** (1) Expose **`addAppNotificationHandler(notificationSchema, handler)`** (and optionally **`removeAppNotificationHandler`**) on InspectorClient. (2) In the AppRendererClient proxy’s `setNotificationHandler` wrapper, call **`addAppNotificationHandler`** instead of forwarding to the internal client. (3) In `connect()`, when registering the single SDK handler per notification method, have that handler run InspectorClient’s existing logic and then call every handler registered via `addAppNotificationHandler` for that method.

**Result:** Web already calls `inspectorClient.getAppRendererClient()` (via the hook) and passes `appRendererClient` to AppRenderer. Once Phase 2 multiplexing is wired, only the proxy’s `setNotificationHandler` implementation and InspectorClient’s dispatch logic need to change; no web or prop renames required.

---

## 2. High-level approach

- **Reuse behavior and structure** from the client's AppsTab and AppRenderer.
- **Add** the same npm deps to web (`@mcp-ui/client`, `@modelcontextprotocol/ext-apps`).
- **Implement** in web: AppsTab and AppRenderer (copy/adapt from client, including PR 1075 tool-result handling).
- **Phase 1:** Fixed sandbox port (6277); pass **AppRendererClient** from `getAppRendererClient()` (via hook as `appRendererClient`) to mcp-ui; wire Apps tab with fixed sandbox URL.
- **Phase 2:** Dynamic/on-demand sandbox server and sandbox URL API; notification multiplexing via the existing AppRendererClient’s `setNotificationHandler` interception; web already uses the proxy.
- **Tests:** Add web tests for AppsTab and AppRenderer (Vitest), mirroring client coverage where useful; optionally port or adapt client tests.

---

## 3. Prerequisites and dependencies

### 3.1 Web package.json

- Add:
  - `@mcp-ui/client` (match client version, e.g. `^6.0.0`).
  - `@modelcontextprotocol/ext-apps` (e.g. `^1.0.0`).
- Ensure Vitest (and any bundler config) can load these if they ship ESM (see client's Jest transform for `@modelcontextprotocol` in PR 1043).

### 3.2 Sandbox URL for web

- **Spec requirement:** Host and Sandbox must be different origins. The sandbox cannot be same-origin with the web app.
- **Phase 1:** Use a **fixed port (6277)**. Server serves `server/static/sandbox_proxy.html` on port 6277 (e.g. same server as Inspector or a dedicated listener on 6277). Web constructs sandbox URL as `http://<host>:6277` (or from config/base URL) and passes it to AppsTab. No API; no dynamic port.
- **Phase 2:** **Ephemeral sandbox server** - bind to port `0` (OS-assigned) or on-demand start. Expose sandbox base URL via API (e.g. `GET /api/sandbox-url`). Web obtains URL from API and passes to AppsTab. Enables multiple instances and avoids port conflicts.

### 3.3 UI and utils already in web

- Web already has: **ListPane**, **IconDisplay**, **DynamicJsonForm**, **Label**, **Checkbox**, **Select**, **Textarea**, **Input**, **Button**, **Alert**, **Tabs**. No need to copy these from client; use web's existing components and paths (e.g. `@/components/ui/...`, `@/utils/schemaUtils`, `@/utils/jsonUtils`).
- **ListPane (PR 1044):** In the client, ListPane was changed so the Clear button is only shown when a `clearItems` prop is passed. AppsTab does not pass `clearItems`, so the Apps list shows no Clear button. When porting, if web's ListPane currently always shows Clear, update it to match: only show Clear when `clearItems` is provided.

---

## 4. Implementation tasks

### 4.1 Add dependencies (web)

- In `web/package.json`, add:
  - `@mcp-ui/client`
  - `@modelcontextprotocol/ext-apps`
- Run install; fix any type or build issues (e.g. Vite/Vitest handling of these packages).

### 4.2 Sandbox URL (server + web)

- **Phase 1:** **Server:** Ensure `server/static/sandbox_proxy.html` is served on **fixed port 6277** (e.g. add a dedicated HTTP server/listener on 6277 when the Inspector server starts, or serve sandbox on 6277 from the same process). Apply same security as current `/sandbox` (rate limiting, no-cache, referrer validation in HTML). **Web:** Construct sandbox URL as `http://<host>:6277` using the web app's host (or a configured base). Pass it to AppsTab as `sandboxPath`. No API call.
- **Phase 2:** **Server:** Start an ephemeral sandbox server (bind to port `0`) or on-demand; expose URL via `GET /api/sandbox-url`. **Web:** Fetch sandbox URL from API after connect; pass to AppsTab. If API unavailable, show message or disable app iframe.
- **As-built:** The **web app is self-contained**; the legacy server package is not used. Sandbox is served by the web app itself: (1) **Prod:** `web/src/server.ts` (TypeScript) runs both the Hono app on 6274 and a second `createServer` listener on 6277 that serves GET `/sandbox` from `web/static/sandbox_proxy.html`. Same process, same lifecycle. (2) **Dev:** `web/vite.config.ts` plugin starts the sandbox HTTP server on 6277 in the same Node process as Vite. Sandbox HTML is a copy in `web/static/sandbox_proxy.html` (referrer validation in HTML unchanged). No rate limiting added in as-built.

### 4.3 Port AppsTab to web

- **Source:** `client/src/components/AppsTab.tsx`.
- **Target:** `web/src/components/AppsTab.tsx`.
- **Changes:**
  - Replace client-specific imports with web paths:
    - `@/components/ui/tabs`, `@/components/ui/button`, `@/components/ui/alert`, etc. (already in web).
    - `@/utils/jsonUtils`, `@/utils/schemaUtils` (and any schema/param helpers like `generateDefaultValue`, `isPropertyRequired`, `normalizeUnionType`, `resolveRef`) - use web's equivalents; copy from client only if a helper is missing in web.
  - Keep the same props interface in spirit: `sandboxPath`, `tools`, `listTools`, `error`, `appRendererClient`, `onNotification`. Types: `Tool[]`, `AppRendererClient | null` (from `getAppRendererClient()` via the hook), `ServerNotification`.
  - Keep app detection: `getToolUiResourceUri` from `@modelcontextprotocol/ext-apps/app-bridge`; filter tools with `hasUIMetadata`.
  - Keep layout and behavior: ListPane for app list, form for selected app input, AppRenderer when "Open App" is used, maximize/minimize, back to input.
  - Remove or replace any client-only references (e.g. `getMCPProxyAddress`); use the new sandbox helper instead.
- **Console logging:** Client has `console.log("[AppsTab] Filtered app tools", ...)`. Prefer removing or gating behind dev/debug so production web stays quiet.

### 4.4 Port AppRenderer to web (including PR 1075 behavior)

- **Source:** `client/src/components/AppRenderer.tsx` **plus** the behavior from **PR 1075** (tool result forwarding).
- **Target:** `web/src/components/AppRenderer.tsx`.
- **Changes:**
  - Imports: Use web paths for UI (`@/components/ui/alert`, `@/lib/hooks/useToast`), and keep `@mcp-ui/client` and `@modelcontextprotocol/ext-apps` (for types if needed).
  - Props: Same as client: `sandboxPath`, `tool`, `appRendererClient` (type `AppRendererClient | null` from `getAppRendererClient()` via the hook), `toolInput`, `onNotification`. **Add** support for **tool result** (PR 1075): either a `toolResult` prop or an internal call to `callTool` and pass result into `McpUiAppRenderer` so the iframe receives `ui/notifications/tool-result`. Implement:
    - When tool/toolInput (or initial mount) is ready, call MCP `tools/call` with the selected tool and current arguments (if the app expects initial result).
    - Pass the result into the renderer as `toolResult` so the iframe gets `ui/notifications/tool-result`.
    - Use AbortController + run-id (or similar) so that when the user switches app or restarts, stale results are ignored.
    - On tools/call failure, send an error-shaped result (e.g. `isError: true`) to the app so the UI doesn't hang.
  - Host context: Use `document.documentElement.classList.contains("dark")` for theme like client.
  - Callbacks: `onOpenLink`, `onMessage` (toast), `onLoggingMessage` (forward to `onNotification`), `onError` (set local error state).
  - If the client's AppRenderer was updated in a branch for PR 1075 and this repo's client doesn't have it yet, implement the tool-result logic from the PR description when porting.

### 4.5 Wire Apps tab in web App.tsx

- **Tab list:** Add an "Apps" tab (e.g. icon `AppWindow` from lucide-react) with `value="apps"`, placed similarly to client (e.g. after Tools).
- **validTabs:** In every place where `validTabs` is derived (e.g. hash sync and "originating tab" after sampling/requests), add `"apps"` so that:
  - Navigating to `#apps` is valid when connected.
  - When a request completes and restores the originating tab, `"apps"` can be restored.
- **listTools when Apps tab is active:** Add an effect similar to client: when connected and `activeTab === "apps"` and `serverCapabilities?.tools`, call `listTools()`. (As-built: we use `connectionStatus === "connected"` for the connection check.) This keeps the tools list (and thus app tools) up to date when the user opens the Apps tab.
- **Render AppsTab:** Inside the same Tabs content area as Resources/Prompts/Tools, add:
  - `<TabsContent value="apps">` containing `<AppsTab ... />`.
- **AppsTab props:**
  - **Phase 1 (as-built):** `sandboxPath` = fixed URL (e.g. `http://${window.location.hostname}:6277/sandbox`). `appRendererClient={appRendererClient}` where `appRendererClient` is from useInspectorClient (i.e. `getAppRendererClient()`). Accept that Tools/Resources/Prompts list updates may stop while an app is open until Phase 2 multiplexing.
  - **Phase 2:** `sandboxPath={sandboxUrl}` from API (e.g. GET /api/sandbox-url). Same `appRendererClient` from hook; proxy’s `setNotificationHandler` interception will route to multiplexer so both InspectorClient and app receive notifications.
  - Both phases: `tools={inspectorTools}`, `listTools={() => { clearError("tools"); listTools(); }}`, `error={errors.tools}`, `onNotification={(notification) => setNotifications(prev => [...prev, notification])}`. Reuse the same notifications state used elsewhere.

### 4.6 Multiplexed notification handling (Phase 2 only)

- **Design (see 1.5):** The **AppRendererClient** proxy is already implemented in InspectorClient: **`getAppRendererClient()`** returns a cached Proxy that forwards to the internal client and **intercepts `setNotificationHandler`**. Web already passes `appRendererClient` from the hook to AppRenderer. Phase 2 only needs to wire the interception to a multiplexer.
- **Tasks:**
  1. **InspectorClient:** Expose **`addAppNotificationHandler(notificationSchema, handler)`** and optionally **`removeAppNotificationHandler`**. In `connect()`, ensure the single SDK notification registration dispatches to InspectorClient's existing logic and then to every handler registered via `addAppNotificationHandler` for that method.
  2. **AppRendererClient proxy:** In the proxy’s `setNotificationHandler` wrapper (in `getAppRendererClient()`), call **`this.addAppNotificationHandler(schema, handler)`** instead of forwarding to the internal client. App handlers are then in the multiplexer list; InspectorClient’s SDK registration will invoke them.
  3. **Web:** No change; already passes `appRendererClient` from the hook.
- **Scope:** core (InspectorClient multiplexer API and proxy wrapper behavior).
- **Order:** Phase 2; after Phase 1 is working and we want to fix the list-update limitation and add dynamic sandbox.

### 4.7 Optional: Shared helper for "app tool" detection

- If we want a single place for "does this tool have app UI?", we could add in shared (e.g. `shared/mcp/appsUtils.ts` or similar) a function that re-exports or wraps `getToolUiResourceUri` (or implements the same check). Then client and web could both import from shared. Defer unless we want to reduce direct dependency on `@modelcontextprotocol/ext-apps` from both apps.

---

## 5. Testing

### 5.1 Unit tests in web (Vitest)

- **AppsTab:** Add `web/src/components/__tests__/AppsTab.test.tsx`. Cover:
  - No apps available message and `_meta.ui.resourceUri` hint.
  - Filtering to only tools with UI metadata.
  - Grid/list display, selection, open/close, back to input.
  - Refresh (listTools).
  - Error display.
  - Mock AppRenderer and, if needed, `getToolUiResourceUri` (or use real ext-apps).
- **AppRenderer:** Add `web/src/components/__tests__/AppRenderer.test.tsx`. Cover:
  - Waiting state when `appRendererClient` is null.
  - Renders McpUiAppRenderer when client is ready; passes toolName, sandbox, hostContext, toolInput (and toolResult if added).
  - onMessage → toast.
  - Optional: mock tools/call and assert toolResult is passed through (for PR 1075 behavior).
- Use Vitest's equivalent of Jest's module mock for `@mcp-ui/client` and optionally `@modelcontextprotocol/ext-apps` so tests don't load real iframe/sandbox code. Align with how client's AppRenderer.test and AppsTab.test mock these (see client's `__tests__`).

### 5.2 Integration / manual

- After wiring: connect web to a server that exposes tools with `_meta.ui.resourceUri` (e.g. an MCP server that serves app UIs). Open Apps tab, select an app, open it, and confirm the iframe loads and receives tool-input and tool-result (e.g. budget allocator example from ext-apps).

### 5.3 MCP servers for manual testing (ext-apps examples)

The PRs reference example servers from the [ext-apps](https://github.com/modelcontextprotocol/ext-apps) repo for manual testing. Below is a compiled list with MCP server configs (stdio). Source: ext-apps README "Running the Examples" / "With MCP Clients". Inspector uses the same `mcpServers` structure (type `stdio`, `command`, `args`).

**Priority from PRs:** (1) **budget-allocator** – validates tool-result (PR 1075); use as the primary manual test. (2) **pdf**, **transcript**, **video-resource** – mentioned as possibly needing advanced sandbox permissions or follow-ups; test after budget-allocator.

**Recommended first test (budget-allocator):**

```json
"budget-allocator": {
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "--silent", "--registry=https://registry.npmjs.org/", "@modelcontextprotocol/server-budget-allocator", "--stdio"]
}
```

**Other ext-apps example servers (same stdio pattern; replace package name in args):**

| Server key            | NPM package                                        |
| --------------------- | -------------------------------------------------- |
| budget-allocator      | @modelcontextprotocol/server-budget-allocator      |
| pdf                   | @modelcontextprotocol/server-pdf                   |
| transcript            | @modelcontextprotocol/server-transcript            |
| video-resource        | @modelcontextprotocol/server-video-resource        |
| map                   | @modelcontextprotocol/server-map                   |
| threejs               | @modelcontextprotocol/server-threejs               |
| shadertoy             | @modelcontextprotocol/server-shadertoy             |
| sheet-music           | @modelcontextprotocol/server-sheet-music           |
| wiki-explorer         | @modelcontextprotocol/server-wiki-explorer         |
| cohort-heatmap        | @modelcontextprotocol/server-cohort-heatmap        |
| customer-segmentation | @modelcontextprotocol/server-customer-segmentation |
| scenario-modeler      | @modelcontextprotocol/server-scenario-modeler      |
| system-monitor        | @modelcontextprotocol/server-system-monitor        |
| basic-react           | @modelcontextprotocol/server-basic-react           |
| basic-vanillajs       | @modelcontextprotocol/server-basic-vanillajs       |

For each: `"type": "stdio", "command": "npx", "args": ["-y", "--silent", "--registry=https://registry.npmjs.org/", "<package>", "--stdio"]`.

**How to run:** Add one or more entries to your MCP server config (Inspector config file or UI), then connect and open the Apps tab. To run from a local ext-apps clone, see the "Local Development" section in the [ext-apps README](https://github.com/modelcontextprotocol/ext-apps) (build and run from `examples/budget-allocator-server`, etc.).

**As-built:** Inspector config files for manual testing live in **`configs/`**. **`configs/mcpapps.json`** contains 19 MCP app server entries. **Manual verification:** All 19 servers in `configs/mcpapps.json` have been verified to work in the web app (Apps tab, open app, load and interact).

---

## 6. Order of work (suggested)

**Phase 1 (working MCP apps sooner)**

1. Add deps (4.1).
2. Sandbox on fixed port 6277 (4.2 Phase 1): server serves sandbox_proxy.html on 6277; web uses `http://<host>:6277` as sandboxPath.
3. Port AppRenderer (4.4), including tool-result behavior from PR 1075, and add tests (5.1).
4. Port AppsTab (4.3) and add tests (5.1).
5. Wire Apps tab in App (4.5 Phase 1): add tab, validTabs, listTools effect; pass fixed sandbox URL and `appRendererClient` from useInspectorClient (getAppRendererClient()) to AppsTab.
6. Manual check with an MCP server that has app tools (5.2). Verify apps load and work; accept that list updates may stall while an app is open.

**Phase 2 (release plumbing)**

7. Ephemeral/dynamic sandbox server and sandbox URL API (4.2 Phase 2); web fetches sandbox URL from API.
8. Multiplexed notification handling (4.6): implement addAppNotificationHandler and wire the AppRendererClient proxy’s setNotificationHandler to it; web already passes appRendererClient.
9. Optional: shared app-tool helper (4.7) and cleanup (e.g. remove debug logs).

---

## 7. Risks and mitigations

- **Phase 1 - Fixed port 6277:** If port 6277 is already in use, sandbox will fail to start. Document the requirement; Phase 2 (dynamic port) avoids this.
- **Sandbox origin/CSP:** The sandbox runs on a different origin (fixed 6277 in Phase 1; random port in Phase 2). Ensure the sandbox HTML's referrer allowlist (e.g. in `sandbox_proxy.html`) includes the web app's origin when deployed; document if the allowlist must be configured per environment.
- **PR 1075 not in tree:** When porting AppRenderer to web, if the source we port from doesn't yet have the tool-result fix, implement it when porting AppRenderer so web doesn't ship without it (budget-allocator and similar apps depend on it).
- **ESM in tests:** If `@modelcontextprotocol/ext-apps` or `@mcp-ui/client` are ESM-only, configure Vitest (or Vite) to transform them like the client's Jest config (PR 1043) so tests run.
- **Known example gaps (from PR 1044):** Some ext-apps example servers did not work in the first cut (e.g. budget-allocator fixed by 1075; pdf-server, transcript-server, video-resource-server may need advanced sandbox permissions or other follow-ups). Plan for the same "first cut" scope; document known limitations if needed.

---

## 8. Summary checklist

**Phase 1** (all complete)

- [x] Add `@mcp-ui/client` and `@modelcontextprotocol/ext-apps` to web (4.1).
- [x] Serve sandbox on fixed port 6277 (4.2 Phase 1); web uses fixed sandbox URL. As-built: web app serves its own sandbox on 6277 in the same process (see Section 9).
- [x] Port AppRenderer to web with tool-result support from PR 1075 (4.4).
- [x] Port AppsTab to web (4.3); remove or gate console.log (per PR 1044 discussion).
- [x] ListPane: only show Clear when `clearItems` passed (optional prop); AppsTab does not pass it (3.3 / PR 1044).
- [x] Add "Apps" tab and validTabs entries in web App; pass appRendererClient (from getAppRendererClient() via hook) and fixed sandbox URL (4.5 Phase 1).
- [x] Effect: listTools when activeTab === "apps" and server has tools (4.5).
- [x] Add Vitest tests for AppsTab and AppRenderer (5.1); parity with client test count (AppsTab 20 tests, AppRenderer 5 tests).
- [x] Manual test with app-capable servers (5.2): all 19 servers in `configs/mcpapps.json` verified in web app.

**Phase 2**

- [ ] Ephemeral/dynamic sandbox server and sandbox URL API (4.2 Phase 2); web consumes API.
- [ ] Notification multiplexer (4.6): addAppNotificationHandler + wire AppRendererClient’s setNotificationHandler to it; web already passes appRendererClient.
- [ ] Optional: shared app-tool helper (4.7) and cleanup.

---

## 9. As-built notes (Phase 1)

Summary of how Phase 1 was actually implemented where it differed from the plan.

- **Sandbox (4.2):** The web app is self-contained. The legacy server package does not run. Sandbox is served by the web app on fixed port 6277 in the **same process**: (1) **Production:** `web/src/server.ts` (TypeScript) compiles to `dist/server.js`. It starts the Hono app on 6274 and a second `http.createServer` on 6277 that serves GET `/sandbox` and GET `/sandbox/` with `web/static/sandbox_proxy.html` (no-cache headers; referrer validation is in the HTML). (2) **Development:** The Vite plugin in `web/vite.config.ts` starts the same sandbox HTTP server on 6277 when the dev server runs. Sandbox HTML was copied into `web/static/sandbox_proxy.html`. Rate limiting was not added in the as-built implementation.
- **Web server in TypeScript:** The app server lives in `web/src/server.ts` (TypeScript), built with `tsc -p tsconfig.server.json` and emitted as `dist/server.js`. `web/bin/server.js` was removed. `bin/start.js` (the only remaining JS in bin) spawns `dist/server.js` for prod.
- **Sandbox URL in app:** `sandboxPath` is `http://${window.location.hostname}:6277/sandbox` (Phase 1 fixed URL).
- **ListPane:** `clearItems` is optional; the Clear button is only rendered when `clearItems` is provided. AppsTab does not pass `clearItems`.
- **AppRenderer tool-result (PR 1075):** On mount/update, when `appRendererClient`, `tool`, and `toolInput` are set, we call `appRendererClient.callTool({ name, arguments })` and pass the result to `McpUiAppRenderer` as `toolResult`. A run-id ref is used to ignore stale results; on failure we pass an error-shaped result so the app UI does not hang.
- **AppRendererClient and handler interception:** InspectorClient no longer exposes the raw MCP client. It exposes **`getAppRendererClient(): AppRendererClient | null`**. The hook returns **`appRendererClient`** (so naming is consistent in web). The AppRendererClient is a **cached** JavaScript Proxy around the internal client: same instance for the lifetime of the connection (cleared on disconnect and when creating a new client), so React dependency arrays stay stable and the Apps tab does not loop. The proxy forwards all methods; **only `setNotificationHandler` is intercepted**. The interceptor currently passes through to the internal client. Phase 2 will change it to call **`addAppNotificationHandler`** so both InspectorClient and the app receive notifications and list updates continue while an app is open.
- **Configs:** `configs/` holds Inspector config files for manual testing. `configs/mcpapps.json` has 19 MCP app server entries, `configs/mcp.json` has other sample servers. Root `mcp.json` is gitignored via `/mcp.json` (root only); configs in `configs/` are committed.
- **Manual verification:** All 19 MCP app servers in `configs/mcpapps.json` have been manually verified to work in the web app (connect, open Apps tab, select app, open and interact).
