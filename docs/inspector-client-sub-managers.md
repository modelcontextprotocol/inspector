# InspectorClient: Internal Sub-Managers

This document describes **internal** sub-managers that `InspectorClient` could delegate to in order to reduce the size and complexity of the main class. List state, log state, and requestor task list are handled by **external** state managers (see [protocol-and-state-managers-architecture.md](protocol-and-state-managers-architecture.md)). In scope here: receiver tasks, OAuth, pending samples/elicitation, and optionally roots.

---

## Why Internal Delegation (Sub-Managers)

### Single entry point and lifecycle

Consumers expect one client object: one `connect()` / `disconnect()`, one place for environment (transport, fetch, logger, OAuth). Sub-managers are **internal** implementation details. The public API stays on `InspectorClient`; callers do not see or depend on the managers.

### Shared state and the SDK client

The MCP SDK `Client` is the single handle to the protocol. OAuth state, receiver task records, and pending samples/elicitation all depend on that connection. Extracting them into **internal** helpers (not separate public classes) keeps one facade that owns the SDK client and delegates to narrow, testable modules.

### Testability and change isolation

Managers can be unit-tested in isolation with mocks. Changes to OAuth or receiver-task handling are confined to one module. The main class becomes mostly wiring and delegation.

---

## Sub-Managers

The following are implemented inside InspectorClient and are candidates for internal extraction.

### 1. ReceiverTaskManager

**Responsibility:** Server-initiated tasks: create task record, TTL cleanup, hold payload promise, upsert/cancel, and notify the server of status.

**State:** `receiverTaskRecords` map, TTL config.

**Methods:** `createReceiverTask`, `emitReceiverTaskStatus`, `upsertReceiverTask`, `getReceiverTask`, `listReceiverTasks`, `getReceiverTaskPayload`, `cancelReceiverTask` (and helpers like `isTerminalTaskStatus`).

**Interface:** Constructor takes `{ ttlMs, onEmitStatus: (task) => void, logger? }`. API: `create(opts)`, `get(taskId)`, `list()`, `getPayload(taskId)`, `upsert(task)`, `cancel(taskId)`.

**Usage:** Created when the client is set up. Message/elicit handlers call the manager to create records; `tasks/get`, `tasks/cancel`, and `tasks/list` handlers delegate to the manager. Manager calls `onEmitStatus` to send status notifications (InspectorClient implements that with the SDK client).

---

### 2. OAuthManager (OAuthFlowManager)

**Responsibility:** OAuth config and all OAuth flow orchestration (normal and guided), using existing `OAuthStateMachine` and `BaseOAuthClientProvider`.

**State:** `oauthConfig`, `oauthStateMachine`, `oauthState`.

**Methods:** `setOAuthConfig`, `authenticate`, `beginGuidedAuth`, `runGuidedAuth`, `setGuidedAuthorizationCode`, `completeOAuthFlow`, `getOAuthTokens`, `clearOAuthTokens`, `isOAuthAuthorized`, `getOAuthState`, `getOAuthStep`, `proceedOAuthStep`, and private helpers (e.g. `createOAuthProvider`, `getServerUrl` or a callback).

**Interface:** Constructor takes `getServerUrl`, `fetch`, `logger`, `getEventTarget`, and OAuth env (storage, navigation, redirectUrlProvider). Same public method signatures as today.

**Usage:** InspectorClient holds the manager when `options.oauth` is present. All public OAuth methods delegate to the manager.

---

### 3. PendingSamplesElicitationManager

**Responsibility:** Hold pending sampling and elicitation requests and notify when they change.

**State:** `pendingSamples`, `pendingElicitations`.

**Methods:** `getPendingSamples`, `addPendingSample`, `removePendingSample`, `getPendingElicitations`, `addPendingElicitation`, `removePendingElicitation`.

**Interface:** Constructor takes a dispatch callback. API: get/add/remove for each list.

**Usage:** InspectorClient holds the manager and delegates all six methods. CreateMessage/elicit and elicitation-complete handlers call into the manager.

---

## Optional Extraction

