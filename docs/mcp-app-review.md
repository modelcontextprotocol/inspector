# Reviewing an MCP App with the Inspector

This recipe is for automated reviewers (CI, agents) that need to inspect an MCP
server's **App tools** — the tools that bind a UI widget to a tool result via
`_meta.ui.resourceUri`. It uses the **CLI for everything that has a JSON
answer** and drops to a browser **only** to render the widget itself.

The flow: probe with `--app-info` → build a deep link → drive the rendered
widget, with no manual form-filling in between. It is the composition of the
Wave-2 (spec-conformant Apps host) and Wave-3/4 (programmatic review path)
work; each surface below links to the client README that owns its full contract.

## 1. Probe: does the tool have an App, and what is its security posture?

```bash
npx @modelcontextprotocol/inspector --cli \
  --transport http --server-url https://example.com/mcp \
  --method tools/call --tool-name <tool> --app-info
```

Stdout is one JSON line; the process exits **0** when the tool has an App and
**2** (`no_app`) when it does not, so a shell `&&` chain can short-circuit.
Example output for an App tool:

```json
{
  "hasApp": true,
  "toolName": "get_pros",
  "resourceUri": "ui://pros/view.html",
  "csp": { "connectDomains": ["https://api.example.com"] },
  "permissions": { "clipboard": false },
  "prefersBorder": true,
  "resourceMimeType": "text/html"
}
```

`csp` / `permissions` / `domain` come from the UI **resource** (per the spec
they live on the resource, not the tool); `--app-info` reads the resource for
you. Nothing here invokes the tool. To probe every tool at once, use
`--method tools/list --app-info` (NDJSON, one line per tool, single
connection). See [clients/cli/README.md](../clients/cli/README.md) for the full
flag reference and exit-code map.

## 2. Full result payload (still no browser)

```bash
npx @modelcontextprotocol/inspector --cli \
  --transport http --server-url https://example.com/mcp \
  --method tools/call --tool-name <tool> --tool-args-json '{"zip":"10001"}'
```

Stdout is the pretty-printed `CallToolResult`; for App tools an
`--- MCP App Info ---` block is appended. Add `--format json` to emit a single
`{ "result": …, "appInfo": … }` object that pipes cleanly into `jq`.
`--tool-args-json` passes the arguments verbatim (no `key=value` coercion), so
`"012"` stays a string.

## 3. Launch the web inspector once, loopback-only

```bash
TOKEN="$(openssl rand -hex 24)"
HOST=127.0.0.1 CLIENT_PORT=6274 MCP_SANDBOX_PORT=6275 \
MCP_AUTO_OPEN_ENABLED=false MCP_INSPECTOR_API_TOKEN="$TOKEN" \
npx @modelcontextprotocol/inspector --web &
```

`HOST=127.0.0.1` binds the API and sandbox servers to loopback only. The token
is also the deep-link auth gate (next step).

## 4. One deep-link navigate → a rendered widget

