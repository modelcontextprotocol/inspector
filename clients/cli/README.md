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

## Why use the CLI?

While the Web Client provides a rich visual interface, the CLI is designed for:

- **Automation**: Ideal for CI/CD pipelines and batch processing.
- **AI Coding Assistants**: Provides a direct, machine-readable interface (JSON) for tools like Cursor or Claude to verify changes immediately.
- **Log Analysis**: Easier integration with command-line utilities (like `jq`) to process and analyze MCP server output.

## Development

Run the test suite (and coverage gate) from `clients/cli/`:

```bash
npm test            # build test-servers + binary, then run all tests
npm run test:coverage  # same, under the per-file coverage gate
```

Tests run the CLI **in-process** (importing `runCli()`) so `src/` is measured
under coverage, with a thin out-of-process spawn layer for the real binary. See
[`__tests__/README.md`](./__tests__/README.md) for details.
