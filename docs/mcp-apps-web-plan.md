# MCP Apps support for Web - implementation plan

This document outlines a detailed plan to add MCP Apps support to the web app. The plan is informed by **reading PR 1044** (main implementation), PR 1043 (tests), and PR 1075 (tool-result fix), and by the current client and web codebases.

**As-built (Phase 1 completed):** Phase 1 is implemented. Differences from the original plan are noted in **Section 9 (As-built notes)**. Manual verification: all **19 MCP app servers** in `test/mcpapps.json` have been verified to work in the web app.

## Phases

- **Phase 1 (initial):** Get to a working version quickly so we can verify MCP apps functionality. Use a **fixed sandbox port (6277)** and pass the **raw MCP Client** from `InspectorClient.getClient()` to mcp-ui. Accept the known limitation: when an app is open, mcp-ui's `setNotificationHandler` overwrites InspectorClient's, so Tools/Resources/Prompts list updates may stop until the app is closed. No proxy, no dynamic port, no sandbox API.
- **Phase 2 (follow-on):** Production-ready plumbing. **Dynamic port and on-demand sandbox server** (ephemeral server, bind to port 0 or on-demand start; expose sandbox URL via API). **Client proxy** via `InspectorClient.getAppClient()` that intercepts `setNotificationHandler` and multiplexes so both InspectorClient and the app receive notifications. Phase 2 removes the single-handler limitation and avoids fixed-port conflicts.

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
- **Bidirectional bridge:** Yes. The client (host) must bridge comms back to the server: when the app calls a tool or reads a resource, the Host uses the same MCP connection to perform the request. **Phase 1** passes the raw Client from `getClient()` to mcp-ui. **Phase 2** passes a Client proxy from `getAppClient()` (see 1.5).

