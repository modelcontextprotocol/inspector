# Tasks extension era fork (#1631) — proof screenshots

End-to-end verification of the Tasks era fork against two real test servers
(`test-servers/configs/tasks-modern-http.json` on port 3222 and
`tasks-legacy-http.json` on 3223), driven in a real browser through the web
client's remote-proxy transport.

## Modern era (2026-07-28, `io.modelcontextprotocol/tasks` extension)

![Modern task completed](tasks-modern-completed.png)

Connected with **Protocol Era = Modern** (`MCP 2026-07-28`). The **Tasks** tab is
gated on the negotiated `io.modelcontextprotocol/tasks` extension (not
`capabilities.tasks`). Running `modern_task` with **Run as task** on issues a
`tools/call` that returns a `CreateTaskResult` (`resultType: "task"`), then polls
**`tasks/get`** (no `tasks/list`); the completed task **inlines its result** (no
blocking `tasks/result`) — shown both in the Results panel and the Tasks card.

![Modern input_required → tasks/update](tasks-modern-input-required.png)

`modern_input_task` moves to **`input_required`**: the `tasks/get` response's
`inputRequests` map (visible in the task's Full Task Object) carries an embedded
`elicitation/create`, surfaced through the same pending-request modal the MRTR
path uses. Answering it sends **`tasks/update`** with the `inputResponses`, and
the next poll completes the task.

## Legacy era (2025-11-25, contrast — unchanged)

![Legacy run-as-task](tasks-legacy-run-as-task.png)

Connected with **Protocol Era = Legacy**. The Tasks tab is gated on
`capabilities.tasks`; `simple_task` is `taskSupport: "required"` so **Run as
task** is forced on. The legacy flow uses `tasks/list` to populate the list,
`tasks/get` to poll, and the blocking **`tasks/result`** to fetch the payload
(`{ "message": "Task completed: no message", "taskId": … }`). Note the legacy-only
**Logs** tab (this server advertises `logging`), absent from the modern monitor
set.

## Notes

- SDK v2 removed all tasks support **and** era-gates the `tasks/*` spec methods
  out of the 2026-07-28 era on **both** the client (outbound) and server
  (inbound), and its codec rejects a `resultType: "task"` result outright. So the
  Inspector drives the extension itself: the task-creation frame is rewritten at
  the transport into a `CallToolResult` carrying the handle (the true
  `resultType: "task"` frame is still logged to the Protocol/Network tabs), and
  `tasks/get` / `tasks/update` / `tasks/cancel` ride a raw-wire request channel
  that carries the full modern envelope and is consumed by the transport before
  the SDK Client sees it. The test server serves `tasks/*` from an Express
  interceptor ahead of the SDK handler (the SDK's modern leg would answer them
  `-32601`).
- On modern, task creation is **server-directed** (SEP-2663): the client declares
  the extension once and any tool may return a task, so the Tools screen offers
  **Run as task** for every tool on a modern connection (rather than gating on the
  legacy per-tool `taskSupport`).
