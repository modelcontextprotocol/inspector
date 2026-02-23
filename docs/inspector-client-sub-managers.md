# InspectorClient: Sub-Manager Extraction Strategy

This document explains why extracting focused sub-managers that `InspectorClient` delegates to is the right approach for managing the class’s size and complexity, and summarizes the recommended extractions and what would remain in the main class.

---

## Why Sub-Managers (Delegation), Not Multiple Client Classes

### Single entry point and lifecycle

Consumers (web app, CLI, TUI) expect **one** client object: one `connect()` / `disconnect()`, one place to pass environment (transport, fetch, logger, OAuth). Splitting into multiple public classes (e.g. `InspectorClient`, `InspectorOAuthClient`, `InspectorTasksClient`) would force callers to construct and wire several objects and to think about which class owns the connection. The current “one client, many methods” API is coherent and should stay.

### Shared state and the SDK Client

The MCP SDK `Client` is the single handle to the protocol. Lists (tools, resources, prompts, etc.), OAuth state, and task caches all ultimately depend on that connection and on the same event stream. If we split `InspectorClient` into multiple _public_ classes, we would have to either:

- Give each class a reference to the same SDK `Client` and duplicate coordination (who connects? who owns lists?), or
- Introduce a “coordinator” that holds the client and the sub-clients, which is just the current `InspectorClient` under another name.

So the natural design is **one facade object** that owns the SDK client and the connection, and **internal** helpers that it delegates to. Those helpers receive only what they need (callbacks, adapters, config) and do not become separate public APIs.

### Clear boundaries without fragmenting the API

Sub-managers are **internal** implementation details. Each manager has a narrow responsibility (receiver tasks, OAuth, requestor tasks, tracking, etc.) and is given explicit dependencies (e.g. “call this to send a notification,” “call this to get request options”). The public API stays on `InspectorClient`: the same methods, the same types, the same single object. Callers do not see or depend on the managers.

### Testability and change isolation

Managers can be unit-tested in isolation with mocks for the adapter/callback. Changes to OAuth flow or task handling are confined to one module instead of a 3,400-line file. The main class becomes mostly wiring and delegation, which is easier to review and reason about.

### Summary

- **Do not** split `InspectorClient` into multiple public client classes or interfaces that consumers must assemble.
- **Do** extract internal sub-managers that own specific state and behavior; `InspectorClient` keeps the single public API and delegates to them.

---

## Recommended Sub-Managers (Priority Order)

### 1. ReceiverTaskManager

**Responsibility:** Server-initiated tasks: create task record, TTL cleanup, hold payload promise, upsert/cancel, and notify the server of status.

**State:** `receiverTaskRecords` map, TTL config.

**Methods:** `createReceiverTask`, `emitReceiverTaskStatus`, `upsertReceiverTask`, `getReceiverTask`, `listReceiverTasks`, `getReceiverTaskPayload`, `cancelReceiverTask` (and `isTerminalTaskStatus` if kept as shared util).

**Interface:** Constructor takes `{ ttlMs, onEmitStatus: (task) => void, logger? }`. API: `create(opts)`, `get(taskId)`, `list()`, `getPayload(taskId)`, `upsert(task)`, `cancel(taskId)`.

**Usage:** Created in constructor (or first `connect()`). Message/elicit handlers in `connect()` call `receiverTaskManager.create(...)` and use the record; `tasks/get`, `tasks/cancel`, and initialize `tasks/list` handlers delegate to the manager. Manager calls `onEmitStatus` to send status notifications (InspectorClient implements that with `this.client.notification(...)`).

---

### 2. OAuthManager (OAuthFlowManager)

**Responsibility:** OAuth config and all OAuth flow orchestration (normal and guided), using existing `OAuthStateMachine` and `BaseOAuthClientProvider`.

**State:** `oauthConfig`, `oauthStateMachine`, `oauthState`.

**Methods:** `setOAuthConfig`, `authenticate`, `beginGuidedAuth`, `runGuidedAuth`, `setGuidedAuthorizationCode`, `completeOAuthFlow`, `getOAuthTokens`, `clearOAuthTokens`, `isOAuthAuthorized`, `getOAuthState`, `getOAuthStep`, `proceedOAuthStep`, and the private `createOAuthProvider` / `getServerUrl` (or a callback).

