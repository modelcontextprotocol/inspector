# MCP Inspector CLI Client

The CLI mode enables programmatic interaction with MCP servers from the command line. It is ideal for scripting, automation, continuous integration, and establishing an efficient feedback loop with AI coding assistants.

## Running the CLI

You can run the CLI client directly via `npx`:

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js
```

The CLI mode supports operations across tools, resources, and prompts, returning structured JSON output.

### Examples

**Basic usage**

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js
```

**With a configuration file**

```bash
npx @modelcontextprotocol/inspector --cli --config path/to/config.json --server myserver
```

**List available tools**

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js --method tools/list
```

**Call a specific tool**

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js --method tools/call --tool-name mytool --tool-arg key=value --tool-arg another=value2
```

**Call a tool with JSON arguments**

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js --method tools/call --tool-name mytool --tool-arg 'options={"format": "json", "max_tokens": 100}'
```

**List available resources**

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js --method resources/list
```

**List available prompts**

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js --method prompts/list
```

### Remote Servers

You can also connect to remote MCP servers using HTTP or SSE transports.

**Connect to a remote MCP server (default is SSE)**

```bash
npx @modelcontextprotocol/inspector --cli https://my-mcp-server.example.com
```

**Connect with Streamable HTTP transport**

```bash
npx @modelcontextprotocol/inspector --cli https://my-mcp-server.example.com --transport http --method tools/list
```

**Pass custom headers**

```bash
npx @modelcontextprotocol/inspector --cli https://my-mcp-server.example.com --transport http --method tools/list --header "X-API-Key: your-api-key"
```

When a server is loaded from a `--catalog`/`--config` file, its per-server settings (headers, connection/request timeouts, and OAuth) are applied to the connection — the same resolution the TUI uses. A `--header` flag overrides the file's headers for that run while leaving the file's timeouts and OAuth in place.

**Environment-variable semantics.** `MCP_CATALOG_PATH` is honored only when no ad-hoc target is given (positional command, `--server-url`, or `--transport`) — so a shell that exports it can still run one-off ad-hoc invocations without hitting the catalog/ad-hoc conflict. `MCP_STORAGE_DIR` sets the storage directory used by the OAuth persist backend (`<MCP_STORAGE_DIR>/oauth.json`); the per-file `MCP_INSPECTOR_OAUTH_STATE_PATH` override still takes precedence over it.

### HTTP proxy support

Connections to remote HTTP/SSE servers honor the conventional proxy environment variables: `HTTPS_PROXY` / `HTTP_PROXY` (and their lowercase forms) select the proxy, and `NO_PROXY` exempts hosts. This applies to the Node transport shared by the CLI and the web backend — no inspector-specific flag is needed. When a proxy variable is set, outbound requests are routed through undici's `EnvHttpProxyAgent`.

Proxy routing is powered by the [`undici`](https://www.npmjs.com/package/undici) package (`^8.5.0`, which requires Node `>= 22.19.0` — the inspector's supported floor). It is imported lazily only when a proxy variable is set, so runs without a proxy configured pay no cost.

## Options

### MCP server (which server to connect to)

Options that specify the MCP server (catalog/config file, ad-hoc command/URL, env vars, headers) are shared by the Web, CLI, and TUI and are documented in [MCP server configuration](../../docs/mcp-server-configuration.md): `--catalog` (writable catalog, seeded if missing; default `~/.mcp-inspector/mcp.json` or `MCP_CATALOG_PATH`), `--config` (read-only session, errors if absent), `--server`, `-e`, `--cwd`, `--header`, `--transport`, `--server-url`, and the positional `[target...]`. `--catalog` and `--config` are mutually exclusive, and neither combines with an ad-hoc target.

### CLI-specific (what to invoke)

| Option                        | Description                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `--method <method>`           | MCP method to invoke. Supports `initialize` (connect-only probe → `{serverInfo, protocolVersion, capabilities, instructions}`), `tools/list`, `tools/call`, `resources/list`, `resources/read`, `resources/templates/list`, `prompts/list`, `prompts/get`, `logging/setLevel`. |
| `--tool-name <name>`          | Tool name (for `tools/call`).                                                             |
| `--tool-arg <key=value>`      | Tool argument; repeat for multiple. Use `key='{"json":true}'` for JSON. Values are coerced (JSON-parsed, so `count=1` becomes a number). |
| `--tool-args-json <json>`     | Tool arguments as a single JSON object (e.g. `'{"zip":"10001"}'`). Passed verbatim — no `key=value` coercion, so `"012"` stays a string. Mutually exclusive with `--tool-arg`. |
| `--uri <uri>`                 | Resource URI (for `resources/read`).                                                      |
| `--prompt-name <name>`        | Prompt name (for `prompts/get`).                                                          |
| `--prompt-args <key=value>`   | Prompt arguments; repeat for multiple.                                                    |
| `--log-level <level>`         | Logging level for `logging/setLevel` (e.g. `debug`, `info`).                              |
| `--metadata <key=value>`      | General metadata (key=value); applied to all methods.                                     |
| `--tool-metadata <key=value>` | Tool-specific metadata for `tools/call`.                                                  |
| `--connect-timeout <ms>`      | Connection timeout in ms. Defaults to `15000` for ad-hoc `--server-url`/target runs (so a black-holed host fails fast) and to the file-level timeout for `--catalog`/`--config` runs. `0` disables the timeout. |
| `--app-info`                  | Probe a tool's MCP App UI metadata without invoking it. With `--method tools/call --tool-name <name>`: prints one JSON line (`hasApp`, `resourceUri`, `csp`, `permissions`, `domain`, …) and exits `0` if the tool has an app or `2` (`no_app`) if not. With `--method tools/list`: emits NDJSON — one app-info line per tool over a single connection. |
| `--format <text\|json>`       | Output format. `text` (default) pretty-prints the result. `json` emits a single JSON object on stdout (`{ "result": … }`, plus `{ "appInfo": … }` as a sibling key for App tools) with no banners, so the whole output pipes cleanly into `jq`. |

#### App probing (`--app-info`) and machine-readable output (`--format json`)

`--app-info` inspects a tool's [MCP App](https://modelcontextprotocol.io) UI posture **without calling the tool**, so a pipeline can decide whether to open a browser before touching one:

```bash
# Probe one tool. Exits 0 (has app) or 2 (no_app). One JSON line on stdout.
mcp-inspector --cli <server> --method tools/call --tool-name my_tool --app-info
# → {"hasApp":true,"toolName":"my_tool","resourceUri":"ui://…","csp":{…},"permissions":{…},"prefersBorder":true,"resourceMimeType":"text/html"}

