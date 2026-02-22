# Receiver-side task support (InspectorClient)

This document describes how receiver-side task support was implemented and tested in InspectorClient: when the server sends `sampling/createMessage` or `elicit` with `params.task`, the client creates a receiver task, returns a task reference immediately, and the server polls `tasks/get` and `tasks/result`; the existing Sampling/Elicitations UX resolves the task when the user responds.

---

## 1. Overview: requestor tasks vs receiver tasks

InspectorClient supports two kinds of tasks.

**Requestor tasks**

- **Direction:** Client → server. We send a request that creates a task on the **server** (e.g. `tools/call` with `task: { ttl }`). The server returns a task reference.
- **Storage:** `trackedRequestorTasks: Map<string, Task>`.
- **Flow:** We poll the server with `tasks/get` and `tasks/result` until the task completes.
- **APIs:** `getRequestorTask`, `getRequestorTaskResult`, `listRequestorTasks`, `cancelRequestorTask`; internal `getTrackedRequestorTasks`, `upsertTrackedRequestorTask`.

**Receiver tasks**

- **Direction:** Server → client. The **server** sends us a request with `params.task` (e.g. `sampling/createMessage` or `elicit`). We create the task **locally**, return a task reference immediately, and the server polls **us**.
- **Storage:** `receiverTaskRecords: Map<string, ReceiverTaskRecord>`.
- **Flow:** We create the task, push the request into the same Sampling/Elicitations UI; when the user responds we resolve the task’s payload and send `notifications/tasks/status`. The server calls `tasks/get` and `tasks/result` on us; we implement handlers that delegate to receiver-task methods.
- **APIs:** `getReceiverTask`, `listReceiverTasks`, `getReceiverTaskPayload`, `cancelReceiverTask`, `createReceiverTask`, `emitReceiverTaskStatus`, `upsertReceiverTask`.

Same MCP task protocol; opposite roles. Requestor tasks = we poll the server. Receiver tasks = the server polls us.

---

## 2. Use case and behavior

- **Server** sends `sampling/createMessage` or `elicit` with optional `params.task` (e.g. `{ ttl?: number }`).
- **Without** `params.task`: existing behavior—handler returns a promise that resolves when the user responds in the Sampling or Elicitations tab.
- **With** `params.task`: the client (1) creates a receiver task (taskId, status, ttl, etc.), (2) **returns immediately** with `{ task: record.task }` (CreateTaskResult), (3) still pushes the request into the same pending list and fires `newPendingSample` / `newPendingElicitation` so the existing UI shows it, (4) when the user calls `respond(result)` or `reject(error)`, resolves or rejects the **receiver task’s payload promise** and sets task status to completed or failed, (5) sends `notifications/tasks/status` with the updated task (fire-and-forget; see below), (6) runs TTL cleanup (removes the task record after ttl ms). The server polls `tasks/get` and `tasks/result`; `tasks/result` blocks until the payload promise is resolved or rejected.
- **UX:** Unchanged: user sees the same Sampling or Elicitations tab and the same resolve/reject actions. Only the protocol response shape and server-visible task lifecycle change when `params.task` is present.

---

## 3. Implementation

### 3.1 Options and capabilities

**InspectorClientOptions**

- **`receiverTasks?: boolean`** (default false)  
  When true, InspectorClient advertises client capabilities for receiver tasks (`tasks.list`, `tasks.cancel`, `tasks.requests.sampling.createMessage`, `tasks.requests.elicitation.create`) and implements the full receiver-task flow. When false, we do not add the tasks capability or any receiver-task handlers.

- **`receiverTaskTtlMs?: number | (() => number)`**  
  Used only when `receiverTasks` is true. TTL for receiver tasks when the server does not send a `ttl` in `params.task`. If a function, it is called at task creation time. Default is 60_000.

**Capabilities (constructor)**  
When `receiverTasks` is true, we add to `ClientCapabilities`:  
`tasks: { list: {}, cancel: {}, requests: { sampling: { createMessage: {} }, elicitation: { create: {} } } }`.  
We do not derive this from `sample`/`elicit`; the creator opts in with `receiverTasks: true`.

### 3.2 State and types

- **`receiverTaskRecords: Map<string, ReceiverTaskRecord>`**  
  Key = taskId. Cleared in `disconnect()` and when the TTL timer fires.

- **`ReceiverTaskRecord`** (internal):
  - `task: Task`
  - `payloadPromise: Promise<ClientResult>` (resolved with CreateMessageResult or ElicitResult, or rejected with error)
  - `resolvePayload: (payload: ClientResult) => void`
  - `rejectPayload: (reason?: unknown) => void`
  - `cleanupTimeoutId?: ReturnType<typeof setTimeout>` (for TTL cleanup)

