# Inspector Test Server

This package (`@modelcontextprotocol/inspector-test-server`, `test/`) provides **server infrastructure** for MCP testing: a composable MCP server implementation plus reusable fixtures. You can use it in two ways:

1. **API** — Create servers programmatically via `createMcpServer(config)` and fixture factories (`createEchoTool()`, `createNumberedResources()`, etc.). Inspector's core, CLI, and other packages use this for tests.
2. **Composable CLI** — Run a config-driven MCP server without writing code. The `server-composable` binary reads a JSON or YAML config, resolves preset references to fixtures, and starts stdio or HTTP transport.

---

## Relationship to the "Everything" Server

The **@modelcontextprotocol/server-everything** package is the standard test-bench server for MCP clients. It provides a fixed, comprehensive server with many protocol features.

The composable test server is **complementary**, not a replacement:

| Situation                                    | Composable server advantage                                                                         | Everything server                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Testing specific capability combinations** | Compose exactly the subset you need (e.g. tools only, resources only, tasks + resources).           | Fixed "kitchen sink" shape.                                                 |
| **Pagination testing**                       | `maxPageSize` configurable per list type. Test cursor behavior with small page sizes (e.g. 2 or 3). | Fixed resource/prompt counts. No configurable pagination.                   |
| **Controlled, predictable behavior**         | No random log messages or timers. Responses are deterministic.                                      | Random log messages every 15 seconds, subscription updates every 5 seconds. |
| **listChanged / subscriptions**              | Enable or disable `listChanged` per list type. `subscriptions` toggle for resource updates.         | Fixed behavior.                                                             |
| **Task variants**                            | Test task tools in isolation: immediate, progress, elicitation, sampling, optional vs required.     | Has task-like behavior in a fixed form.                                     |
| **Rapid iteration**                          | Swap config files to test different server shapes without code changes.                             | Single fixed shape.                                                         |

**Use Everything when:** You want broad coverage, community standard, quick `npx` start, or hosted DCR-only OAuth for testing against a real auth server.

**Use the composable server when:** You need focused testing of pagination, list changes, tasks, capability subsets, or reproducible scenarios.

---

## API Usage

### Components

- **`createMcpServer(config: ServerConfig)`** — Takes `ServerConfig` and returns an MCP `McpServer`. Handles capabilities, registration, and handlers.
- **`ServerConfig`** — Configures `serverInfo`, `tools`, `resources`, `resourceTemplates`, `prompts`, capabilities (`logging`, `listChanged`, `subscriptions`, `tasks`), transport (`serverType`, `port`), `maxPageSize`.
- **Fixtures** — Factory functions in `test-server-fixtures.ts`: `createEchoTool()`, `createAddTool()`, `createNumberedTools(count)`, `createArchitectureResource()`, etc.
- **Transports** — `StdioServerTransport` (test-server-stdio.ts), `StreamableHTTPServerTransport` / `SSEServerTransport` (test-server-http.ts).

### Example

```ts
import { createMcpServer } from "@modelcontextprotocol/inspector-test-server";
import {
  createEchoTool,
  createAddTool,
} from "@modelcontextprotocol/inspector-test-server";

const server = createMcpServer({
  serverInfo: { name: "my-server", version: "1.0.0" },
  tools: [createEchoTool(), createAddTool()],
});
```

---

## Composable CLI Usage

### Running the Server

```bash
server-composable --config ./my-server-config.json
server-composable --config ./my-server-config.yaml   # format inferred from extension
server-composable --config ./my-server-config --yaml # explicit format when extension absent
```

From the Inspector repo after `npm run build`:

```bash
npm run server-composable -- --config test/configs/demo.json
# or
node test/build/server-composable.js --config test/configs/demo.json
```

### Config File Format

The config file uses **preset references** instead of inline definitions. Tool, resource, and prompt definitions include handler functions that cannot be serialized in JSON/YAML, so the config references named presets that resolve to fixture instances.

**Preset reference format:**

```json
{
  "preset": "<preset-name>",
  "params": { ... }
}
```

- `preset` (required): name of a known preset
- `params` (optional): parameters for that preset

**Example config (stdio):**

```json
{
  "serverInfo": {
    "name": "my-demo-server",
    "version": "1.0.0"
  },
  "tools": [
    { "preset": "echo" },
    { "preset": "add" },
    { "preset": "numbered_tools", "params": { "count": 5 } },
    {
      "preset": "simple_task",
      "params": { "name": "slow_task", "delayMs": 3000 }
    }
  ],
  "resources": [{ "preset": "architecture" }, { "preset": "test_cwd" }],
  "resourceTemplates": [{ "preset": "file" }, { "preset": "user" }],
  "prompts": [{ "preset": "simple_prompt" }, { "preset": "args_prompt" }],
  "logging": true,
  "listChanged": { "tools": true, "resources": true, "prompts": true },
  "subscriptions": false,
  "tasks": { "list": true, "cancel": true },
  "transport": { "type": "stdio" }
}
```

**Example config (HTTP):**

```json
{
  "serverInfo": { "name": "http-demo", "version": "1.0.0" },
  "tools": [{ "preset": "echo" }],
  "transport": {
    "type": "streamable-http",
    "port": 3000
  }
}
```

