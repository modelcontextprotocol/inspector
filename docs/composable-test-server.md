# Config-Driven Composable MCP Server: Design Document

## Overview

The Inspector core package has **composable test MCP servers** (`composable-test-server.ts`, `test-server-fixtures.ts`) that allow creating an MCP server with a specific shape—tools, resources, prompts, capabilities—by passing a `ServerConfig` object. These are used today only in tests; they are composed in code.

This document proposes a **runtime MCP server** that reads a configuration file (JSON or YAML) to compose the server at startup. You could run it from MCP Inspector or any MCP client without writing code, e.g.:

```bash
mcp-composable-server --config ./my-server-config.json
# or
mcp-composable-server --config ./my-server-config.yaml
```

Use cases:

- Manually testing MCP Inspector (or other clients) with a specific server shape
- Demos and documentation examples
- Local development with a known-good server configuration

---

## Relationship to the "Everything" Server

The **@modelcontextprotocol/server-everything** package is the standard test-bench server for MCP clients. New features are typically added there first so they can be exercised in Inspector. It provides a fixed, comprehensive server that exposes many protocol features: echo/add tools, long-running operations, sampling, elicitation, annotated messages, 100 resources with subscription updates, prompts, logging, and more.

The contemplated config-driven composable server is **complementary**, not a replacement. In some situations it has advantages:

| Situation                                    | Composable server advantage                                                                                                                                           | Everything server                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Testing specific capability combinations** | Compose exactly the subset you need (e.g. tools only, resources only, tasks + resources). Isolate behavior without unrelated features.                                | Fixed "kitchen sink" shape. Harder to isolate a single capability.                          |
| **Pagination testing**                       | `maxPageSize` configurable per list type (tools, resources, templates, prompts). Can test cursor behavior with small page sizes (e.g. 2 or 3) without a huge catalog. | Fixed resource/prompt counts. No configurable pagination.                                   |
| **Controlled, predictable behavior**         | No random log messages or timers. Responses are deterministic. Easier to reproduce bugs and write test cases.                                                         | Random log messages every 15 seconds, subscription updates every 5 seconds.                 |
| **listChanged / subscriptions**              | Enable or disable `listChanged` per list type. Test client handling of list changes without background noise. `subscriptions` toggle for resource updates.            | Fixed behavior. Background updates may mask or confuse list-change tests.                   |
| **Task variants**                            | Multiple task presets: immediate, progress, elicitation, sampling, optional vs required task support. Test task-related client behavior in isolation.                 | Has task-like behavior but in a fixed form.                                                 |
| **Local, offline, no network**               | Runs locally; config file and stdio/HTTP. No dependency on hosted services.                                                                                           | Hosted option exists but may have CORS/network constraints; local runs require npm install. |
| **Rapid iteration on client features**       | Swap config files to test different server shapes without code changes. E.g. `pagination-tools.json`, `tasks-only.json`, `list-changed-resources.json`.               | Single fixed shape. New features require upstream changes to everything.                    |
| **OAuth and auth testing**                   | Can enable OAuth with configurable static clients, DCR, CIMD. Test auth flows against a local server.                                                                 | OAuth support exists; configurability may differ.                                           |

**When to use Everything:** Broad coverage of protocol features, community standard, quick `npx` start. Best for "does the client work with a real MCP server?" and for validating that new features in everything are supported by Inspector.

**When to use the composable server:** Focused testing of pagination, list changes, tasks, capability subsets, or reproducible scenarios. Useful when debugging client behavior that depends on a specific server shape or when Everything doesn't yet support a feature you need to test.

---

## Current Architecture

### Core Components

1. **`createMcpServer(config: ServerConfig)`** (composable-test-server.ts)  
   Takes `ServerConfig` and returns an `McpServer` (SDK). Handles all MCP capabilities, registration, and handlers.

2. **`ServerConfig`** (composable-test-server.ts)  
   Configures:
   - `serverInfo`: name, version (Implementation)
   - `tools`, `resources`, `resourceTemplates`, `prompts`: arrays of definitions
   - Capabilities: `logging`, `listChanged`, `subscriptions`, `tasks`, `oauth`
   - Transport: `serverType` ("sse" | "streamable-http"), `port`
   - `maxPageSize` for pagination
   - `taskStore`, `taskMessageQueue` (advanced, optional)

3. **Test server fixtures** (test-server-fixtures.ts)  
   Factory functions that return `ToolDefinition`, `ResourceDefinition`, `PromptDefinition`, `ResourceTemplateDefinition`:
   - **Tools**: echo, add, get-sum, collectSample, listRoots, collectElicitation, collectUrlElicitation, sendNotification, get-annotated-message, writeToStderr; addResource, removeResource, addTool, removeTool, addPrompt, removePrompt, updateResource; sendProgress; task tools (simpleTask, progressTask, elicitationTask, samplingTask, optionalTask, forbiddenTask, immediateReturnTask); numbered tools
   - **Resources**: architecture, test-cwd, test-env, test-argv; numbered resources
   - **Resource templates**: file, user; numbered templates
   - **Prompts**: simple-prompt, args-prompt; numbered prompts
   - **Presets**: `getDefaultServerConfig()`, `getTaskServerConfig()`