**Interface:** Constructor takes `getServerUrl`, `fetch`, `logger`, `getEventTarget`, and OAuth env (storage, navigation, redirectUrlProvider). Same public method signatures as today.

**Usage:** InspectorClient holds `oauthManager` when `options.oauth` is present. All public OAuth methods delegate to the manager. `getServerUrl` is implemented on InspectorClient and passed in.

---

### 3. RequestorTaskManager

**Responsibility:** Cache of client-initiated tasks and delegation to the SDK for get/result/cancel/list.

**State:** `trackedRequestorTasks` map.

**Methods:** `getRequestorTask`, `getRequestorTaskResult`, `cancelRequestorTask`, `listRequestorTasks`, and the internal `upsertTrackedRequestorTask` (and the notification handler that calls it).

**Interface:** Constructor takes a `RequestorTaskAdapter` (getTask, getTaskResult, cancelTask, listTasks) and dispatch callbacks for `taskStatusChange`, `taskCancelled`, `tasksChange`. API: same public methods plus `upsert(task)` for the notification handler.

**Usage:** InspectorClient implements the adapter (delegating to `this.client.experimental.tasks.*` and `getRequestOptions`). Task notification handler calls `requestorTaskManager.upsert(task)`. Public requestor-task methods delegate to the manager.

---

### 4. TrackingManager

**Responsibility:** Hold and trim the three observable lists (messages, stderrLogs, fetchRequests), add entries, and dispatch the corresponding events.

**State:** `messages`, `stderrLogs`, `fetchRequests`, and their max limits.

**Methods:** `addMessage`, `updateMessageResponse`, `addStderrLog`, `addFetchRequest`, `getMessages`, `getStderrLogs`, `getFetchRequests`.

**Interface:** Constructor takes `{ maxMessages, maxStderrLogEvents, maxFetchRequests, dispatch, logger? }`. API: add/update/get for each list.

**Usage:** Message-tracking, stderr, and fetch callbacks call into the manager. Getters delegate to the manager.

---

### 5. PendingSamplesElicitationManager

**Responsibility:** Hold pending sampling and elicitation requests and notify when they change.

**State:** `pendingSamples`, `pendingElicitations`.

**Methods:** `getPendingSamples`, `addPendingSample`, `removePendingSample`, `getPendingElicitations`, `addPendingElicitation`, `removePendingElicitation`.

**Interface:** Constructor takes a dispatch callback. API: get/add/remove for each list.

**Usage:** InspectorClient holds the manager and delegates all six methods.

---

### 6. ListSyncManager (ListStateManager)

**Responsibility:** Own cached lists (tools, resources, resourceTemplates, prompts, roots) and the “list” / “listAll” behavior: call SDK, update cache, dispatch list-changed events.

**State:** `tools`, `resources`, `resourceTemplates`, `prompts`, `roots`, `listChangedNotifications`.

**Methods:** All list getters/clears and all `listTools`, `listAllTools`, `listResources`, `listAllResources`, `listResourceTemplates`, `listAllResourceTemplates`, `listPrompts`, `listAllPrompts`, `getRoots`, `setRoots`, and any list-only helpers (e.g. `getToolByName` if it only touches these lists).

**Interface:** Constructor takes an adapter (SDK client + `getRequestOptions`) and dispatch. Manager implements all list/listAll/get/clear/setRoots and dispatches the appropriate events.

**Usage:** InspectorClient implements the adapter and delegates all list/roots methods and getters to the manager.

---

### 7. SessionManager

**Responsibility:** Persist and restore `InspectorClientSessionState` (e.g. fetch requests + timestamps) for a given session id.

**State:** None beyond what is passed in; session shape is defined by the client.

**Methods:** The logic inside `saveSession` and `restoreSession` (build/accept state, call storage, error handling and logging).

**Interface:** Constructor takes `InspectorClientStorage` and optional `logger`. API: `saveSession(sessionId, state)`, `loadSession(sessionId)`.