The deep-link URL shape (owned by
[clients/web/README.md](../clients/web/README.md#deep-link-auto-connect)):

```
http://127.0.0.1:6274/?serverUrl=<url-encoded server URL>
  &transport=http|sse
  &autoConnect=<TOKEN>
  &openApp=<tool name>
  &appArgs=<base64url(JSON args)>
  &autoOpen=<TOKEN>
```

`autoConnect` **must equal** `MCP_INSPECTOR_API_TOKEN`; the page rejects any
other value, so a link minted by a third party cannot drive the connect.
Loading the URL connects to the server, switches to the **Apps** tab, selects
`openApp`, and pre-fills `appArgs` (merged **over** the tool's schema defaults,
so a required-with-default field doesn't leave "Open App" disabled).

`appArgs` is `base64url(JSON)`:

```js
const args = Buffer.from(JSON.stringify({ zip: "10001" }))
  .toString("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "");
```

`autoOpen=<TOKEN>` (same token gate) fires "Open App" automatically — a tool
call from a URL, which is why it is gated. Omit it to stop at the pre-filled
form and click "Open App" yourself.

The inspector exposes a stable `data-testid` / `data-*` contract (documented in
[clients/web/README.md](../clients/web/README.md)) so a driver waits on
deterministic signals instead of sleeping:

```js
// Playwright (or any driver). With autoOpen set, no click is needed.
const url =
  `http://127.0.0.1:6274/?serverUrl=${encodeURIComponent(serverUrl)}` +
  `&transport=http&autoConnect=${TOKEN}` +
  `&openApp=${tool}&appArgs=${args}&autoOpen=${TOKEN}`;

await page.goto(url);
// Connection surface: poll data-status; read data-error-message on failure.
await page.waitForSelector(
  '[data-testid="connection-status"][data-status="connected"]',
);
// App render lifecycle: idle → loading → ready (or error).
await page.waitForSelector('[data-app-status="ready"]');
await page.locator('[data-testid="apps-form"]').screenshot({ path: out });
```

Without `autoOpen`, click the button first:
`await page.click('[data-testid="open-app"]')`, then wait on
`[data-app-status="ready"]`. If the connect is rejected (bad token / non-http
serverUrl), `[data-testid="connection-status"]` carries
`data-deeplink="rejected"` and `data-error-message` — read those instead of
scraping a toast.

## 5. OAuth-gated servers

When the target server requires OAuth, complete the flow once in the **web**
inspector — the credential is written through the backend to
`~/.mcp-inspector/storage/oauth.json`, so the **CLI** on the same machine can
reuse it:

```bash
npx @modelcontextprotocol/inspector --cli \
  --transport http --server-url "$SERVER_URL" \
  --use-stored-auth --method tools/list
```

`--use-stored-auth` looks up the stored state for `$SERVER_URL` (keyed by
`new URL().href` normalization, so pass the same URL you gave the web
inspector). When a `refresh_token` is stored it runs the OAuth refresh grant
and injects the **fresh** access token, persisting the rotation back to the
state file; otherwise it injects the stored access token. A failed refresh
(revoked token) exits `3` (`auth_required`). Use `--wait-for-auth <sec>` to
block until a human completes the flow in a browser, and `--print-handoff` to
emit the deep link + port-forward command a remote VM needs (see
[clients/cli/README.md](../clients/cli/README.md)).

Connection state persists in `~/.mcp-inspector/` between runs. For a clean
slate between reviews of different servers, `rm -rf ~/.mcp-inspector` before
launching.

## 6. Reaching the web inspector remotely (SSH port-forward)

When the backend runs on another host and you want to complete OAuth or
visually inspect a rendered App from your local browser, forward **both**
ports:

```bash
ssh -L 6274:127.0.0.1:6274 -L 6275:127.0.0.1:6275 <remote-host>
```

Then open `http://127.0.0.1:6274/?MCP_INSPECTOR_API_TOKEN=$TOKEN` locally.

- Use `127.0.0.1`, **not** `localhost` — the backend's origin guard checks the
  literal `Origin` header against the configured `HOST`.
- Forward `:6275` (`MCP_SANDBOX_PORT`) as well: the Apps tab renders widgets in
  an iframe served from that second origin; without it the App frame stays
  blank.
- Forward the **same** local port number you bind on the remote — the browser
  sends `Origin: http://127.0.0.1:<local-port>` and the backend compares it to
  its own port.
- The OAuth credential ends up in `~/.mcp-inspector/storage/oauth.json` on the
  **remote** host, so a CLI invocation there can pick it up with
  `--use-stored-auth` (§ 5).

## 7. Reaching the target server through an HTTP proxy

The CLI's outbound connections honor the standard `HTTPS_PROXY` / `HTTP_PROXY`
/ `NO_PROXY` environment variables:

```bash
HTTPS_PROXY=http://proxy.example:3128 \
npx @modelcontextprotocol/inspector --cli \
  --transport http --server-url "$SERVER_URL" --method tools/list
```

Per-scheme routing and `NO_PROXY` exclusions are handled by undici's
`EnvHttpProxyAgent`, imported lazily only when a proxy variable is set — runs
without a proxy pay no cost. See
[clients/cli/README.md](../clients/cli/README.md#http-proxy-support).

## Local fixture

The bundled test server includes an `mcp_app_demo` tool (presets `mcp_app_demo`
and `mcp_app_demo_widget`) whose widget reports `size-changed`, sends one
`ui/message`, emits one log notification, and renders its received `hostContext`
— useful for verifying the host side of the UI protocol end-to-end without a
remote server.
