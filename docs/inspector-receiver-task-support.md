# Receiver-side flow implementation plan (InspectorClient)

This document is a ready-to-implement plan for adding receiver-side task support to InspectorClient: when the server sends `sampling/createMessage` or `elicit` with `params.task`, the client creates a receiver task, returns a task reference immediately, and the server polls `tasks/get` and `tasks/result`; the existing Sampling/Elicitations UX resolves the task when the user responds. It is based on a review of InspectorClient and the old `client` app’s useConnection.

---

## Overview: client tasks vs receiver tasks

InspectorClient deals with two kinds of tasks; the naming in this plan keeps them distinct.

**Client tasks (existing)**

- **Direction:** Client → server. We send a request that creates a task on the **server** (e.g. `tools/call` with `task: { ttl }`). The server returns a task reference.
- **Storage:** `trackedClientTasks: Map<string, Task>` holds those references.
- **Flow:** We poll the server with `tasks/get` and `tasks/result` until the task completes. The work runs on the server.
- **Naming:** Client-task APIs: `getClientTask`, `getClientTaskResult`, `listClientTasks`, `cancelClientTask`; state accessors `getTrackedClientTasks`, `updateTrackedClientTask`.

**Receiver tasks (new)**

- **Direction:** Server → client. The **server** sends us a request with `params.task` (e.g. `sampling/createMessage` or `elicit`). We create the task **locally**, return a task reference immediately, and the server polls **us**.
- **Storage:** `receiverTaskRecords: Map<string, ReceiverTaskRecord>` (new).
- **Flow:** We create the task, push the request into the same Sampling/Elicitations UI; when the user responds we resolve the task's payload and send `notifications/tasks/status`. The server calls `tasks/get` and `tasks/result` **on us**; we implement handlers that delegate to receiver-task methods.
- **Naming:** All new methods and helpers are explicitly for receiver tasks: `getReceiverTask`, `listReceiverTasks`, `getReceiverTaskPayload`, `cancelReceiverTask`, `createReceiverTask`, `emitReceiverTaskStatus`, `upsertReceiverTask`.

Same MCP task protocol; opposite roles. Client tasks = we poll the server. Receiver tasks = the server polls us.

---

## 1. Current state in InspectorClient

**Client creation and capabilities (constructor, ~440–474):**

- InspectorClient builds `ClientCapabilities` with `sampling: {}` when `options.sample` is true (default true), `elicitation: { form: {}, url?: {} }` when `options.elicit` is set (default true), and `roots: { listChanged: true }` when `options.roots !== undefined`. There is **no** `tasks` capability. The SDK `Client` is created with these capabilities only.

**Request handlers (registered in `connect()` after `client.connect(this.transport)`):**

- **CreateMessageRequestSchema** (lines 670–684): Only registered when `this.sample && this.client`. Handler always returns a `Promise<CreateMessageResult>`: it builds a `SamplingCreateMessage(request, resolve, reject, removeCallback)`, calls `addPendingSample(samplingRequest)`, and returns the promise that resolves when the UI later calls `samplingRequest.respond(result)` or `samplingRequest.reject(error)`. There is **no** check for `request.params.task` and **no** immediate return of a task or use of receiver tasks.
- **ElicitRequestSchema** (lines 689–701): Only when `this.elicit && this.client`. Same pattern: `ElicitationCreateMessage(request, resolve, removeCallback)`, `addPendingElicitation(elicitationRequest)`, return promise that resolves when UI calls `elicitationRequest.respond(result)`. **No** `params.task` handling.
- **ListRootsRequestSchema** (706–708): Returns `{ roots: this.roots ?? [] }`.

**Task-related handlers:** None. InspectorClient does **not** register handlers for `ListTasksRequestSchema`, `GetTaskRequestSchema`, `GetTaskPayloadRequestSchema`, or `CancelTaskRequestSchema`.

**State:**