# Probe every tool at once — NDJSON, one line per tool, single connection.
mcp-inspector --cli <server> --method tools/list --app-info | jq -c 'select(.hasApp)'
```

Exit semantics: a tool that **has** an app exits `0`; one with **no** app exits `2` (`no_app`); a **missing** tool exits `5` (`tool_not_found`) — distinct so a typo isn't mistaken for "no app". A resource-read failure during the probe is tolerated and reported in a `resourceError` field rather than aborting.

`--format json` wraps any method's output in a single stdout envelope with no banners, so App tools and plain tools both pipe cleanly into `jq`:

```bash
mcp-inspector --cli <server> --method tools/call --tool-name my_app_tool --format json
# → {"result":{…tool result…},"appInfo":{"hasApp":true,"resourceUri":"ui://…",…}}
```

A `tools/call` that returns `isError:true` still prints its payload but exits `5` (`tool_is_error`) so `&&` chains don't proceed on a failed call.

### CLI-specific (OAuth for HTTP servers)

The CLI runs the same loopback callback server as the TUI (`http://127.0.0.1:6276/oauth/callback` by default). On connect **401** or mid-session interactive auth (re-login / step-up), it:

1. Starts the callback listener on `--callback-url` (or `MCP_OAUTH_CALLBACK_URL`)
2. Prints the authorization URL to the console (`ConsoleNavigation`)
3. Waits for the browser redirect, exchanges the code, and retries connect or the failed RPC

**Step-up (standard OAuth):** when an RPC needs extra scopes, the CLI prompts on stderr: `Proceed with step-up authorization? [y/N]`. **y** continues; **N** exits with an error. EMA step-up re-mints silently (no prompt).

**Shared OAuth storage:** the CLI **reuses** tokens from `~/.mcp-inspector/storage/oauth.json` when they already exist (same file as other Inspector clients). That is passive file sharing, not launching another app.

**Shared with TUI** (config only, not interactive login):

- Per-server OAuth fields from `mcp.json` (static client, EMA resource credentials, scopes)
- Install-level settings from **`~/.mcp-inspector/storage/client.json`** (or `--client-config` / `MCP_CLIENT_CONFIG_PATH`) — EMA IdP, CIMD
- CLI flags `--client-id`, `--client-secret`, `--client-metadata-url` override `client.json` when set
- Keychain-backed secrets in `mcp.json` are rehydrated on catalog load (same as TUI)