4. **Transports**
   - **test-server-stdio.ts**: `StdioServerTransport` — can run standalone with default config
   - **test-server-http.ts**: `StreamableHTTPServerTransport` or `SSEServerTransport` — used in tests

### Challenge: Handlers Are Functions

Tool, resource, and prompt definitions include **handler functions** (e.g. `ToolDefinition.handler`). These cannot be serialized in JSON/YAML. The config file must therefore reference **presets** (named fixtures) instead of defining handlers inline. The runtime resolves preset names to the actual definitions.

---

## Proposed Design

### 1. Config File Format

The config file mirrors `ServerConfig` but uses **preset references** instead of inline definitions. Supported formats: JSON and YAML.

**Preset reference format** (for tools, resources, prompts, resourceTemplates):

```json
{
  "preset": "<preset-name>",
  "params": { ... }
}
```

- `preset` (required): name of a known preset
- `params` (optional): parameters for that preset

**Example config file** (`example-server.json`):

```json
{
  "serverInfo": {
    "name": "my-demo-server",
    "version": "1.0.0"
  },
  "tools": [
    { "preset": "echo" },
    { "preset": "add" },
    { "preset": "numberedTools", "params": { "count": 5 } },
    {
      "preset": "simpleTask",
      "params": { "name": "slowTask", "delayMs": 3000 }
    }
  ],
  "resources": [
    { "preset": "architecture" },
    { "preset": "test-cwd" },
    { "preset": "numberedResources", "params": { "count": 3 } }
  ],
  "resourceTemplates": [{ "preset": "file" }, { "preset": "user" }],
  "prompts": [{ "preset": "simple-prompt" }, { "preset": "args-prompt" }],
  "logging": true,
  "listChanged": {
    "tools": true,
    "resources": true,
    "prompts": true
  },
  "subscriptions": false,
  "tasks": { "list": true, "cancel": true },
  "transport": {
    "type": "stdio"
  }
}
```

For HTTP transport:

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

---

### 2. Preset Registry

A **preset registry** maps preset names to factory functions that return definitions. The registry is populated with all fixtures from `test-server-fixtures.ts`.

| Preset Name               | Type               | Params                          | Notes                                         |
| ------------------------- | ------------------ | ------------------------------- | --------------------------------------------- |
| echo                      | tool               | none                            | Echo tool                                     |
| add                       | tool               | none                            | Add two numbers                               |
| get-sum                   | tool               | none                            | Alias for add                                 |
| writeToStderr             | tool               | none                            | Writes message to stderr                      |
| collectSample             | tool               | none                            | Sends sampling request to client              |
| listRoots                 | tool               | none                            | Calls roots/list on client                    |
| collectElicitation        | tool               | none                            | Sends form elicitation request                |
| collectUrlElicitation     | tool               | none                            | Sends URL elicitation request                 |
| sendNotification          | tool               | none                            | Sends notification to client                  |
| get-annotated-message     | tool               | none                            | Returns annotated message with optional image |
| addResource               | tool               | none                            | Adds resource, sends list_changed             |
| removeResource            | tool               | none                            | Removes resource                              |
| addTool                   | tool               | none                            | Adds tool dynamically                         |
| removeTool                | tool               | none                            | Removes tool                                  |
| addPrompt                 | tool               | none                            | Adds prompt dynamically                       |
| removePrompt              | tool               | none                            | Removes prompt                                |
| updateResource            | tool               | none                            | Updates resource content                      |
| sendProgress              | tool               | params: name?                   | Sends progress notifications                  |
| numberedTools             | tool[]             | count                           | Creates N echo-like tools                     |
| simpleTask                | taskTool           | name?, delayMs?                 | Task that completes after delay               |
| progressTask              | taskTool           | name?, delayMs?, progressUnits? | Task with progress                            |
| elicitationTask           | taskTool           | name?, elicitationSchema?       | Task requiring elicitation                    |
| samplingTask              | taskTool           | name?, samplingText?            | Task requiring sampling                       |
| optionalTask              | taskTool           | name?, delayMs?                 | Task with optional task support               |
| forbiddenTask             | tool               | name?, delayMs?                 | Non-task tool (completes immediately)         |
| immediateReturnTask       | tool               | name?, delayMs?                 | Immediate return (no task)                    |
| architecture              | resource           | none                            | Static architecture doc                       |
| test-cwd                  | resource           | none                            | Exposes process.cwd()                         |
| test-env                  | resource           | none                            | Exposes process.env                           |
| test-argv                 | resource           | none                            | Exposes process.argv                          |
| numberedResources         | resource[]         | count                           | N static resources                            |
| file                      | resourceTemplate   | none                            | file:///{path} template                       |
| user                      | resourceTemplate   | none                            | user://{userId} template                      |
| numberedResourceTemplates | resourceTemplate[] | count                           | N templates                                   |
| simple-prompt             | prompt             | none                            | Simple static prompt                          |
| args-prompt               | prompt             | none                            | Prompt with city, state args                  |
| numberedPrompts           | prompt[]           | count                           | N static prompts                              |

