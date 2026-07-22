# x-mcp-header Tools tooling (#1632) — proof screenshots

End-to-end verification of the SEP-2243 `x-mcp-header` Tools tooling against a
real modern (2026-07-28) HTTP test server
(`test-servers/configs/xmcpheader-modern-http.json` on port 3120), driven in a
real browser through the web client's remote-proxy transport.

![Excluded tools in the sidebar](xmcpheader-excluded-tools.png)

Connected with **Protocol Era = Modern**. `invalid_header_tool` is dropped from
`tools/list` by the SDK (its `x-mcp-header` annotation is invalid), so the
Inspector re-lists the raw list and surfaces it struck-through under an
**"Excluded (SEP-2243)"** divider — showing _why_ a tool vanished rather than
silently omitting it.

![Exclusion reason on hover](xmcpheader-excluded-reason.png)

Hovering the excluded tool shows the exact scan reason: the header name
`"Bad Header"` contains a space, so it is not a valid RFC 9110 token.

![Mirrored request headers](xmcpheader-mirrored-headers.png)

`get_weather`'s detail panel shows the **"Mirrored request headers (SEP-2243)"**
section: its `city` argument mirrors to `Mcp-Param-City`, with the note that the
SDK omits `Mcp-Param-*` on the browser transport.

![Unknown tool -32602](xmcpheader-unknown-tool.png)

Calling a tool the server no longer recognizes rejects with **`-32602`** (SDK v2)
instead of an `isError` result, and renders as an **"Unknown Tool"** error panel
with a targeted hint (reproduced by swapping the sessionless server to one
without `echo` while the cached list still showed it).

![Invalid params -32602](xmcpheader-invalid-params.png)

`-32602` is the generic _Invalid params_ code, so a **known** tool rejected for
bad arguments throws the same code as an unknown tool. The panel disambiguates
from the message: a `-32602` that does not name an unknown tool renders under
**"Invalid Parameters"** (with a schema hint) rather than "Unknown Tool".
Triggered live via the `trigger_invalid_params` tool, which returns a real
`-32602` JSON-RPC error whose message is not about a missing tool.

---

# Tasks extension era fork (#1631) — proof screenshots

End-to-end verification of the Tasks era fork against two real test servers
(`test-servers/configs/tasks-modern-http.json` on port 3222 and
`tasks-legacy-http.json` on 3223), driven in a real browser through the web
client's remote-proxy transport.

## Modern era (2026-07-28, `io.modelcontextprotocol/tasks` extension)

![Modern connected, Tasks tab present](tasks-modern-connected.png)

Connected with **Protocol Era = Modern** (`MCP 2026-07-28`). The **Tasks** tab
appears in the monitoring sidebar because the `io.modelcontextprotocol/tasks`
extension was negotiated (it is empty until a task runs).

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
path uses — note the accurate wording _"your answer is submitted via a
tasks/update request (SEP-2663), not a retry"_. Answering it sends
**`tasks/update`** with the `inputResponses`, and the next poll completes the
task:

![Modern input task completed](tasks-modern-input-completed.png)

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