Use `"type": "sse"` with `port` for SSE transport.

### Config Schema

```ts
interface ConfigFile {
  serverInfo: { name: string; version: string };
  tools?: Array<PresetRef | PresetRef[]>;
  resources?: PresetRef[];
  resourceTemplates?: PresetRef[];
  prompts?: PresetRef[];
  logging?: boolean;
  listChanged?: { tools?: boolean; resources?: boolean; prompts?: boolean };
  subscriptions?: boolean;
  tasks?: { list?: boolean; cancel?: boolean };
  maxPageSize?: {
    tools?: number;
    resources?: number;
    resourceTemplates?: number;
    prompts?: number;
  };
  transport: { type: "stdio" | "streamable-http" | "sse"; port?: number };
}

interface PresetRef {
  preset: string;
  params?: Record<string, unknown>;
}
```

Format: JSON or YAML. Infer from extension (`.json`, `.yaml`, `.yml`), or use `--json` / `--yaml` to override.

### Preset Registry

| Preset Name                                                                                      | Type               | Params                          | Notes                                                       |
| ------------------------------------------------------------------------------------------------ | ------------------ | ------------------------------- | ----------------------------------------------------------- |
| echo                                                                                             | tool               | none                            | Echo tool                                                   |
| add                                                                                              | tool               | none                            | Add two numbers                                             |
| get_sum                                                                                          | tool               | none                            | Alias for add                                               |
| write_to_stderr                                                                                  | tool               | none                            | Writes message to stderr                                    |
| collect_sample                                                                                   | tool               | none                            | Sends sampling request to client                            |
| list_roots                                                                                       | tool               | none                            | Calls roots/list on client                                  |
| collect_elicitation                                                                              | tool               | none                            | Sends form elicitation request                              |
| collect_url_elicitation                                                                          | tool               | none                            | Sends URL elicitation request                               |
| url_elicitation_form                                                                             | tool               | message?                        | Hosts form server, URL elicitation, returns submitted value |
| send_notification                                                                                | tool               | none                            | Sends notification to client                                |
| get_annotated_message                                                                            | tool               | none                            | Returns annotated message + optional image                  |
| add_resource, remove_resource, add_tool, remove_tool, add_prompt, remove_prompt, update_resource | tool               | none                            | Dynamic list changes                                        |
| send_progress                                                                                    | tool               | name?                           | Sends progress notifications                                |
| numbered_tools                                                                                   | tool[]             | count                           | Creates N echo-like tools                                   |
| simple_task                                                                                      | taskTool           | name?, delayMs?                 | Task that completes after delay                             |
| progress_task                                                                                    | taskTool           | name?, delayMs?, progressUnits? | Task with progress                                          |
| elicitation_task                                                                                 | taskTool           | name?                           | Task requiring form elicitation                             |
| sampling_task                                                                                    | taskTool           | name?, samplingText?            | Task requiring sampling                                     |
| optional_task                                                                                    | taskTool           | name?, delayMs?                 | Task with optional task support                             |
| forbidden_task                                                                                   | tool               | name?, delayMs?                 | Non-task tool (completes immediately)                       |
| immediate_return_task                                                                            | tool               | name?, delayMs?                 | Immediate return (no task)                                  |
| architecture                                                                                     | resource           | none                            | Static architecture doc                                     |
| test_cwd, test_env, test_argv                                                                    | resource           | none                            | Expose process.cwd(), env, argv                             |
| numbered_resources                                                                               | resource[]         | count                           | N static resources                                          |
| file                                                                                             | resourceTemplate   | none                            | file:///{path} template                                     |
| user                                                                                             | resourceTemplate   | none                            | user://{userId} template                                    |
| numbered_resource_templates                                                                      | resourceTemplate[] | count                           | N templates                                                 |
| simple_prompt                                                                                    | prompt             | none                            | Simple static prompt                                        |
| args_prompt                                                                                      | prompt             | none                            | Prompt with city, state args                                |
| numbered_prompts                                                                                 | prompt[]           | count                           | N static prompts                                            |

### Transport and Client Config

**Stdio:** The server runs as a subprocess. In MCP Inspector (or any MCP client) config, use stdio with the script as the command:

```json
{
  "mcpServers": {
    "demo": {
      "command": "node",
      "args": [
        "test/build/server-composable.js",
        "--config",
        "test/configs/demo.json"
      ]
    }
  }
}
```

Ensure the working directory is correct (e.g. Inspector repo root) or use absolute paths.

**Streamable HTTP or SSE:** Run the server yourself first (it binds to the configured port). Then in your client config, use the URL:

```json
{
  "mcpServers": {
    "demo": {
      "type": "streamable-http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

For SSE, use `"type": "sse"` and a URL ending in `/sse` (e.g. `http://localhost:3000/sse`).

---

## Limitations

- **Presets only** — Config cannot define custom handlers. New tools/resources require code or new presets.
- **OAuth** — Deferred. Not available in the composable server yet.
- **Elicitation/sampling** — Config uses fixture default schemas. No custom schema in config.
- **Completion callbacks** — Presets like `file` and `args_prompt` support them; config-driven mode uses defaults.

---

## Sample Configs

See `configs/` for example configs:

- **demo.json** — Minimal server with echo tool only (stdio). Use for smoke testing.
