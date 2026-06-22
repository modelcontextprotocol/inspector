# Reviewing an MCP App with the Inspector

This recipe is for automated reviewers (CI, agents) that need to inspect an MCP
server's App tools — the tools that bind a UI widget to a tool result via
`_meta.ui.resourceUri`. It uses the **CLI for everything that has a JSON
answer** and drops to a browser **only** to render the widget itself.

## 1. Probe: does the tool have an App, and what is its security posture?

```bash
npx @modelcontextprotocol/inspector --cli \
  --transport http --server-url https://example.com/mcp \
  --method tools/call --tool-name <tool> --app-info
```

Stdout is one JSON line; the process exits **0** when the tool has an App,
**2** when it does not (so a shell `&&` chain can short-circuit). Example
output for an App tool:

```json
{
  "hasApp": true,
  "toolName": "get_pros",
  "resourceUri": "ui://pros/view.html",
  "visibility": ["model", "app"],
  "csp": { "connectDomains": ["https://api.example.com"] },
  "permissions": { "clipboard": false },
  "prefersBorder": true,
  "resourceMimeType": "text/html"
}
```

`csp` / `permissions` / `domain` come from the UI **resource** (per the spec
they live on the resource, not the tool); `--app-info` reads the resource for
you. Nothing here invokes the tool.

## 2. Full result payload (still no browser)

```bash
npx @modelcontextprotocol/inspector --cli \
  --transport http --server-url https://example.com/mcp \
  --method tools/call --tool-name <tool> --tool-arg key=value
```

Stdout is the pretty-printed `CallToolResult`. For App tools an
`--- MCP App Info ---` block is appended after the result with the same fields
as `--app-info`.

## 3. Launch the web inspector once, loopback-only

```bash
TOKEN="$(openssl rand -hex 24)"
HOST=127.0.0.1 CLIENT_PORT=6274 MCP_SANDBOX_PORT=6275 \
MCP_AUTO_OPEN_ENABLED=false MCP_INSPECTOR_API_TOKEN="$TOKEN" \
npx @modelcontextprotocol/inspector --web &
```

`HOST=127.0.0.1` binds the API and sandbox servers to loopback only. The token
is also the deep-link auth gate (next step).

## 4. One deep-link navigate, one click, one screenshot

The deep-link URL shape is:

```
http://127.0.0.1:6274/?serverUrl=<url-encoded server URL>
  &transport=http
  &autoConnect=<TOKEN>
  &openApp=<tool name>
  &appArgs=<base64url(JSON args)>
```

`autoConnect` **must equal** `MCP_INSPECTOR_API_TOKEN`; the page rejects any
other value, so a link minted by a third party cannot drive the connect.

Loading this URL connects to the server, switches to the **Apps** tab, selects
the named app, and pre-fills `appArgs` as the form values. The remaining step
is one explicit "Open App" click — kept as an explicit user (or driver) action
so the deep link itself never auto-invokes a tool against the target server.

```js
// Playwright (or any driver), using the testids the inspector exposes:
const args = Buffer.from(JSON.stringify({ zip: "10001" }))
  .toString("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "");
const url =
  `http://127.0.0.1:6274/?serverUrl=${encodeURIComponent(serverUrl)}` +
  `&transport=http&autoConnect=${TOKEN}&openApp=${tool}&appArgs=${args}`;

await page.goto(url);
await page.waitForSelector(
  '[data-testid="connection-status"][data-status="connected"]',
);
await page.click('[data-testid="apps-stage"] button:has-text("Open App")');
await page.waitForSelector('[data-testid="apps-stage"] iframe');
await page.locator('[data-testid="apps-stage"]').screenshot({ path: out });
```

That is the entire browser interaction: one navigate, one click, one
screenshot. Everything else is CLI.

The form area (excluding the sidebar search filter) is
`[data-testid="apps-form"]` — use `[data-testid="apps-form"] input` to assert
that `appArgs` landed, or to fill a field the server requires that was not
passed in the URL.

## Local fixture

The bundled test server includes an `mcp_app_demo` tool (preset
`mcp_app_demo` + resource preset `mcp_app_demo_widget`) whose widget reports
`size-changed`, sends one `ui/message`, emits one log notification, and renders
its received `hostContext` — useful for verifying the host side of the UI
protocol end-to-end without a remote server.
