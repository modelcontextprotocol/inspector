# Run tool as task — end-to-end test plan

This document describes how to add an end-to-end test for the **run tool as task** flow at the InspectorClient level: `callTool` with task options → server returns a task reference → client polls `getTask` / `getTaskResult` until completion. No mocks; real test server and real InspectorClient, consistent with the rest of the InspectorClient test suite. This is separate from receiver-task support.

---

## 1. How tests and fixtures work today

**Test server**

- **`createTestServerHttp(config: ServerConfig)`** (`core/test/test-server-http.ts`) starts an HTTP server (SSE or streamable-HTTP) that uses **`createMcpServer(config)`** from `core/test/composable-test-server.ts` to build the MCP server.
- **`ServerConfig`** (from `core/test/test-server-fixtures.ts`) drives capabilities and handlers: `tools`, `resources`, `prompts`, `tasks`, `logging`, etc. When `config.tasks` is set, `createMcpServer` adds `capabilities.tasks` with `list`, `cancel`, and **`requests: { tools: { call: {} } }`** (so the server advertises task-augmented tools/call).
- Task tools are **`TaskToolDefinition`**: they have `execution.taskSupport` (`"required"` | `"optional"`) and a `handler` with `createTask`, `getTask`, `getTaskResult`. The composable server registers them via **`mcpServer.experimental.tasks.registerToolTask(...)`**. When a client sends `tools/call` with `params.task`, the SDK invokes the tool’s `createTask`; the handler returns **`{ task }`** (taskId, status, pollInterval, ttl, etc.), and the server responds with that to the client.

**Task server config and tools**

- **`getTaskServerConfig()`** (`core/test/test-server-fixtures.ts`) returns a `ServerConfig` with:
  - `tasks: { list: true, cancel: true }`
  - Tools: `createSimpleTaskTool()` (required), `createOptionalTaskTool()` (optional), `createForbiddenTaskTool()`, `createProgressTaskTool()`, elicitation/sampling task tools, `createImmediateReturnTaskTool()`.
- **`createOptionalTaskTool(name?, delayMs?)`** is a **taskSupport: "optional"** tool. That allows **`callTool`** (non-streaming) to be used; when the client sends `params.task`, the server still runs the task path and returns a task reference.
- **`createFlexibleTaskTool`** (used by simple/optional/forbidden task tools) implements the handler: `createTask` creates a task in the store, starts a background loop (delay, then store result and set status completed), and returns **`{ task }`**. So the server already supports the exact flow we need: one request returns a task ref; client can then call `tasks/get` and `tasks/result`.

**Existing InspectorClient task tests**

- **`core/__tests__/inspectorClient.test.ts`** has a **"Task Support"** `describe` block (around line 5006):
  - **beforeEach:** Builds config with `getTaskServerConfig()` and `serverType: "sse"`, starts `createTestServerHttp(config)`, creates `InspectorClient` with SSE config and `createTransportNode`, calls `client.connect()`.
  - **afterEach:** Shared teardown (disconnect client, `server.stop()`).
  - Tests use **`callToolStream`** for task tools (simpleTask, optionalTask, failingTask, longRunningTask, etc.), and assert on events (`taskCreated`, `taskStatusChange`, `taskCompleted`), `getTask`, `getTaskResult`, `listTasks`, `cancelTask`. They do **not** exercise the path: **`callTool` with task options → response is a task reference → client polls with `getTask` / `getTaskResult`** (the same path the web App uses for “Run as task”).

**Gap**

- The web App “run tool as task” flow is: `callTool(name, params, metadata, runAsTask)` with `taskOptions: { ttl }` when runAsTask is true → if `invocation.result` has `task: { taskId, status, pollInterval }`, set “Polling Task…”, then loop: wait `pollInterval`, `getTask(taskId)`; if completed → `getTaskResult(taskId)` and set result; if failed/cancelled → set error; else repeat. There is no test that covers this **callTool + task reference + polling** path end-to-end at the InspectorClient level.

---

## 2. What to test (run tool as task e2e)

**Scenario**

1. InspectorClient is connected to a test server that advertises **tasks** (including `tasks.requests.tools.call`) and has at least one **optional** task tool (so `callTool` is allowed and the server can return a task reference).
2. Client calls **`callTool(toolName, args, undefined, undefined, { ttl: 5000 })`** (task options present).
3. Server responds with a **task reference**: `invocation.result` is an object with **`task`** containing `taskId`, `status`, and optionally `pollInterval`.
4. Client then **polls**: in a loop, wait `pollInterval` (or default), call **`getTask(taskId)`**; if status is `completed`, call **`getTaskResult(taskId)`** and assert on the result content; if `failed` or `cancelled`, assert error path; otherwise repeat until a terminal state or a test timeout (e.g. 10–15 s).
5. Final state: we have the same logical outcome as the UI (task completed and result available via `getTaskResult`).