**Roots:** InspectorClient holds `roots` and exposes `getRoots()`, `setRoots()`, and dispatches `rootsChange`. This could stay as-is or be moved into a small internal **RootsManager** if desired; it is not a state manager in the external sense (no separate consumer-facing list).

**Content cache:** If present, can remain as an internal dependency or small helper.

---

## What Remains in InspectorClient After Sub-Manager Extraction

After extracting ReceiverTaskManager, OAuthManager, and PendingSamplesElicitationManager (and optionally roots), InspectorClient would retain:

**Lifecycle and transport**

- Constructor: validate options, create sub-managers (injecting adapters/callbacks), set config flags.
- `connect()`: create transport (and optionally wrap with MessageTrackingTransport), attach listeners, register protocol request/notification handlers (which call into ReceiverTaskManager, etc.), run initialize, set up list-changed and other notification handlers.
- `disconnect()`: close transport, clear references, reset or clear managers as needed.

**SDK client and environment**

- Owning the MCP SDK `Client` and the transport.
- `getRequestOptions()`, `buildEffectiveAuthFetch()`, and other small helpers used by multiple managers or by `connect()`.

**Thin public API (delegation)**

- All existing public methods remain on InspectorClient; many become one-liners delegating to the appropriate manager (OAuth, receiver tasks, pending samples/elicitation) or to the SDK client (list RPCs, ping, callTool, callToolStream, readResource, getPrompt, createMessage, elicit, subscribe/unsubscribe, setLoggingLevel, etc.).
- List and log data come from **external** state managers, not from InspectorClient getters.

**Protocol and app-renderer wiring**

- Registration of request/notification handlers in `connect()` that coordinate with ReceiverTaskManager (createMessage/elicit with task, tasks/get, tasks/cancel, tasks/list).
- `getAppRendererClient()` (proxy for the Apps tab).
- Dispatching signal events (\*ListChanged, taskStatusChange, requestorTaskUpdated, message, fetchRequest, stderrLog, saveSession, etc.) so external state managers can subscribe.

**Session id and roots**

- `getSessionId()`, `setSessionId()`; the decision of when to dispatch `saveSession` (e.g. before OAuth redirect) remains on InspectorClient. Actual persist/restore is in FetchRequestLogState.
- Roots (and optionally a small RootsManager) unless extracted.

---

## Testing Strategy

**Dedicated test module per sub-manager.** Add a test file for each extracted manager (e.g. `receiverTaskManager.test.ts`, `oauthManager.test.ts`, `pendingSamplesElicitationManager.test.ts`). Test each manager in isolation with **mocked** dependencies (adapters, dispatch, getRequestOptions). No real transport or full InspectorClient.

**Move tests from InspectorClient into manager tests when they only validate manager behavior.** Examples: receiver task TTL expiry and cleanup, cancel semantics, OAuth state transitions, pending sample add/remove. After extraction, those scenarios live in the manager tests; InspectorClient tests can drop or reduce equivalent coverage.

**InspectorClient tests focus on wiring and integration.** Verify (1) the client correctly delegates to each manager, and (2) a small set of end-to-end flows per domain (e.g. connect, server sends createMessage with params.task, client creates a receiver task and responds to tasks/get). Manager tests own detailed scenarios; client tests own lifecycle, delegation, and integration.

---

## Rough Code Impact (Remaining Sub-Managers Only)

- **Current:** InspectorClient is protocol-only for lists and logs; remaining size is connection, OAuth, receiver tasks, pending samples/elicitation, roots, RPC/stream delegation, and handler registration.
- **Moved out (rough, if all three are extracted):**
  - ReceiverTaskManager: ~100–120 lines.
  - OAuthManager: ~350–400 lines.
  - PendingSamplesElicitationManager: ~40–50 lines.
- **Total moved:** on the order of **500–570 lines** into dedicated modules.
- **Remaining:** Wiring, lifecycle, list RPCs (stateless), notification dispatch, request handlers that delegate to ReceiverTaskManager, roots, sessionId/saveSession, and thin public methods that delegate to managers or the SDK client.

Line counts are approximate; actual impact depends on boundaries and formatting.