### 3.3 Helpers

- **`createReceiverTask(opts: { ttl?: number; initialStatus; statusMessage?; pollInterval? }): ReceiverTaskRecord`**  
  Generates taskId (e.g. `crypto.randomUUID()` or fallback), computes `ttl = opts.ttl ?? receiverTaskTtlMs`, creates the Task object, creates a promise with resolve/reject, builds the record, stores it in `receiverTaskRecords`, and schedules TTL cleanup. Returns the record.

- **`emitReceiverTaskStatus(task: Task): void`**  
  Sends `this.client.notification({ method: "notifications/tasks/status", params: task })`. Implemented as synchronous void: `client.notification()` is invoked and errors are handled with `.catch()` and logging so a failed notification does not break the flow.

- **`upsertReceiverTask(task: Task): void`**  
  Updates the record in `receiverTaskRecords` for `task.taskId` (sets `record.task = task`), then calls `emitReceiverTaskStatus(task)`. Also synchronous void; notification is fire-and-forget.

- **Terminal status**  
  A private static `isTerminalTaskStatus(status)` returns true for `completed` / `failed` / `cancelled`. We use this instead of the SDK’s experimental `isTerminal` to avoid depending on experimental API and to get a type predicate for narrowing.

**Receiver-task accessors (used by protocol handlers and internally)**

- **`getReceiverTask(taskId): ReceiverTaskRecord | undefined`** — `receiverTaskRecords.get(taskId)`.
- **`listReceiverTasks(): Task[]`** — `Array.from(receiverTaskRecords.values()).map(r => r.task)`.
- **`getReceiverTaskPayload(taskId): Promise<ClientResult>`** — Looks up the record; if missing, throws `McpError(InvalidParams, "Unknown taskId: ...")`. Returns `record.payloadPromise` (the server’s `tasks/result` awaits this).
- **`cancelReceiverTask(taskId): Task`** — Looks up record; if missing, throws. If status is already terminal, returns `record.task`. Otherwise sets status to cancelled, calls `record.rejectPayload(...)`, clears cleanup timeout, calls `emitReceiverTaskStatus(updatedTask)`, returns updated task.

### 3.4 CreateMessage handler (connect)

When `receiverTasks` is true, the CreateMessage handler:

- **If no `params.task`:** Current behavior: create `SamplingCreateMessage(...)`, `addPendingSample(...)`, return the promise.
- **If `params.task` is present:**
  - Call `createReceiverTask({ ttl: params.task.ttl, initialStatus: "input_required", statusMessage: "Awaiting user input" })`.
  - Return **immediately** with `{ task: record.task }`.
  - In the background: create the same `SamplingCreateMessage(request, resolve, reject, removeCallback)` and call `addPendingSample(samplingRequest)`. On `resolve`: call `record.resolvePayload(payload)`, set `record.task` status to `"completed"`, call `upsertReceiverTask(updatedTask)`. On `reject`: call `record.rejectPayload(error)`, set status `"failed"`, set statusMessage from error, call `upsertReceiverTask(updatedTask)`.

### 3.5 Elicit handler (connect)

Same pattern as CreateMessage when `receiverTasks` is true: no `params.task` → current behavior; with `params.task` → createReceiverTask, return `{ task: record.task }`, in background add to pending elicitations; when the user calls `respond(result)`, call `record.resolvePayload(result)`, set task completed, upsertReceiverTask; on reject/decline, call `record.rejectPayload`, set failed, upsertReceiverTask.

**ElicitationCreateMessage and decline**  
For task-augmented elicit, when the user declines we must reject the receiver task’s payload so the server’s `tasks/result` receives an error. `ElicitationCreateMessage` exposes a public method `reject(error: Error)`; the optional constructor callback is stored internally and invoked by `reject()`. The App’s decline handler calls `elicitation.reject(error)` when present, then `elicitation.remove()` as usual.

### 3.6 Task request handlers (connect, only when receiverTasks is true)

Handlers are registered for ListTasks, GetTask, GetTaskPayload, CancelTask. Each delegates to the corresponding receiver-task method.

- **ListTasks:** Returns `{ tasks: this.listReceiverTasks() }`.
- **GetTask:** Calls `this.getReceiverTask(request.params.taskId)`; if undefined, throws McpError(InvalidParams); returns `record.task`.
- **GetTaskPayload:** Returns `await this.getReceiverTaskPayload(request.params.taskId)` (throws if unknown; server request blocks until payload resolved or rejected).
- **CancelTask:** Returns `this.cancelReceiverTask(request.params.taskId)`.

