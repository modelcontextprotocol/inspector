# MCP Inspector TUI Client

The Terminal User Interface (TUI) client brings the interactive exploration capabilities of the Web Client directly to your terminal. It is built using [Ink](https://github.com/vadimdemedes/ink) to provide a rich, React-like component experience in a command-line environment.

## Running the TUI

You can run the TUI client via `npx`:

```bash
npx @modelcontextprotocol/inspector --tui node build/index.js
```

### With Configuration Files

The TUI can load all servers from an MCP config file:

```bash
npx @modelcontextprotocol/inspector --tui --config mcp.json
```

(It does not use `--server`; all servers in the file are available in the TUI.)

## Options

### MCP server (which server(s) to connect to)

Options that specify the MCP server(s) (config file, ad-hoc command/URL, env vars, headers) are shared by the Web, CLI, and TUI and are documented in [MCP server configuration](../../docs/mcp-server-configuration.md): `--config`, `-e`, `--cwd`, `--header`, `--transport`, `--server-url`, and the positional `[target...]`.

### TUI-specific (OAuth for HTTP servers)

When connecting to SSE or Streamable HTTP servers that use OAuth, you can pass:

| Option                        | Description                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `--client-id <id>`            | OAuth client ID (static client).                                                     |
| `--client-secret <secret>`    | OAuth client secret (confidential clients).                                          |
| `--client-metadata-url <url>` | OAuth Client ID Metadata Document URL (CIMD).                                        |
| `--callback-url <url>`        | OAuth redirect/callback listener URL (default: `http://127.0.0.1:0/oauth/callback`). |

## Features

The TUI provides terminal-native tabs and panes for interacting with your MCP server:

- **Resources**: Browse and read resources exposed by the server.
- **Prompts**: List and test prompts.
- **Tools**: View available tools and execute them with form-like inputs.
- **History**: View the request and response history of your interactions.
- **Console**: View the direct stdout/stderr and diagnostic logging of the connected server.

## Navigation

- Use the **Arrow Keys** (Left/Right) or **Tab** to switch between the main tabs (Resources, Tools, Prompts, etc.).
- Use the **Arrow Keys** (Up/Down) to scroll through lists of items.
- Press **Enter** to select an item, execute a tool, or fetch a resource.
- Press **Escape** or `Ctrl+C` to exit the application.