- `pendingSamples: SamplingCreateMessage[]`, `pendingElicitations: ElicitationCreateMessage[]` (lines 344–346); `trackedClientTasks: Map<string, Task>` for **caller-side** tasks (tool-call task references from the server). **No** map or ref for receiver-side task records.
- `disconnect()` (819–865) clears `pendingSamples`, `pendingElicitations`, `trackedClientTasks`; it does **not** clear any receiver-task store (none exists).

**Notifications:**

- InspectorClient sends one notification today: `notifications/roots/list_changed` in `setRoots()` (2586). It does **not** send `notifications/tasks/status`.

**SamplingCreateMessage / ElicitationCreateMessage:**

- Both hold `request`, `resolve`/`reject` (or just `resolve` for elicitation), and `onRemove`. They expose `respond(result)` and `reject(error)` (sampling only) which resolve the promise and call `onRemove`. They already read `request.params?._meta?.[RELATED_TASK_META_KEY]?.taskId` for display; they do **not** handle `params.task` (task-augmented request) or participate in receiver-task creation.

**Web App integration:**

- App creates InspectorClient with `InspectorClientOptions` (no `sample`/`elicit` override, so both default true; no roots in options; no task TTL). App listens for `newPendingSample` and `newPendingElicitation`; on event it pushes an item with `resolve`/`reject` that call `sample.respond(result)` / `sample.reject(error)` or `elicitation.respond(result)`. So the UI already drives resolution via the existing `SamplingCreateMessage` / `ElicitationCreateMessage` API. For task-augmented requests we will still add the same object to pending lists and use the same resolve/reject; the only difference is the **initial** response to the server (return `{ task }` immediately) and we must resolve the **receiver task’s** payload when the user responds.

---

## 2. Use case and UX to support

- **Server** sends `sampling/createMessage` or `elicit` with optional `params.task` (e.g. `{ ttl?: number }`).
- **Without** `params.task`: current behavior—handler returns a promise that resolves when the user responds in the Sampling or Elicitations tab; no change.
- **With** `params.task`: client must (1) create a receiver task (taskId, status, ttl, etc.), (2) **return immediately** with `{ task }` (CreateTaskResult), (3) still push the request into the same pending list and fire `newPendingSample` / `newPendingElicitation` so the existing UI shows it, (4) when the user calls `respond(result)` or `reject(error)`, resolve or reject the **receiver task’s payload promise** and set task status to completed or failed, (5) send `notifications/tasks/status` with the updated task, (6) run TTL cleanup (remove task record after ttl ms). The server will poll `tasks/get` and `tasks/result`; `tasks/result` must block until the payload promise is resolved or rejected.
- **UX:** Identical to today: user sees the same Sampling or Elicitations tab, same resolve/reject actions. No new UI; only the protocol response shape and server-visible task lifecycle change when `params.task` is present.

---

## 3. What to add and change

### 3.1 InspectorClientOptions (new options)

- **`receiverTasks?: boolean`** (default false)  
  When true, InspectorClient advertises client capabilities for receiver tasks (`tasks.list`, `tasks.cancel`, `tasks.requests.sampling.createMessage`, `tasks.requests.elicitation.create`) and implements the full receiver-task flow (task-augmented CreateMessage/Elicit, plus handlers for `tasks/list`, `tasks/get`, `tasks/result`, `tasks/cancel`). When false, we do not add tasks capability and do not register any receiver-task handlers. Like `sample`, `elicit`, and `roots`, support is driven by what the creator passes in; we only advertise and implement what was requested.

- **`receiverTaskTtlMs?: number | (() => number)`**  
  Only used when `receiverTasks` is true. TTL for receiver tasks when the server sends `params.task` without a `ttl`. If a function, called at task creation time. If omitted, use a default (e.g. 60_000).

### 3.2 New private state

- **`receiverTaskRecords: Map<string, ReceiverTaskRecord>`**  
  Key = taskId. Cleared in `disconnect()` and when TTL timer fires.