**Assertions**

- After `callTool(..., taskOptions)`: `invocation.result` is an object, `invocation.result.task` exists, `invocation.result.task.taskId` is a non-empty string, `invocation.result.task.status` is a string (e.g. `"working"` or `"input_required"`).
- After polling completes with status **completed**: `getTaskResult(taskId)` returns a result with `content`; parse the first text content and assert it matches the expected payload from the fixture (e.g. `"Task completed: <message>"` and `taskId` in the payload).
- Optional: call **`listTasks()`** before disconnect and assert the completed task appears in the list.

**Tool and server**

- Use the **existing** `getTaskServerConfig()` and **`optionalTask`** (from `createOptionalTaskTool()`). No new fixture required for the happy path: optionalTask already returns a task reference when the client sends `params.task`, completes after a short delay, and stores a result with the expected message shape.
- If we want a dedicated “run as task” tool (e.g. predictable name and message), we could add a small fixture (e.g. `createRunAsTaskE2ETool()`) that is just an optional task tool with a fixed message; that would be optional.

---

## 3. Where and how to add the test

**Location**

- Add a new test inside the existing **"Task Support"** `describe` block in **`core/__tests__/inspectorClient.test.ts`**. Same `beforeEach`/`afterEach` and server config (getTaskServerConfig + SSE). No new describe block or server type needed.

**Test structure (no mocks)**

1. **Arrange:** Server and client are already set up in `beforeEach` (task-capable server, InspectorClient connected via SSE).
2. **Act (callTool with task options):**  
   `const invocation = await client.callTool("optionalTask", { message: "e2e-run-as-task" }, undefined, undefined, { ttl: 5000 });`
3. **Assert (task reference):**  
   Assert `invocation.result` is an object with `task.taskId`, `task.status`; store `taskId` and `pollInterval = invocation.result.task.pollInterval ?? 1000`.
4. **Act (polling loop):**  
   Loop until terminal status or timeout (e.g. 12 s):  
   `await new Promise(r => setTimeout(r, pollInterval));`  
   `const task = await client.getTask(taskId);`  
   If `task.status === "completed"`: `const result = await client.getTaskResult(taskId);` then break.  
   If `task.status === "failed"` or `"cancelled"`: assert and break.  
   Otherwise continue.
5. **Assert (final result):**  
   For completed: assert `result.content[0].type === "text"` and parsed text has expected message and `taskId`.
6. **Cleanup:** Handled by `afterEach` (disconnect, server stop).

**Helper (optional)**

- A small helper **`pollTaskUntilTerminal(client, taskId, pollIntervalMs, timeoutMs)`** that returns `{ status, result? }` could keep the test readable and reusable. Not required for a single test.

**Test name**

- e.g. **"should complete run-tool-as-task flow: callTool with taskOptions returns task reference, polling getTask/getTaskResult yields final result"** (or shorter: **"should run tool as task (callTool + task ref + poll getTask/getTaskResult)"**).

---

## 4. Server capability and fixture summary

- **Capability:** The test server already advertises **tasks** with **`requests.tools.call`** because `getTaskServerConfig()` sets `tasks: { list: true, cancel: true }` and `createMcpServer` adds `requests: { tools: { call: {} } }` when `config.tasks` is set. No change needed.
- **Fixture:** Use **optionalTask** from `getTaskServerConfig()`. It is an optional task tool; when the client sends `tools/call` with `params.task`, the server returns a task reference and the task completes after the configured delay. No new fixture is strictly required; we can add a small dedicated tool later if we want a more explicit “run as task e2e” fixture.

---

## 5. Out of scope (for this plan)

- **Receiver tasks:** Not covered; that is a separate feature and has its own implementation plan.
- **callToolStream:** Already well covered by existing Task Support tests; this plan only adds the **callTool + task reference + polling** path.
- **Web/App-level tests:** This plan is for InspectorClient-level e2e only (real server, real client, no mocks). App-level tests (e.g. “Run as task” checkbox, “Polling Task…” label) remain in the web app test suite.

---

## 6. Implementation checklist

- [ ] Add one new `it("...")` in the "Task Support" describe in `inspectorClient.test.ts`.
- [ ] In the test: call `client.callTool("optionalTask", { message: "e2e-run-as-task" }, undefined, undefined, { ttl: 5000 })`.
- [ ] Assert `invocation.result` has `task: { taskId, status, pollInterval? }`.
- [ ] Implement polling loop: wait `pollInterval`, `getTask(taskId)`, until status is completed/failed/cancelled (with timeout); on completed, call `getTaskResult(taskId)`.
- [ ] Assert final result content (message and taskId in parsed text).
- [ ] (Optional) Add a small helper for polling and/or a dedicated fixture tool; run tests to ensure no regressions.