**Usage:** InspectorClient has `getSessionState()` (e.g. from TrackingManager) and `applySessionState(state)`. `saveSession()` / `restoreSession()` call the manager and then get/apply state.

---

## What Remains in InspectorClient

After extraction, InspectorClient would retain:

**Lifecycle and transport**

- Constructor: validate options, create sub-managers (injecting adapters/callbacks), initialize content cache, set config flags.
- `connect()`: create transport (and optionally wrap with `MessageTrackingTransport`), attach listeners, register protocol request/notification handlers (which call into ReceiverTaskManager, etc.), run initialize, set up list-changed and other handlers.
- `disconnect()`: close transport, clear transport/client references, clear or reset managers as needed.

**SDK client and environment**

- Owning the MCP SDK `Client` instance and the transport (`Transport | MessageTrackingTransport`, `baseTransport`).
- `getRequestOptions()`, `buildEffectiveAuthFetch()`, and any other small helpers used by multiple managers or by `connect()`.

**Thin public API (delegation)**

- All existing public methods remain on InspectorClient; most become one-liners that delegate to the appropriate manager (OAuth, requestor tasks, list sync, tracking, pending, session) or to the SDK client (ping, callTool, readResource, getPrompt, getCompletions, subscribe/unsubscribe, setLoggingLevel, etc.).
- Getters that today return instance fields instead return the corresponding manager’s getter (e.g. `getTools()` → `listSyncManager.getTools()`).

**Protocol and app-renderer wiring**

- Registration of request/notification handlers in `connect()` that coordinate with ReceiverTaskManager (createMessage/elicit with task, tasks/get, tasks/cancel, tasks/list).
- `getAppRendererClient()` (proxy over the SDK client for the Apps tab).
- Any remaining “glue” that routes SDK or transport events into the right manager (e.g. list_changed notifications into ListSyncManager, task notifications into RequestorTaskManager).

**Content cache**

- The content cache (`ContentCache` / `ReadOnlyContentCache`) can stay on InspectorClient and be populated by `readResource`, `getPrompt`, etc.; those methods may call into ListSyncManager only when they need current list state, or the cache may remain independent.

**Roots and subscriptions**

- If not moved into ListSyncManager, `getRoots` / `setRoots` and resource subscribe/unsubscribe stay as small wrappers around the SDK client; otherwise they live inside ListSyncManager and are delegated.

**Session id and restore**

- `getSessionId()`, `setSessionId()`, and the decision of when to call `restoreSession()` (e.g. after connect) remain on InspectorClient; the actual persist/load is in SessionManager.

In other words: **InspectorClient remains the single public facade**. It owns the connection, the SDK client, and the wiring; it creates and holds the sub-managers and delegates almost all domain behavior to them.

---

## Rough Code Impact

- **Current:** ~3,400 lines in a single class (constructor, ~80+ methods, ~50+ instance fields).
- **Moved out (rough):**
  - ReceiverTaskManager: ~100–120 lines.
  - OAuthManager: ~350–400 lines (all OAuth methods and state).
  - RequestorTaskManager: ~100–120 lines.
  - TrackingManager: ~90–100 lines.
  - PendingSamplesElicitationManager: ~40–50 lines.
  - ListSyncManager: ~700–900 lines (all list/listAll/get/clear/setRoots and related state).
  - SessionManager: ~60–80 lines (save/restore logic; get/apply state may add a bit on the client side).
- **Total moved:** on the order of **1,450–1,770 lines** into dedicated modules.
- **Remaining in InspectorClient:** on the order of **1,650–1,950 lines**—constructor and setup, `connect()` / `disconnect()` and handler registration, `getRequestOptions()` and similar helpers, thin public methods that delegate to managers or the SDK client, and app-renderer proxy. The file would still be substantial but no longer a single 3,400-line monolith, with clear separation between “wiring and lifecycle” and “domain behavior in managers.”

These ranges are approximate; actual line counts will depend on formatting, how much duplication is removed, and how narrowly the manager boundaries are drawn.