- **Type `ReceiverTaskRecord`** (internal or in a small types file). Same shape as the client app in the sibling project **inspector-main** (`client/src/lib/hooks/useConnection.ts`):
  - `task: Task`
  - `payloadPromise: Promise<ClientResult>` (resolved with CreateMessageResult or ElicitResult, or rejected with error)
  - `resolvePayload: (payload: ClientResult) => void`
  - `rejectPayload: (reason?: unknown) => void`
  - `cleanupTimeoutId?: ReturnType<typeof setTimeout>` (for TTL cleanup)

### 3.3 New private helpers

- **`createReceiverTask(opts: { ttl?: number; initialStatus: Task["status"]; statusMessage?: string; pollInterval?: number }): ReceiverTaskRecord`**  
  Generate taskId (e.g. `crypto.randomUUID()` or fallback), compute `ttl = opts.ttl ?? receiverTaskTtlMs (number or call result)`, create Task object (taskId, status, ttl, createdAt, lastUpdatedAt, optional pollInterval, statusMessage). Create a promise with resolve/reject stored. Build `ReceiverTaskRecord`, store it in `receiverTaskRecords`, schedule `setTimeout` to delete the record after `ttl` ms (and clear the timeout on the record). Return the record. Do **not** send notification here (initial status is sent by the handler when returning the task, or we send one immediately; inspector-main sends status after creation).

- **`emitReceiverTaskStatus(task: Task): Promise<void>`**  
  Send `this.client.notification({ method: "notifications/tasks/status", params: task })`. Catch and log (or ignore) errors so a failed notification doesn’t break the flow.

- **`upsertReceiverTask(task: Task): Promise<void>`**  
  Update the record in `receiverTaskRecords` for `task.taskId` (set `record.task = task`), then call `emitReceiverTaskStatus(task)`.

**Receiver-task accessors (used by protocol handlers and internally):**  
Name all receiver-task methods explicitly so they are not confused with client-task APIs (`getClientTask`, `getClientTaskResult`, `listClientTasks`).

- **`getReceiverTask(taskId: string): ReceiverTaskRecord | undefined`**  
  Return `receiverTaskRecords.get(taskId)`. Used by the `tasks/get` handler and by cancel logic.

- **`listReceiverTasks(): Task[]`**  
  Return `Array.from(receiverTaskRecords.values()).map(r => r.task)`.