Notification payload is built with `TaskStatusNotificationSchema` (from SDK). Response type for `{ task: record.task }` is inferred; `CreateTaskResultSchema` is not imported.

### 3.7 disconnect()

Before clearing `trackedRequestorTasks`, iterate `receiverTaskRecords`, clear any `cleanupTimeoutId` (clearTimeout), then `receiverTaskRecords.clear()`.

### 3.8 Web app integration

- **InspectorClientOptions:** The app creates InspectorClient with `receiverTasks: true` and `receiverTaskTtlMs: getMCPTaskTtl(currentConfig)` where `currentConfig` is `configRef.current` in `ensureInspectorClient`.
- **Elicitation decline:** In the handler for “decline,” if the elicitation has a `reject` (task-augmented), call it with the error so the server’s `tasks/result` receives an error and the task is marked failed; then call `elicitation.remove()` as usual.
- No other app change: existing listeners for `newPendingSample` and `newPendingElicitation` continue to work; for task-augmented requests the first response to the server is already sent (task ref), and when the user resolves we complete the task via the same `respond`/`reject` calls.

---

## 4. Testing

Receiver-task behavior is covered by **e2e tests** only: a full protocol driver where the test server sends `createMessage` or `elicit` with `params.task`, receives `{ task }`, then sends `tasks/list`, `tasks/get`, `tasks/result`, and optionally `tasks/cancel`, and asserts on responses. There are no unit tests that call receiver-task private methods.

**Test fixture**  
The fixture `createTaskTool` (in `core/test/test-server-fixtures.ts`) supports `receiverTaskTtl?: number`. When set, the tool’s createTask handler sends `sampling/createMessage` or `elicitation/create` with `params.task: { ttl }` to the client, receives `{ task }`, then polls the client with `tasks/get` until the task is terminal and fetches the payload via `tasks/result`. The tool’s result is that payload, so the test can assert end-to-end behavior.

**E2E flow (e.g. sampling)**

1. Server sends `sampling/createMessage` with `params.task` (e.g. `{ ttl: 5000 }`).
2. Client returns `{ task }` immediately; test asserts response shape and `task.taskId`.
3. Test obtains the pending sample (e.g. via `newPendingSample` event) and calls `respond(result)` with a known payload.
4. Server (fixture) calls `tasks/get` for that taskId until status is `completed`, then `tasks/result`; fixture uses that payload as the tool result.
5. Test asserts the tool result (from `callToolStream`) matches the payload passed to `respond(...)`.

**Elicit variant**  
Same idea with `elicit` and `params.task`; test drives `respond(result)` or decline (`reject(error)`); server’s `tasks/result` sees success or error.

**Location**  
`core/__tests__/inspectorClient.test.ts`, describe block “Receiver tasks (e2e)” — two tests: one for sampling, one for elicitation.

---

## 5. Files changed (summary)

| Area            | File                                   | Changes                                                                                                                                                                               |
| --------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Options / types | `core/mcp/inspectorClient.ts`          | `receiverTasks`, `receiverTaskTtlMs` on InspectorClientOptions; `ReceiverTaskRecord`; `receiverTaskRecords`.                                                                          |
| Constructor     | `core/mcp/inspectorClient.ts`          | When `receiverTasks` is true, add `tasks` to ClientCapabilities.                                                                                                                      |
| Helpers         | `core/mcp/inspectorClient.ts`          | `createReceiverTask`, `emitReceiverTaskStatus`, `upsertReceiverTask`, `getReceiverTask`, `listReceiverTasks`, `getReceiverTaskPayload`, `cancelReceiverTask`; `isTerminalTaskStatus`. |
| connect()       | `core/mcp/inspectorClient.ts`          | When `receiverTasks` is true: task-aware CreateMessage and Elicit handlers; ListTasks, GetTask, GetTaskPayload, CancelTask handlers.                                                  |
| disconnect()    | `core/mcp/inspectorClient.ts`          | Clear receiver task timeouts and `receiverTaskRecords`.                                                                                                                               |
| Elicitation     | `core/mcp/elicitationCreateMessage.ts` | Optional `reject(error: Error)` (public method; set when task-augmented so App can reject the task payload on decline).                                                               |
| App             | `web/src/App.tsx`                      | Pass `receiverTasks: true` and `receiverTaskTtlMs: getMCPTaskTtl(config)`; on elicitation decline, call `reject` when present.                                                        |
| Test fixtures   | `core/test/test-server-fixtures.ts`    | `createTaskTool` with `receiverTaskTtl` for e2e receiver flow.                                                                                                                        |
