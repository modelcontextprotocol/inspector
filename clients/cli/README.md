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

### HTTP proxy support

Connections to remote HTTP/SSE servers honor the conventional proxy environment variables: `HTTPS_PROXY` / `HTTP_PROXY` (and their lowercase forms) select the proxy, and `NO_PROXY` exempts hosts. This applies to the Node transport shared by the CLI and the web backend — no inspector-specific flag is needed. When a proxy variable is set, outbound requests are routed through undici's `EnvHttpProxyAgent`.

Proxy routing is powered by the [`undici`](https://www.npmjs.com/package/undici) package (`^8.5.0`, which requires Node `>= 22.19.0` — the inspector's supported floor). It is imported lazily only when a proxy variable is set, so runs without a proxy configured pay no cost.

## Options

### MCP server (which server to connect to)

Options that specify the MCP server (catalog/config file, ad-hoc command/URL, env vars, headers) are shared by the Web, CLI, and TUI and are documented in [MCP server configuration](../../docs/mcp-server-configuration.md): `--catalog` (writable catalog, seeded if missing; default `~/.mcp-inspector/mcp.json` or `MCP_CATALOG_PATH`), `--config` (read-only session, errors if absent), `--server`, `-e`, `--cwd`, `--header`, `--transport`, `--server-url`, and the positional `[target...]`. `--catalog` and `--config` are mutually exclusive, and neither combines with an ad-hoc target.

### CLI-specific (what to invoke)

| Option                        | Description                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `--method <method>`           | MCP method to invoke (e.g. `tools/list`, `tools/call`, `resources/list`, `prompts/list`). |
| `--tool-name <name>`          | Tool name (for `tools/call`).                                                             |
| `--tool-arg <key=value>`      | Tool argument; repeat for multiple. Use `key='{"json":true}'` for JSON.                   |
| `--uri <uri>`                 | Resource URI (for `resources/read`).                                                      |
| `--prompt-name <name>`        | Prompt name (for `prompts/get`).                                                          |
| `--prompt-args <key=value>`   | Prompt arguments; repeat for multiple.                                                    |
| `--log-level <level>`         | Logging level for `logging/setLevel` (e.g. `debug`, `info`).                              |
| `--metadata <key=value>`      | General metadata (key=value); applied to all methods.                                     |
| `--tool-metadata <key=value>` | Tool-specific metadata for `tools/call`.                                                  |

### CLI-specific (OAuth for HTTP servers)

The CLI **reuses** OAuth tokens from `~/.mcp-inspector/storage/oauth.json` (same file as the TUI). Complete first-time authorization in the **web** or **TUI** client, then run one-shot CLI commands against HTTP/SSE servers without signing in again.

The CLI does **not** start a local callback server or retry connect on 401. If tokens are missing or expired, connect fails; `ConsoleNavigation` may print an authorize URL to stdout, but the CLI cannot finish the redirect flow. Use the TUI for interactive runner OAuth until Phase 4 adds a CLI callback server.

**Shared with TUI** (config only, not interactive login):

- Per-server OAuth fields from `mcp.json` (static client, EMA resource credentials, scopes)
- Install-level settings from **`~/.mcp-inspector/storage/client.json`** (or `--client-config` / `MCP_CLIENT_CONFIG_PATH`) — EMA IdP, CIMD
- CLI flags `--client-id`, `--client-secret`, `--client-metadata-url` override `client.json` when set
- Keychain-backed secrets in `mcp.json` are rehydrated on catalog load (same as TUI)

#### OAuth callback URL

| Surface | Default callback                                                                          |
| ------- | ----------------------------------------------------------------------------------------- |
| **Web** | `http://localhost:6274/oauth/callback`                                                    |
| **TUI** | `http://127.0.0.1:6276/oauth/callback` (interactive — callback server)                    |
| **CLI** | `http://127.0.0.1:6276/oauth/callback` (redirect URI in OAuth metadata only; no listener) |

Register `http://127.0.0.1:6276/oauth/callback` on static or enterprise IdPs that require pre-registered redirect URIs before using the **TUI** (or when your OAuth app expects that URI). Override with `--callback-url` or `MCP_OAUTH_CALLBACK_URL`. The CLI passes this value as `redirect_uri` when an OAuth flow runs, but does not listen on the port.

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

See [EMA / enterprise-managed auth](../../specification/v2_auth_ema.md) and [OAuth smoke testing](../../specification/v2_auth_smoke_testing.md) for configuration details and staging servers.

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