- **`getReceiverTaskPayload(taskId: string): Promise<ClientResult>`**  
  Look up record; if missing, throw `McpError(ErrorCode.InvalidParams, "Unknown taskId: ...")`. Return `record.payloadPromise` (server's `tasks/result` awaits this).

- **`cancelReceiverTask(taskId: string): Task`**  
  Look up record; if missing, throw same McpError. If status already terminal (completed/failed/cancelled), return `record.task`. Otherwise set task status to cancelled, call `record.rejectPayload(...)`, clear cleanup timeout if set, call `emitReceiverTaskStatus(updatedTask)`, return updated task.

### 3.4 Capabilities (constructor)

- **Only when `receiverTasks` is true**, add to `ClientCapabilities`:  
  **`tasks: { list: {}, cancel: {}, requests: { sampling: { createMessage: {} }, elicitation: { create: {} } } }`**  
  so the server knows it can send task-augmented createMessage/elicit and use tasks/list, tasks/get, tasks/result, tasks/cancel. We do not derive this from sample/elicit; the creator opts in by setting receiverTasks: true. When receiverTasks is false, we do not advertise any tasks capability.

### 3.5 CreateMessage handler (connect)

- **Replace** the current CreateMessage handler with one that:
  - **If `receiverTasks` is false:** Keep current behavior only; do not check or handle `params.task`.
  - **If `receiverTasks` is true:** Check for `request.params.task` (e.g. `(request.params as { task?: { ttl?: number } }).task`).
    - **If no `params.task`:** Keep current behavior: `new SamplingCreateMessage(...)`, `addPendingSample(...)`, return the promise (no change).
    - **If `params.task` is present:**
    - Call `createReceiverTask({ ttl: params.task.ttl, initialStatus: "input_required", statusMessage: "Awaiting user input" })`.
    - Return **immediately** with `{ task: record.task }` (CreateTaskResult).
    - In the background (e.g. `void (async () => { ... })()`): create the same `SamplingCreateMessage(request, resolve, reject, removeCallback)` and call `addPendingSample(samplingRequest)` so the UI appears. In the `resolve` path: call `record.resolvePayload(payload)`, set `record.task` to status `"completed"`, call `upsertReceiverTask(updatedTask)`. In the `reject` path: call `record.rejectPayload(error)`, set status `"failed"`, set statusMessage from error, call `upsertReceiverTask(updatedTask)`.

### 3.6 Elicit handler (connect)

- Same pattern as CreateMessage. Only when `receiverTasks` is true do we check for `params.task` and handle it.
  - **If no `params.task`:** current behavior (ElicitationCreateMessage, addPendingElicitation, return promise).
  - **If `params.task` is present:** createReceiverTask, return `{ task: record.task }`, in background add to pending elicitations; when user calls `respond(result)`, call `record.resolvePayload(result)`, set task completed, upsertReceiverTask; on failure/reject, record.rejectPayload, set failed, upsertReceiverTask.

### 3.7 New request handlers (connect, only when receiverTasks is true)

Register handlers for ListTasksRequestSchema, GetTaskRequestSchema, GetTaskPayloadRequestSchema, CancelTaskRequestSchema only when receiverTasks is true. Each handler delegates to the receiver-task method so protocol and internal API stay aligned.

- **ListTasksRequestSchema:** Handler returns `{ tasks: this.listReceiverTasks() }`. No pagination/cursor for now unless the SDK requires it.

- **GetTaskRequestSchema:** Handler calls `this.getReceiverTask(request.params.taskId)`. If undefined, throw McpError(InvalidParams). Return `record.task`.

- **GetTaskPayloadRequestSchema:** Handler returns `await this.getReceiverTaskPayload(request.params.taskId)` (throws if unknown; server request blocks until payload resolved or rejected).

- **CancelTaskRequestSchema:** Handler returns `this.cancelReceiverTask(request.params.taskId)` (throws if unknown).

### 3.8 disconnect()

- Before clearing `trackedClientTasks`, iterate `receiverTaskRecords` and clear any `cleanupTimeoutId` (clearTimeout), then `receiverTaskRecords.clear()`.

### 3.9 SDK imports

- Add imports for: `ListTasksRequestSchema`, `GetTaskRequestSchema`, `GetTaskPayloadRequestSchema`, `CancelTaskRequestSchema`, `CreateTaskResultSchema` (if needed for typing), `McpError`, `ErrorCode` (if not already), and `Task` (already used). From spec/types: `ClientResult` or the concrete result types for CreateMessageResult and ElicitResult so `payloadPromise` is typed correctly. Use the same schema names as in inspector-main so handlers match the SDK’s expectation.

### 3.10 ElicitationCreateMessage and decline (reject)

**Problem:** `ElicitationCreateMessage` currently has only `respond(result)`; it has no `reject`. For non–task-augmented elicit, App’s “decline” just calls `elicitation.remove()`. For **task-augmented** elicit, when the user declines we must call `record.rejectPayload(error)` so the server’s `tasks/result` receives an error and the task is marked failed; otherwise the server would hang waiting for a result that never comes.

**Decision:** Add an optional `reject?(error: Error) => void` to `ElicitationCreateMessage`. Set it only when the request is task-augmented (the background runner passes the record’s `rejectPayload`). App’s decline handler calls `reject(error)` when present, then continues with `elicitation.remove()` as today.

**Implementation:** In `core/mcp/elicitationCreateMessage.ts`, add optional `reject?: (error: Error) => void`. When creating the elicitation in the task-augmented Elicit handler, set `reject` so it calls `record.rejectPayload(error)`. App (see §4) calls it on decline when present.

## 4. App (web) changes

- **InspectorClientOptions:** When creating InspectorClient, set **`receiverTaskTtlMs: getMCPTaskTtl(config)`** (or a function that returns it) so receiver tasks use the same TTL as the rest of the app. Config is already available where the client is created.

- **Elicitation decline:** In the handler that processes “decline” for an elicitation request, if the elicitation has a `reject` (i.e. task-augmented), call it with the error so the server’s `tasks/result` receives an error and the task is marked failed; then call `elicitation.remove()` as usual.

- No other App change required: existing listeners for `newPendingSample` and `newPendingElicitation` continue to work; the only difference is that for task-augmented requests the first response to the server is already sent (task ref), and when the user resolves we complete the task via the same `respond`/`reject` calls.

---

## 5. Files to touch (summary)

| Area            | File                                            | Changes                                                                                                                                                                                                                                                                                    |
| --------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Options / types | `core/mcp/inspectorClient.ts` (or shared types) | Add `receiverTasks?: boolean` (default false) and `receiverTaskTtlMs?: number \| (() => number)` to InspectorClientOptions. Define `ReceiverTaskRecord` (or inline).                                                                                                                       |
| State / members | `core/mcp/inspectorClient.ts`                   | Add `receiverTaskRecords: Map<string, ReceiverTaskRecord>`. Read `receiverTasks` in constructor.                                                                                                                                                                                           |
| Constructor     | `core/mcp/inspectorClient.ts`                   | When `receiverTasks` is true, add `tasks` to ClientCapabilities; do not derive from sample/elicit.                                                                                                                                                                                         |
| Helpers         | `core/mcp/inspectorClient.ts`                   | Add `createReceiverTask`, `emitReceiverTaskStatus`, `upsertReceiverTask`, `getReceiverTask`, `listReceiverTasks`, `getReceiverTaskPayload`, `cancelReceiverTask`.                                                                                                                          |
| connect()       | `core/mcp/inspectorClient.ts`                   | When `receiverTasks` is true: replace CreateMessage/Elicit handlers with task-aware versions; register ListTasks, GetTask, GetTaskPayload, CancelTask handlers (each delegating to the matching getReceiverTask / listReceiverTasks / getReceiverTaskPayload / cancelReceiverTask method). |
| disconnect()    | `core/mcp/inspectorClient.ts`                   | Clear receiver task timeouts and `receiverTaskRecords`.                                                                                                                                                                                                                                    |
| Elicitation     | `core/mcp/elicitationCreateMessage.ts`          | Add optional `reject?(error: Error)` (set when task-augmented so App can reject the task payload on decline).                                                                                                                                                                              |
| App             | `web/src/App.tsx`                               | Pass `receiverTasks: true` and `receiverTaskTtlMs: getMCPTaskTtl(config)` in client options; on elicitation decline, call `reject` when present.                                                                                                                                           |

---

## 6. Testing

### 6.1 Unit tests (core)

- **createReceiverTask:** Task record is stored in `receiverTaskRecords`; task has expected taskId, status, ttl, timestamps; TTL cleanup runs (record removed after ttl ms); cleanup timeout is cleared on disconnect.
- **Receiver-task accessors:** `getReceiverTask`, `listReceiverTasks`, `getReceiverTaskPayload`, `cancelReceiverTask` return or throw as specified; `getReceiverTaskPayload` blocks until payload is resolved/rejected; cancel updates status and rejects payload.
- **CreateMessage/Elicit with params.task (mocked or in-process):** Handler returns `{ task }` immediately; pending sample/elicitation is still added; when `record.resolvePayload(payload)` or `record.rejectPayload(error)` is called, task status and `tasks/result` outcome match; `notifications/tasks/status` is sent (can assert on dispatched notification or spy).

### 6.2 E2E test (receiver flow with real test server)

**Goal:** Same style as the existing “run tool as task” e2e test: a **real test server** that advertises and uses the receiver-task feature, with assertions on client and optionally server state.

**Setup:**

- **Test server:** Extend the composable test server (or equivalent) so that it:
  - Advertises client capabilities that allow it to send task-augmented requests (e.g. server indicates it will send `sampling/createMessage` and `elicit` with `params.task`).
  - Can send `sampling/createMessage` (and optionally `elicit`) with `params.task: { ttl?: number }` to the client.
  - After receiving `{ task }` from the client, can call the client’s `tasks/get` and `tasks/result` (i.e. the server sends these requests to the client over the same connection; the client’s registered handlers respond). The test server may expose a tool or internal path that: sends createMessage with params.task → captures taskId from response → later calls tasks/get and tasks/result against the client.
- **Client:** InspectorClient with `receiverTasks: true` and a suitable `receiverTaskTtlMs`, connected to this server.

**Flow (example for sampling):**

1. Server sends `sampling/createMessage` with `params.task` (e.g. `{ ttl: 5000 }`).
2. Client returns `{ task }` immediately; test asserts response shape and presence of `task.taskId`.
3. Test drives resolution: obtain the pending sample (e.g. via `newPendingSample` event or any test hook that exposes the pending request) and call `respond(result)` with a known payload.
4. Server (or test using the server’s view) calls `tasks/get` for that taskId; assert status becomes `completed` (and optionally `tasks/result` returns the same payload). Alternatively, the test can call the client’s listReceiverTasks / getReceiverTaskPayload if the API is exposed for testing, or introspect the test server’s view of what it received from `tasks/result`.
5. Assert final state: task status completed, payload matches what was passed to `respond(...)`; optionally assert notifications/tasks/status was sent (e.g. via server-side or transport spy).

**Elicit variant:** Same idea with `elicit` and `params.task`; test drives `respond(result)` or decline (call `reject(error)` when implemented); assert server’s `tasks/result` sees success or error.

**Introspection:** Where needed, validate behavior by introspecting the test server (e.g. a tool or internal state that records what the server sent and received for createMessage and tasks/get, tasks/result) and/or the client (events, receiver-task list if exposed for tests, or a test-only hook). The test server should be the single source of “real” MCP behavior; the client is validated by its responses and by what the server observes.

### 6.3 Summary

| Scope | What to test                                                                                                                                                                                                                                    |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit  | createReceiverTask (storage, TTL, cleanup); get/list/getPayload/cancelReceiverTask; CreateMessage/Elicit handler with params.task returns { task } and resolve/reject updates task and payload.                                                 |
| E2E   | Real server sends createMessage/elicit with params.task; client returns { task }; test resolves (or rejects) pending request; server (or test) calls tasks/get and tasks/result; assert status and payload; introspect server/client as needed. |

---

## 7. Order of implementation

1. Add `receiverTasks` and `receiverTaskTtlMs` options, `ReceiverTaskRecord` type, `receiverTaskRecords` map; when `receiverTasks` is true add `tasks` capability in constructor; add `createReceiverTask`, `emitReceiverTaskStatus`, `upsertReceiverTask`, `getReceiverTask`, `listReceiverTasks`, `getReceiverTaskPayload`, `cancelReceiverTask`; clear receiver tasks in `disconnect()`.
2. When `receiverTasks` is true, register ListTasks, GetTask, GetTaskPayload, CancelTask handlers in `connect()` (each delegating to the corresponding receiver-task method).
3. When `receiverTasks` is true, replace CreateMessage handler with task-aware version (check params.task, immediate return { task }, background add to pending and wire resolve/reject to record).
4. When `receiverTasks` is true, replace Elicit handler with task-aware version; add optional `reject` to ElicitationCreateMessage and set it for task-augmented case; in decline path call it.
5. App: pass `receiverTasks: true` and `receiverTaskTtlMs`, and in elicitation decline call `reject` when present.
6. **Tests:** Unit tests per §6.1; e2e test per §6.2 (real test server that uses receiver-task flow; validate via client response shape, tasks/get and tasks/result outcome, and introspection of server or client as needed).
