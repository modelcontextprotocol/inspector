# MCP server configuration

This document describes how to specify **which MCP server(s)** the Inspector connects to. The same configuration model is used by the Web client, CLI, and TUI. Client-specific options (e.g. web server port, CLI method to invoke) are documented in each client’s README.

## Two ways to specify the server

1. **Config file** – Path to an `mcp.json` (or similar) file that defines one or more servers. Optionally select one server by name (Web and CLI only; TUI uses all servers in the file).
2. **Ad-hoc** – Pass a command (and args) for stdio, or a URL (and optional transport) for SSE/Streamable HTTP, on the command line.

You cannot mix config file and ad-hoc options in the same run (e.g. do not pass both `--config` and `--server-url`).

---

## Config file

- **Option:** `--config <path>`  
  Path to the JSON config file (relative to the current working directory or absolute).
- **Option (Web and CLI only):** `--server <name>`  
  Name of the server to use from the config file. If the file has only one server, or a server named `default-server`, it can be selected automatically and `--server` may be omitted.

### Config file format

The file must have an `mcpServers` object. Each key is a server name; each value is a server configuration.

**STDIO (default)**

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["build/index.js", "arg1"],
      "env": { "KEY": "value" },
      "cwd": "/optional/working/directory"
    }
  }
}
```

- `command` (required) – Executable to run.
- `args` (optional) – Array of arguments.
- `env` (optional) – Environment variables for the server process.
- `cwd` (optional) – Working directory for the process.

**SSE**

```json
{
  "mcpServers": {
    "my-sse": {
      "type": "sse",
      "url": "http://localhost:3000/sse",
      "headers": { "Authorization": "Bearer token" }
    }
  }
}
```

**Streamable HTTP**

```json
{
  "mcpServers": {
    "my-http": {
      "type": "streamable-http",
      "url": "http://localhost:3000/mcp",
      "headers": { "X-API-Key": "value" }
    }
  }
}
```

You can use `"type": "http"` as an alias for `streamable-http`.

---

## Ad-hoc (no config file)

- **Positional arguments:**
  - For stdio: `command [arg1 [arg2 ...]]` (e.g. `node build/index.js`).
  - For SSE/HTTP: a single URL (e.g. `https://example.com/sse`). Transport is inferred from the URL path (`/mcp` → streamable-http, `/sse` → sse) unless overridden.
- **Options:**
  - `--transport <type>` – `stdio`, `sse`, or `http` (http = streamable-http). Use when the URL path does not imply the transport.
  - `--server-url <url>` – Server URL for SSE or Streamable HTTP (alternative to passing the URL as the only positional argument).

---

## Overrides (apply to config file or ad-hoc)

These options are applied on top of the server config (from file or ad-hoc):

- **`-e <KEY=VALUE>`** (repeatable) – Environment variables for **stdio** servers. Merged with any `env` from the config file (CLI overrides win).
- **`--cwd <path>`** – Working directory for **stdio** servers. Overrides `cwd` from the config file.
- **`--header <"Name: Value">`** (repeatable) – HTTP headers for **SSE** or **Streamable HTTP** servers. Merged with any `headers` from the config file.

Examples:

```bash
# Config file + override env
npx @modelcontextprotocol/inspector --config mcp.json --server my-server -e DEBUG=1

# Ad-hoc stdio with env
npx @modelcontextprotocol/inspector --cli -e KEY=value node build/index.js --method tools/list

# Ad-hoc SSE with header
npx @modelcontextprotocol/inspector --cli --transport sse --server-url http://localhost:3000/sse --header "Authorization: Bearer token"
```

---

## Separating Inspector options from server arguments

Use `--` to separate Inspector options from arguments that should be passed to the MCP server:

```bash
npx @modelcontextprotocol/inspector -e FOO=bar -- node build/index.js -e server-flag
```

Everything after `--` is passed to the server process (for stdio) and is not interpreted by the Inspector.

---

## Summary table (shared options)

| Option / input       | Description                                              |
| -------------------- | -------------------------------------------------------- |
| `--config <path>`    | Path to MCP config file (`mcpServers`).                  |
| `--server <name>`    | Server name from config file (Web and CLI only).         |
| `[target...]`        | Ad-hoc: command + args (stdio) or single URL (SSE/HTTP). |
| `--transport <type>` | `stdio`, `sse`, or `http`.                               |
| `--server-url <url>` | URL for SSE/Streamable HTTP (ad-hoc).                    |
| `-e KEY=VALUE`       | Env var for stdio server (repeatable).                   |
| `--cwd <path>`       | Working directory for stdio server.                      |
| `--header "N: V"`    | HTTP header for SSE/Streamable HTTP (repeatable).        |

For Web-only options (port, host, auth, etc.) see [Web Client README](../clients/web/README.md#configuring-the-web-app). For CLI-only options (e.g. `--method`, `--tool-name`) see [CLI README](../clients/cli/README.md#options). For TUI-only options (e.g. OAuth) see [TUI README](../clients/tui/README.md#options).