**Preset params** (where applicable):

- `numberedTools`, `numberedResources`, `numberedResourceTemplates`, `numberedPrompts`: `{ count: number }`
- `simpleTask`, `progressTask`, etc.: `{ name?: string, delayMs?: number, progressUnits?: number, ... }` (see `TaskToolOptions`, `ImmediateToolOptions` in fixtures)
- `sendProgress`: `{ name?: string }`

---

### 3. Config Schema

Top-level config structure:

```ts
interface ConfigFile {
  serverInfo: {
    name: string;
    version: string;
  };
  tools?: Array<PresetRef | PresetRef[]>;
  resources?: PresetRef[];
  resourceTemplates?: PresetRef[];
  prompts?: PresetRef[];
  logging?: boolean;
  listChanged?: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
  subscriptions?: boolean;
  tasks?: {
    list?: boolean;
    cancel?: boolean;
  };
  maxPageSize?: {
    tools?: number;
    resources?: number;
    resourceTemplates?: number;
    prompts?: number;
  };
  transport: {
    type: "stdio" | "streamable-http" | "sse";
    port?: number; // For HTTP transports
  };
}

interface PresetRef {
  preset: string;
  params?: Record<string, unknown>;
}
```

Arrays like `tools` can also accept arrays of preset refs (e.g. `numberedTools` expands to multiple tools).

---

### 4. Runtime Resolution

1. **Load config file** (JSON or YAML based on extension or explicit `--format`).
2. **Resolve preset refs**: For each entry in tools, resources, resourceTemplates, prompts:
   - Look up preset in registry.
   - Call factory with `params` (or defaults).
   - Collect resulting definitions.
3. **Build ServerConfig** from resolved definitions + top-level flags (logging, listChanged, tasks, etc.).
4. **Create McpServer** via `createMcpServer(config)`.
5. **Start transport**:
   - `stdio`: Connect `StdioServerTransport` (same pattern as test-server-stdio).
   - `streamable-http` or `sse`: Start HTTP server on `port` (or auto-assign), set up routes.

---

### 5. Implementation Plan

| Phase | Scope                                                                                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1     | Preset registry: map preset names to fixture factories. Expose from a new module (e.g. `core/test/preset-registry.ts`). |
| 2     | Config loader: parse JSON/YAML, validate against schema (optional, or fail fast on unknown presets).                    |
| 3     | Resolver: convert config file → `ServerConfig`.                                                                         |
| 4     | CLI entry point: `mcp-composable-server --config <path> [--transport stdio                                              | http]`. Default transport from config. |
| 5     | Package: Add `bin` in core (or a dedicated `cli-composable` package) so `npx` or npm script can run it.                 |

---

### 6. Placement and Packaging

**Option A: In core package**

- Add `core/bin/composable-server.ts` (or `.js` after build).
- Add `"composable-server": "node build/test/composable-server.js"` to `bin` in `core/package.json`.
- Config loader and preset registry live under `core/test/` or `core/config/`.

**Option B: Separate package**

- New package `@modelcontextprotocol/inspector-composable-server` (or `mcp-composable-server`).
- Depends on `@modelcontextprotocol/inspector-core` for `createMcpServer` and fixtures.
- Cleaner separation but more packaging overhead.

Recommendation: Start with **Option A** (in core) to reuse fixtures and `createMcpServer` directly. Move to a separate package later if needed.

---

### 7. Limitations and Future Work

1. **No custom handlers in config** — Only presets. Custom tools/resources require code or new presets.
2. **OAuth** — OAuth config is complex (issuer URL, static clients, DCR, CIMD). Initial version can omit or support a minimal subset; expand later.
3. **Elicitation/sampling schemas** — Task presets like `elicitationTask` accept `elicitationSchema`. In config, we could support a JSON Schema object; the resolver would convert to Zod or the SDK's schema format.
4. **Completion callbacks** — Resource templates and prompts can have completion callbacks. Presets like `file` and `args-prompt` support them; config-driven mode would use defaults (e.g. no completion) unless we add preset params for static completion data.
5. **YAML support** — Requires a YAML parser (e.g. `yaml`). Add as optional dependency.

---

### 8. Example Usage

```bash
# Stdio transport (default for MCP Inspector stdio config)
npx @modelcontextprotocol/inspector-core composable-server --config ./demo.json

# HTTP transport
npx @modelcontextprotocol/inspector-core composable-server --config ./demo-http.json --port 3000
```

**mcp.json** (MCP Inspector config) for stdio:

```json
{
  "mcpServers": {
    "demo": {
      "command": "npx",
      "args": [
        "@modelcontextprotocol/inspector-core",
        "composable-server",
        "--config",
        "./demo.json"
      ]
    }
  }
}
```

For HTTP, use a server URL instead of command/args.

---

## Summary

A config-driven composable MCP server would let users run a composed server from a JSON/YAML file without writing code. The design reuses `createMcpServer` and existing fixtures via a preset registry. Preset refs in config replace inline handler definitions. The runtime resolves presets, builds `ServerConfig`, and starts stdio or HTTP transport. Implementation can begin with a preset registry and config loader in core, then add a CLI entry point.