**Why the plan said "no InspectorClient changes" (and why that's incomplete):**

- At the **API** level, InspectorClient already exposes `getClient()`, `getTools()`, `listTools()`, and the hook exposes `tools`, `client`, and listTools-style usage. So for "can the app layer call resources/read and tools/call?" the answer is yes, via the existing Client.
- **But:** The **SDK Client** allows only **one** `setNotificationHandler` per notification method. **InspectorClient** registers handlers in `connect()` for `notifications/tools/list_changed`, etc. **@mcp-ui/client** also registers for those same methods when McpUiAppRenderer mounts. If we pass the raw SDK Client (`getClient()`) into AppRenderer (Phase 1), mcp-ui's `setNotificationHandler` overwrites InspectorClient's and list updates break while an app is open. **Phase 2 fix:** Use a Client proxy from `getAppClient()` that routes `setNotificationHandler` into InspectorClient's multiplexer (see 1.5). The client package uses useConnection and a separate MCP client, not InspectorClient, so it has the same single-handler bug when an app is open.

**Phase 1 vs Phase 2**

- **Phase 1:** Web passes **`inspectorClient.getClient()`** directly to AppRenderer. Simple and gets MCP apps working. Known limitation: when an app is open, mcp-ui's `setNotificationHandler` overwrites InspectorClient's, so Tools/Resources/Prompts lists may not update until the app is closed.
- **Phase 2:** InspectorClient exposes **`getAppClient()`** that returns a Client-shaped proxy. The proxy forwards most calls to the internal client and **intercepts only `setNotificationHandler`**, routing it to InspectorClient's multiplexer (`addAppNotificationHandler`). InspectorClient's single SDK registration then dispatches to its own logic and to all app handlers. Web passes the proxy so both InspectorClient and the app receive list_changed. Optional later: shared "is app tool" helper (e.g. wrap `getToolUiResourceUri`).

### 1.5 Client proxy and notification multiplexing (Phase 2)

**What mcp-ui actually calls:** In addition to `request()`, `setNotificationHandler()`, and `getServerCapabilities()`, mcp-ui **calls `listTools()`** and **`readResource()`**. So the proxy must implement the full `Client` interface (typed as `Client`). We implement it in a way that allows interception where needed.

**Phase 2 implementation plan:** InspectorClient exposes **`getAppClient()`** that returns a Client-typed proxy. The proxy can be implemented however we like:

- **First cut:** The proxy **forwards most methods to InspectorClient's internal client** (the same instance used by InspectorClient). So we don't have to add request(), ping(), complete(), listTools(), readResource(), etc. to InspectorClient's public API; the proxy just passes through. **Only `setNotificationHandler` is intercepted:** the proxy does not forward it to the internal client. Instead it calls `inspectorClient.addAppNotificationHandler(schema, handler)`, so app-layer handlers are added to a list. InspectorClient's single SDK registration (in `connect()`) already runs its own logic; we extend it to also invoke every handler in that app-layer list. Result: full Client interface, minimal InspectorClient API surface, handler conflict fixed.
- **Later (optional):** We can change the proxy to delegate only to InspectorClient's public methods (no direct use of the internal client) if we want to hide the client entirely; that would require exposing whatever Client methods are needed on InspectorClient.

**InspectorClient changes:** (1) Expose **`getAppClient()`** that returns the Client proxy (the proxy holds a reference to the internal client and to InspectorClient for the multiplexer). (2) Expose **`addAppNotificationHandler(notificationSchema, handler)`** and optionally **`removeAppNotificationHandler`**. (3) In `connect()`, when registering the single SDK handler per notification method, have that handler run InspectorClient's existing logic and then call every handler registered via `addAppNotificationHandler` for that method.

**Result:** Web calls `inspectorClient.getAppClient()` and passes the result to AppRenderer. The proxy is a full `Client`; only setNotificationHandler is intercepted so both InspectorClient and the app receive list_changed (and any other notifications).

---

## 2. High-level approach

- **Reuse behavior and structure** from the client's AppsTab and AppRenderer.
- **Add** the same npm deps to web (`@mcp-ui/client`, `@modelcontextprotocol/ext-apps`).
- **Implement** in web: AppsTab and AppRenderer (copy/adapt from client, including PR 1075 tool-result handling).
- **Phase 1:** Fixed sandbox port (6277); pass `getClient()` to mcp-ui; wire Apps tab with fixed sandbox URL.
- **Phase 2:** Dynamic/on-demand sandbox server and sandbox URL API; Client proxy via `getAppClient()`; web uses proxy and API sandbox URL.
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
  - Keep the same props interface in spirit: `sandboxPath`, `tools`, `listTools`, `error`, `mcpClient`, `onNotification`. Types: `Tool[]`, `Client | null` (Phase 1: from `getClient()`; Phase 2: from `getAppClient()` proxy), `ServerNotification`.
  - Keep app detection: `getToolUiResourceUri` from `@modelcontextprotocol/ext-apps/app-bridge`; filter tools with `hasUIMetadata`.
  - Keep layout and behavior: ListPane for app list, form for selected app input, AppRenderer when "Open App" is used, maximize/minimize, back to input.
  - Remove or replace any client-only references (e.g. `getMCPProxyAddress`); use the new sandbox helper instead.
- **Console logging:** Client has `console.log("[AppsTab] Filtered app tools", ...)`. Prefer removing or gating behind dev/debug so production web stays quiet.

### 4.4 Port AppRenderer to web (including PR 1075 behavior)

- **Source:** `client/src/components/AppRenderer.tsx` **plus** the behavior from **PR 1075** (tool result forwarding).
- **Target:** `web/src/components/AppRenderer.tsx`.
- **Changes:**
  - Imports: Use web paths for UI (`@/components/ui/alert`, `@/lib/hooks/useToast`), and keep `@mcp-ui/client` and `@modelcontextprotocol/ext-apps` (for types if needed).
  - Props: Same as client: `sandboxPath`, `tool`, `mcpClient` (type `Client | null` - Phase 1: from `getClient()`; Phase 2: from `getAppClient()` proxy), `toolInput`, `onNotification`. **Add** support for **tool result** (PR 1075): either a `toolResult` prop or an internal call to `callTool` and pass result into `McpUiAppRenderer` so the iframe receives `ui/notifications/tool-result`. Implement:
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
- **listTools when Apps tab is active:** Add an effect similar to client: when `mcpClient && activeTab === "apps" && serverCapabilities?.tools`, call `listTools()`. This keeps the tools list (and thus app tools) up to date when the user opens the Apps tab.
- **Render AppsTab:** Inside the same Tabs content area as Resources/Prompts/Tools, add:
  - `<TabsContent value="apps">` containing `<AppsTab ... />`.
- **AppsTab props:**
  - **Phase 1:** `sandboxPath` = fixed URL (e.g. `http://${window.location.hostname}:6277` or from config). `mcpClient={mcpClient}` where `mcpClient` is from useInspectorClient's `client` (i.e. `getClient()`). Accept that Tools/Resources/Prompts list updates may stop while an app is open.
  - **Phase 2:** `sandboxPath={sandboxUrl}` from API (e.g. GET /api/sandbox-url). `mcpClient={inspectorClient.getAppClient()}` so mcp-ui gets the proxy and both InspectorClient and app receive notifications.
  - Both phases: `tools={inspectorTools}`, `listTools={() => { clearError("tools"); listTools(); }}`, `error={errors.tools}`, `onNotification={(notification) => setNotifications(prev => [...prev, notification])}`. Reuse the same notifications state used elsewhere.

### 4.6 Implement Client proxy and multiplexed notification handling (Phase 2 only)

- **Design (see 1.5):** InspectorClient exposes **`getAppClient()`** returning a Client proxy. The proxy forwards most methods to InspectorClient's internal client; only **`setNotificationHandler`** is intercepted and routed to **`addAppNotificationHandler`**. No need to expose request(), ping(), listTools(), etc. on InspectorClient.
- **Tasks:**
  1. **Client proxy in shared** (e.g. `shared/mcp/clientProxy.ts` or similar): Class that holds a reference to the internal Client (from InspectorClient) and to InspectorClient. Implements the full `Client` interface by forwarding each method to the internal client, **except** `setNotificationHandler`, which calls `inspectorClient.addAppNotificationHandler(schema, handler)` instead.
  2. **InspectorClient:** Expose **`getAppClient()`** (returns the proxy, created with a reference to the internal client and to this). Expose **`addAppNotificationHandler(notificationSchema, handler)`** and optionally **`removeAppNotificationHandler`**. In `connect()`, ensure the single SDK notification registration dispatches to InspectorClient's existing logic and then to every handler in the app-layer list for that method.
  3. **Web:** Switch from passing `getClient()` to passing `inspectorClient.getAppClient()` to AppRenderer.
- **Scope:** shared (Client proxy class, InspectorClient multiplexer API); web (use getAppClient() instead of getClient() for Apps tab).
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
  - Waiting state when `mcpClient` is null.
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

**As-built:** Test config files for manual testing live in the top-level **`test/`** directory. **`test/mcpapps.json`** contains 19 MCP app server entries. **Manual verification:** All 19 servers in `test/mcpapps.json` have been verified to work in the web app (Apps tab, open app, load and interact).

---

## 6. Order of work (suggested)

**Phase 1 (working MCP apps sooner)**

1. Add deps (4.1).
2. Sandbox on fixed port 6277 (4.2 Phase 1): server serves sandbox_proxy.html on 6277; web uses `http://<host>:6277` as sandboxPath.
3. Port AppRenderer (4.4), including tool-result behavior from PR 1075, and add tests (5.1).
4. Port AppsTab (4.3) and add tests (5.1).
5. Wire Apps tab in App (4.5 Phase 1): add tab, validTabs, listTools effect; pass fixed sandbox URL and `mcpClient` from useInspectorClient (getClient()) to AppsTab.
6. Manual check with an MCP server that has app tools (5.2). Verify apps load and work; accept that list updates may stall while an app is open.

**Phase 2 (release plumbing)**

7. Ephemeral/dynamic sandbox server and sandbox URL API (4.2 Phase 2); web fetches sandbox URL from API.
8. Client proxy and multiplexed notification handling (4.6); web passes getAppClient() to AppsTab instead of getClient().
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
- [x] Add "Apps" tab and validTabs entries in web App; pass getClient() and fixed sandbox URL (4.5 Phase 1).
- [x] Effect: listTools when activeTab === "apps" and server has tools (4.5).
- [x] Add Vitest tests for AppsTab and AppRenderer (5.1); parity with client test count (AppsTab 20 tests, AppRenderer 5 tests).
- [x] Manual test with app-capable servers (5.2): all 19 servers in `test/mcpapps.json` verified in web app.

**Phase 2**

- [ ] Ephemeral/dynamic sandbox server and sandbox URL API (4.2 Phase 2); web consumes API.
- [ ] Client proxy and InspectorClient multiplexer (4.6); web passes getAppClient() to AppsTab/AppRenderer.
- [ ] Optional: shared app-tool helper (4.7) and cleanup.

---

## 9. As-built notes (Phase 1)

Summary of how Phase 1 was actually implemented where it differed from the plan.

- **Sandbox (4.2):** The web app is self-contained. The legacy server package does not run. Sandbox is served by the web app on fixed port 6277 in the **same process**: (1) **Production:** `web/src/server.ts` (TypeScript) compiles to `dist/server.js`. It starts the Hono app on 6274 and a second `http.createServer` on 6277 that serves GET `/sandbox` and GET `/sandbox/` with `web/static/sandbox_proxy.html` (no-cache headers; referrer validation is in the HTML). (2) **Development:** The Vite plugin in `web/vite.config.ts` starts the same sandbox HTTP server on 6277 when the dev server runs. Sandbox HTML was copied into `web/static/sandbox_proxy.html`. Rate limiting was not added in the as-built implementation.
- **Web server in TypeScript:** The app server lives in `web/src/server.ts` (TypeScript), built with `tsc -p tsconfig.server.json` and emitted as `dist/server.js`. `web/bin/server.js` was removed. `bin/start.js` (the only remaining JS in bin) spawns `dist/server.js` for prod.
- **Sandbox URL in app:** `sandboxPath` is `http://${window.location.hostname}:6277/sandbox` (Phase 1 fixed URL).
- **ListPane:** `clearItems` is optional; the Clear button is only rendered when `clearItems` is provided. AppsTab does not pass `clearItems`.
- **AppRenderer tool-result (PR 1075):** On mount/update, when `mcpClient`, `tool`, and `toolInput` are set, we call `mcpClient.callTool({ name, arguments })` and pass the result to `McpUiAppRenderer` as `toolResult`. A run-id ref is used to ignore stale results; on failure we pass an error-shaped result so the app UI does not hang.
- **Test configs:** Top-level `test/` holds config files for manual testing. `test/mcpapps.json` has 19 MCP app server entries. Root `mcp.json` is gitignored via `/mcp.json` (root only) so `test/mcp.json` and `test/mcpapps.json` are committed.
- **Manual verification:** All 19 MCP app servers in `test/mcpapps.json` have been manually verified to work in the web app (connect, open Apps tab, select app, open and interact).