#### OAuth callback URL

| Surface | Default callback |
| ------- | ---------------- |
| **Web** | `http://localhost:6274/oauth/callback` |
| **TUI** | `http://127.0.0.1:6276/oauth/callback` (interactive — callback server) |
| **CLI** | `http://127.0.0.1:6276/oauth/callback` (interactive — same callback server as TUI) |

Register `http://127.0.0.1:6276/oauth/callback` on static or enterprise IdPs that require pre-registered redirect URIs before using the **TUI** or **CLI**. Override with `--callback-url` or `MCP_OAUTH_CALLBACK_URL`. Only one process should bind the default port at a time.

#### Flags

| Option                        | Env                      | Description                                                                                      |
| ----------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| `--client-config <path>`      | `MCP_CLIENT_CONFIG_PATH` | Install-level client config (default: `~/.mcp-inspector/storage/client.json`).                   |
| `--client-id <id>`            | —                        | OAuth client ID (static client); overrides `client.json`.                                        |
| `--client-secret <secret>`    | —                        | OAuth client secret; overrides `client.json`.                                                    |
| `--client-metadata-url <url>` | —                        | CIMD metadata URL; overrides `client.json`.                                                      |
| `--callback-url <url>`        | `MCP_OAUTH_CALLBACK_URL` | Redirect URI sent to the authorization server (default: `http://127.0.0.1:6276/oauth/callback`). |

**Example** — list tools on an OAuth-protected server using stored tokens and CIMD from the command line:

```bash
npx @modelcontextprotocol/inspector --cli --catalog mcp.json --server my-http-server \
  --client-metadata-url https://example.com/.well-known/oauth/client-metadata.json \
  --method tools/list
```

See [EMA / enterprise-managed auth](../../specification/v2_auth_ema.md) and [OAuth smoke testing](../../specification/v2_auth_smoke_testing.md) (§3 Stytch/CIMD; [§5 mid-session manual validation](../../specification/v2_auth_smoke_testing.md#5-mid-session-auth--step-up--manual-validation) — CLI **C1–C2**).

## Exit codes & error envelopes

Every non-zero exit maps to a stable failure class, so a programmatic caller
(CI, a script, an agent) can branch on _why_ the CLI failed without scraping
prose from stderr:

| Code | Meaning |
| ---- | ------- |
| `0` | Success. |
| `1` | Usage / unexpected error (the catch-all). |
| `2` | No MCP App found on the tool (`--app-info` probe). |
| `3` | Server requires authentication (401/403, `WWW-Authenticate`, OAuth). |
| `4` | Server unreachable (DNS, connection refused, timeout, `fetch failed`). |
| `5` | Tool error (`tools/call` returned `isError:true`, or the tool was not found). |

On any non-zero exit the CLI also writes a single JSON line to **stderr** — the
`ErrorEnvelope`:

```json
{ "error": { "code": "auth_required", "message": "Unauthorized", "status": 401, "url": "https://api.example/mcp" } }
```

The `code` is a stable identifier for the failure class; `message` is the
human-readable error; `cause`, `status`, and `url` are included when known.
Because it is one line, a caller can parse it with `2>&1 | tail -1 | jq .error`.

## Why use the CLI?

While the Web Client provides a rich visual interface, the CLI is designed for:

- **Automation**: Ideal for CI/CD pipelines and batch processing.
- **AI Coding Assistants**: Provides a direct, machine-readable interface (JSON) for tools like Cursor or Claude to verify changes immediately.
- **Log Analysis**: Easier integration with command-line utilities (like `jq`) to process and analyze MCP server output.

## Development

Like the other clients, the CLI self-validates from its own folder:

```bash
npm run validate       # format:check && lint && test:coverage
npm test               # build test-servers + binary, then run all tests
npm run test:coverage  # build + tests under the per-file coverage gate
```

The CLI's `test:coverage` **builds the binary first** (its out-of-process
`e2e.test.ts` spawns it, so it must run against a fresh build). `validate`
therefore folds the build into `test:coverage` rather than repeating it — it is
`format:check && lint && test:coverage`, with no separate `build` step (the
other clients, whose tests don't spawn their bundle, keep an explicit `build`).
The repo-root `validate:cli` just delegates here.

Tests run the CLI **in-process** (importing `runCli()`) so `src/` is measured
under coverage, with a thin out-of-process spawn layer for the real binary. See
[`__tests__/README.md`](./__tests__/README.md) for details.
