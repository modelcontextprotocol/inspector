# Environment variables

Every environment variable that changes how the Inspector behaves at runtime, in one place: the Inspector's own variables, plus the standard system and Node variables it reads (`HOME`, the proxy variables, the Node TLS variables). Set them in the shell that launches `mcp-inspector` (or with `-e` for the [Docker image](./docker.md)).

The **Read by** column names the client whose process reads the variable: **web** is the Node backend that `--web` starts (the browser itself reads no environment), **CLI** and **TUI** are those clients, and **launcher** is the `mcp-inspector` bin that picks one of them. A variable read in shared `core/` code is marked with every client that reaches it.

⚠️ **Unset a variable rather than setting it to an empty string.** The two are not interchangeable: `HOST=""` is read as an all-interfaces bind and refused, and an empty path variable such as `MCP_STORAGE_DIR=` or `MCP_INSPECTOR_LOG_DIR=` can resolve relative to the working directory instead of falling back to the default. A row says so explicitly where an empty value is treated as unset.

A `~` in a default below means the home directory as described under [Home directory](#home-directory).

## Authentication and network exposure

These guard the web backend, which spawns processes on request. Read [Host binding and the origin allow-list](../clients/web/README.md#host-binding--the-origin-allow-list) before widening any of them.

| Variable                          | Read by  | Default                   | Effect                                                                                                                                                                                                                                                         |
| --------------------------------- | -------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_INSPECTOR_API_TOKEN`         | web, CLI | a random token per launch | Bearer token guarding every `/api/*` route (`x-mcp-remote-auth: Bearer <token>`). Set it to use a known token instead of the generated one printed in the launch banner. The CLI reads it only to fill the `autoConnect` parameter of the deep link it emits. |
| `MCP_PROXY_AUTH_TOKEN`            | web      | —                         | **Deprecated** v1 name for `MCP_INSPECTOR_API_TOKEN`, used only when the new name is unset.                                                                                                                                                                    |
| `DANGEROUSLY_OMIT_AUTH`           | web      | unset                     | Disables the API token entirely when set to `true` or `1` (trimmed, case-insensitive). Any other value — including `false`, `0` and empty — keeps auth on.                                                                                                                    |
| `HOST`                            | web, CLI | `127.0.0.1`               | Address the web server binds. An all-interfaces host (`0.0.0.0`, `::`, an empty string, and equivalent spellings) is **refused** unless `DANGEROUSLY_BIND_ALL_INTERFACES` is enabled. The CLI reads it only to build its deep link.                           |
| `DANGEROUSLY_BIND_ALL_INTERFACES` | web      | off                       | Opts in to an all-interfaces `HOST`. Only `true` or `1` (case-insensitive) enable it, so `false` reads as off. The Docker image sets it.                                                                                                                        |
| `ALLOWED_ORIGINS`                 | web      | derived from `HOST`       | Comma-separated origins allowed to call the API. Unset, the list follows `HOST` at `CLIENT_PORT`: the loopback origins for a loopback host, the loopback origins plus `http://0.0.0.0` and `http://[::]` for an all-interfaces bind, and otherwise only the configured host's own origin (so binding a LAN address does **not** also allow `localhost`). **Replaces** the default list rather than adding to it, so list every form you browse from. Each entry must include the scheme (`http://localhost:6274`). The same list is the MCP Apps sandbox proxy's embedder allow-list (its `frame-ancestors` header and its referrer check), so a public Inspector origin must be listed here for the Apps tab to render. |

## Ports

| Variable              | Read by  | Default | Effect                                                                                                                                                                                                                                                            |
| --------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLIENT_PORT`         | web, CLI | `6274`  | Web UI port. Must be a **fixed** integer in 1–65535: `0` (an OS-assigned port) is rejected at startup, because the origin allow-list and the MCP Apps sandbox CSP are derived from it.                                                                          |
| `MCP_SANDBOX_PORT`    | web, CLI | `6275`  | Port of the MCP Apps sandbox server, 0–65535. `0` asks the OS for a free port. An invalid value is ignored with a warning.                                                                                                                                       |
| `SERVER_PORT`         | web      | —       | v1's proxy port, now only a fallback for the sandbox port: used whenever `MCP_SANDBOX_PORT` does not yield a valid port — unset, empty, **or invalid**.                                                                                                          |
| `MCP_APP_ORIGIN_PORT` | web, CLI | `6278`  | Port of the dedicated app-origin server, used only by an MCP App whose UI resource declares `_meta.ui.domain`; 0–65535, where `0` asks the OS for a free port. An invalid value is ignored with a warning. Pin it if your app's backend allowlists that origin. |

The sandbox port resolves as: a valid `MCP_SANDBOX_PORT`, else a valid `SERVER_PORT`, else `6275`. The CLI reads `CLIENT_PORT`, `MCP_SANDBOX_PORT`, `MCP_APP_ORIGIN_PORT` and `HOST` only to build the deep link and port list it hands to a web session; it binds none of them. It normalizes `HOST` (an all-interfaces host becomes `localhost`, any other host is canonicalized), but it validates none of the three **port** variables: any non-empty port value is copied into the URLs and port-forwarding command as-is, with no range check, no warning, and no `SERVER_PORT` fallback, so a malformed value produces a broken hand-off rather than an error.

## Public addresses (reverse proxy)

The sandbox and app-origin servers advertise a URL built from their own bind (`http://localhost:6275/sandbox` under a wildcard bind). Behind a reverse proxy or an ingress, where the browser reaches them at a public hostname, set the address the browser should use instead. Neither changes what is bound: the process still listens on the port above, and routing the public address to it is the proxy's job. See [Behind a reverse proxy](../clients/web/README.md#host-binding--the-origin-allow-list).

| Variable                      | Read by | Default                                 | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_SANDBOX_FULL_ADDRESS`    | web     | `http://<bind host>:<sandbox port>/sandbox` | Public URL of the MCP Apps sandbox proxy, returned as `sandboxUrl` by `GET /api/config` and printed in the banner (e.g. `https://inspector-sandbox.example.com/sandbox`). A bare origin gets `/sandbox` appended. An empty value counts as unset.                                                                                                                                                                                                                         |
| `MCP_APP_ORIGIN_FULL_ADDRESS` | web     | `http://<bind host>:<app-origin port>`  | Public origin that `_meta.ui.domain` app documents are published under (e.g. `https://inspector-apps.example.com`). **Origin only** — a path is refused, since documents are served at `<origin>/app-document/<id>`. An empty value counts as unset.                                                                                                                                                                                                                      |

Both are **refused** — ignored with a warning, keeping the bind-derived address — when the value is not an absolute `http(s)` URL, carries credentials, a query string, a fragment or a wildcard, or is a bracketed IPv6 literal. ⚠️ **Each needs its own origin.** The MCP Apps spec requires the sandbox origin to differ from the Inspector's, so a sandbox address sharing an `ALLOWED_ORIGINS` origin is refused (`https://inspector.example.com/sandbox` behind the same hostname as the UI is the common case), as is an app origin equal to the Inspector's or the sandbox's. Neither is used unless its listener is on a fixed port — not when the port is `0`, and not when the pinned port was taken at startup (or collided with another Inspector port) and the server fell back to an OS-assigned one — since the proxy has no stable port to route it to. A plain-`http` address while `ALLOWED_ORIGINS` lists an `https` origin is used, but warned about: the browser blocks it as mixed content.

## Behavior

| Variable                 | Read by       | Default                                | Effect                                                                                                                                                                                                                                                                                       |
| ------------------------ | ------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_AUTO_OPEN_ENABLED`  | web, CLI      | see effect                             | Whether a browser is opened for you. `false` never opens one; `true` always does. Unset (or any other value), the web client opens the UI at launch, and the CLI opens the OAuth authorization page only when stderr is a TTY. In the CLI, `true` also lets interactive OAuth **start** when neither stdin nor stderr is a TTY; otherwise that case fails with an auth-required error pointing at `--stored-auth-only`. **The TUI does not read it** and always opens the OAuth page. |
| `MCP_CATALOG_PATH`       | web, CLI, TUI | `~/.mcp-inspector/mcp.json`            | Default writable catalog, used when no `--catalog` is given. The CLI honors it only when no ad-hoc target (positional command, `--server-url`, or `--transport`) is given. See [MCP server configuration](./mcp-server-configuration.md).                                                   |
| `MCP_OAUTH_CALLBACK_URL` | CLI, TUI      | `http://127.0.0.1:6276/oauth/callback` | Loopback redirect URL for the CLI/TUI OAuth flow. `--callback-url` takes precedence.                                                                                                                                                                                                         |
| `NO_COLOR`               | CLI           | unset                                  | Any non-empty value disables ANSI styling in the CLI's human-readable output. An empty `NO_COLOR=` counts as unset.                                                                                                                                                                         |

## Storage and state

| Variable                         | Read by       | Default                                | Effect                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_STORAGE_DIR`                | web, CLI, TUI | `~/.mcp-inspector/storage`             | Storage directory. Relocates the OAuth state file (`oauth.json`) and the secrets file (`secrets.json`) for every client. For the **web** backend it also relocates `client.json`; the CLI and TUI find `client.json` through `MCP_CLIENT_CONFIG_PATH` instead.                                                        |
| `MCP_INSPECTOR_OAUTH_STATE_PATH` | CLI, TUI      | `~/.mcp-inspector/storage/oauth.json`  | Names the OAuth state file outright. Lookup order: this variable, then `<MCP_STORAGE_DIR>/oauth.json`, then `~/.mcp-inspector/storage/oauth.json`. ⚠️ Setting `MCP_STORAGE_DIR` alone does not isolate a CLI or TUI run if this variable is also exported. **The web backend does not read it** — it always uses `<MCP_STORAGE_DIR>/oauth.json`. |
| `MCP_CLIENT_CONFIG_PATH`         | CLI, TUI      | `~/.mcp-inspector/storage/client.json` | Install-level client config (CIMD, enterprise IdP). `--client-config` takes precedence.                                                                                                                                                                                                                                 |

### Home directory

Every default above that starts with `~` is built from the home directory the process sees, not from the OS account database:

| Variable      | Read by       | Effect                                                                                                                                                                                                                                                                   |
| ------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HOME`        | web, CLI, TUI | Base of `~/.mcp-inspector`: the default catalog, storage directory (`oauth.json`, `client.json`), secrets file, and TUI log directory.                                                                                                                                  |
| `USERPROFILE` | web, CLI, TUI | Used in place of `HOME` when `HOME` is unset or empty — the normal case on Windows. ⚠️ If **neither** is set, as under some service managers, those defaults resolve against the **current working directory** instead. Set `HOME` or the specific path variables above. |

## Secret store

Where the Inspector's secrets (OAuth client secrets, the enterprise IdP client secret, stdio `env:` values) are kept. How the store is chosen, and the details of the file store — its location, encryption, permissions and locking — are in [Where secrets are stored](./secret-storage.md); these variables apply to every install, not only containers.

> [!WARNING]
> On a host with no OS keychain (Linux without libsecret or a Secret Service, headless or SSH sessions, Termux), the Inspector **automatically** stores secrets in a file that is **plaintext** unless `MCP_INSPECTOR_SECRET_KEY_FILE` or `MCP_INSPECTOR_SECRET_KEY` is set. See [the warning in Where secrets are stored](./secret-storage.md#how-the-store-is-chosen).

| Variable                     | Read by       | Default                           | Effect                                                                                                                                                                                                                                |
| ---------------------------- | ------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_INSPECTOR_SECRET_STORE` | web, CLI, TUI | probe the OS keychain             | `keyring`, `file`, or `memory` (case-insensitive) picks the store outright and skips the probe. An empty or whitespace-only value counts as unset and silently runs automatic selection; any other value is ignored with a warning and also falls back to automatic selection.                                                                                             |
| `MCP_INSPECTOR_SECRET_FILE`  | web, CLI, TUI | `~/.mcp-inspector/secrets.json`   | Path of the file store. Lookup order: this variable, then `secrets.json` in `MCP_STORAGE_DIR` when that is set, then `~/.mcp-inspector/secrets.json`. ⚠️ The default sits **beside** the storage directory, not inside it.          |
| `MCP_INSPECTOR_SECRET_KEY`   | web, CLI, TUI | unset (file is plaintext, `0600`) | Passphrase that encrypts the file store; an empty or whitespace-only value counts as unset. Use a generated, high-entropy value. ⚠️ Changing or losing it makes the existing file unreadable; see [Where secrets are stored](./secret-storage.md#encryption) before rotating it. |
| `MCP_INSPECTOR_SECRET_KEY_FILE` | web, CLI, TUI | unset | Path of a file holding the passphrase; trailing line breaks are removed. Use this for Docker or Compose secrets, so the key stays out of the environment. Setting it together with a non-blank `MCP_INSPECTOR_SECRET_KEY` is an error, and so is setting it to an empty value. ⚠️ If the file is missing, unreadable or empty, or is the secrets file itself, the file store refuses to read or write rather than fall back to plaintext. |
| `MCP_INSPECTOR_PERSIST_TOKENS` | web, CLI, TUI | `all` | Which **acquired OAuth tokens** are persisted to the secret store: `all` (access + refresh tokens and IdP session tokens), `access` (access and ID tokens, but no refresh tokens), or `none` (no acquired tokens outlive the process; expect to re-authorize each run). Applies on write only — already-persisted tokens still load, and the next save under a stricter policy removes them from the store. Client secrets are registration credentials, not acquired tokens, and are persisted regardless. An empty value counts as unset; any other value is ignored with a warning and treated as `all`. |

When no store is configured, the choice also depends on whether the Inspector is running in a container, which it detects from `KUBERNETES_SERVICE_HOST` (or Docker's and Podman's marker files). That variable is set by the orchestrator, not by you.

## Logging and debugging

| Variable                | Read by       | Default            | Effect                                                                                                                                                                                                                              |
| ----------------------- | ------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_DEBUG` / `DEBUG`   | launcher, TUI | off                | Prints the full stack trace when the process exits on an error — the launcher for any `--web`/`--tui` failure, and the standalone TUI entry point for a startup failure. Any value other than empty, `0` or `false` (case-insensitive) turns it on. |
| `MCP_LOG_FILE`          | web           | unset (no log)     | Appends the web backend's structured (pino, JSON lines) log to this file, creating its directory if needed. An empty value counts as unset.                                                                                        |
| `MCP_INSPECTOR_LOG_DIR` | TUI           | `~/.mcp-inspector` | Directory of the TUI's `auth.log`. The TUI logs to a file so its output does not corrupt the terminal UI.                                                                                                                           |
| `LOG_LEVEL`             | TUI           | `info`             | Level of the TUI's `auth.log`: one of `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`. An empty value is not replaced by `info`.                                                                                       |

## Outbound proxy

| Variable                     | Read by       | Default | Effect                                                                                                                                                                                                                |
| ---------------------------- | ------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HTTPS_PROXY` / `HTTP_PROXY` | web, CLI, TUI | unset   | Route connections to remote HTTP/SSE servers, including OAuth discovery and token requests, through a proxy. Lowercase forms are honored too. See [HTTP proxy support](../clients/cli/README.md#http-proxy-support). |
| `NO_PROXY`                   | web, CLI, TUI | unset   | Hosts exempted from the proxy.                                                                                                                                                                                        |

## Node.js variables

These belong to Node, not the Inspector, but they are the answer to some common connection problems. Because the web client connects to MCP servers **from its Node backend**, not from the browser, they apply to all three clients.

### Connecting to a server with a self-signed certificate

A server at `https://localhost`, or anywhere else with a self-signed or privately issued certificate, fails to connect with a generic fetch error, because Node does not trust the certificate. Trusting the browser's exception does not help — the browser is not the one connecting ([#1936](https://github.com/modelcontextprotocol/inspector/issues/1936)).

**Prefer trusting the certificate's CA.** `NODE_EXTRA_CA_CERTS` adds certificates to the ones Node trusts, and leaves verification on for every other connection:

```sh
NODE_EXTRA_CA_CERTS=/path/to/your-ca.pem npx @modelcontextprotocol/inspector
```

For a self-signed certificate with no separate CA, point it at the certificate itself. Node reads the variable once at startup, so it must be set before launching.

**Or turn verification off, for local development only:**

```sh
NODE_TLS_REJECT_UNAUTHORIZED=0 npx @modelcontextprotocol/inspector
```

⚠️ This disables certificate verification for **every** TLS connection the Inspector process makes — every MCP server, every OAuth authorization server and token endpoint — not just the one you are testing, and Node prints a warning saying so. A connection that would have been refused for impersonation is then accepted. Never set it in a shell profile, a shared environment, or a deployment.

| Variable                       | Default | Effect                                                                                                |
| ------------------------------ | ------- | ----------------------------------------------------------------------------------------------------- |
| `NODE_EXTRA_CA_CERTS`          | unset   | PEM file of extra CA certificates to trust, in addition to Node's bundled ones. Read once at startup. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | `1`     | `0` disables TLS certificate verification for the whole process. Development only.                    |
