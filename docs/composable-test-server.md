# Config-Driven Composable MCP Server: Design Document

## Overview

The Inspector **test package** (`@modelcontextprotocol/inspector-test-server`, top-level `test/`) has composable test MCP servers (`composable-test-server.ts`, `test-server-fixtures.ts`) that allow creating an MCP server with a specific shape—tools, resources, prompts, capabilities—by passing a `ServerConfig` object. These are used in Inspector's tests and composed in code. Core and CLI depend on the test package for their tests.

This document proposes a **runtime MCP server** that reads a configuration file (JSON or YAML) to compose the server at startup. You could run it from MCP Inspector or any MCP client without writing code, e.g.:

```bash
server-composable --config ./my-server-config.json
server-composable --config ./my-server-config.yaml   # format inferred from extension
server-composable --config ./my-server-config --yaml # explicit format when extension is absent
```

Use cases:

- Manually testing MCP Inspector (or other clients) with a specific server shape
- Demos and documentation examples
- Local development with a known-good server configuration

---

## Relationship to the "Everything" Server

The **@modelcontextprotocol/server-everything** package is the standard test-bench server for MCP clients. New features are typically added there first so they can be exercised in Inspector. It provides a fixed, comprehensive server that exposes many protocol features: echo/add tools, long-running operations, sampling, elicitation, annotated messages, 100 resources with subscription updates, prompts, logging, and more.

The contemplated config-driven composable server is **complementary**, not a replacement. In some situations it has advantages:

| Situation                                    | Composable server advantage                                                                                                                                           | Everything server                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Testing specific capability combinations** | Compose exactly the subset you need (e.g. tools only, resources only, tasks + resources). Isolate behavior without unrelated features.                                | Fixed "kitchen sink" shape. Harder to isolate a single capability.                                              |
| **Pagination testing**                       | `maxPageSize` configurable per list type (tools, resources, templates, prompts). Can test cursor behavior with small page sizes (e.g. 2 or 3) without a huge catalog. | Fixed resource/prompt counts. No configurable pagination.                                                       |
| **Controlled, predictable behavior**         | No random log messages or timers. Responses are deterministic. Easier to reproduce bugs and write test cases.                                                         | Random log messages every 15 seconds, subscription updates every 5 seconds.                                     |
| **listChanged / subscriptions**              | Enable or disable `listChanged` per list type. Test client handling of list changes without background noise. `subscriptions` toggle for resource updates.            | Fixed behavior. Background updates may mask or confuse list-change tests.                                       |
| **Task variants**                            | Multiple task presets: immediate, progress, elicitation, sampling, optional vs required task support. Test task-related client behavior in isolation.                 | Has task-like behavior but in a fixed form.                                                                     |
| **Rapid iteration on client features**       | Swap config files to test different server shapes without code changes. E.g. `pagination-tools.json`, `tasks-only.json`, `list-changed-resources.json`.               | Single fixed shape. New features require upstream changes to everything.                                        |
| **OAuth and auth testing**                   | Can enable OAuth with configurable static clients, DCR, CIMD. Test auth flows against a local server.                                                                 | Hosted Everything is DCR-only OAuth; convenient for testing against a real auth server without any local setup. |

**When to use Everything:** Broad coverage of protocol features, community standard, quick `npx` start. Best for "does the client work with a real MCP server?" and for validating that new features in everything are supported by Inspector. The hosted Everything server offers DCR-only OAuth, which is convenient for testing against a real auth server without setting anything up locally.

**When to use the composable server:** Focused testing of pagination, list changes, tasks, capability subsets, or reproducible scenarios. Useful when debugging client behavior that depends on a specific server shape or when Everything doesn't yet support a feature you need to test.

---

## Current Architecture

The composable test server code lives in the **test package** (`test/`, `@modelcontextprotocol/inspector-test-server`). The package depends only on `@modelcontextprotocol/sdk`, `express`, and `zod`; it does not depend on core. Inspector client OAuth test helpers (e.g. `createOAuthClientConfig`) live in `core/__tests__/helpers/oauth-client-fixtures.ts` because they use Inspector-specific auth types.

### Test Package Components

1. **`createMcpServer(config: ServerConfig)`** (`test/src/composable-test-server.ts`)  
   Takes `ServerConfig` and returns an `McpServer` (SDK). Handles all MCP capabilities, registration, and handlers.

2. **`ServerConfig`** (composable-test-server.ts)  
   Configures:
   - `serverInfo`: name, version (Implementation)
   - `tools`, `resources`, `resourceTemplates`, `prompts`: arrays of definitions
   - Capabilities: `logging`, `listChanged`, `subscriptions`, `tasks`, `oauth`
   - Transport: `serverType` ("sse" | "streamable-http"), `port`
   - `maxPageSize` for pagination
   - `taskStore`, `taskMessageQueue` (advanced, optional)

3. **Test server fixtures** (`test/src/test-server-fixtures.ts`)  
   Factory functions that return `ToolDefinition`, `ResourceDefinition`, `PromptDefinition`, `ResourceTemplateDefinition`:
   - **Tools**: echo, add, get_sum, collect_sample, list_roots, collect_elicitation, collect_url_elicitation, send_notification, get_annotated_message, write_to_stderr; add_resource, remove_resource, add_tool, remove_tool, add_prompt, remove_prompt, update_resource; send_progress; task tools (simple_task, progress_task, elicitation_task, sampling_task, optional_task, forbidden_task, immediate_return_task); numbered tools
   - **Resources**: architecture, test_cwd, test_env, test_argv; numbered resources
   - **Resource templates**: file, user; numbered templates
   - **Prompts**: simple_prompt, args_prompt; numbered prompts
   - **Presets**: `getDefaultServerConfig()`, `getTaskServerConfig()`, `createOAuthTestServerConfig()`

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
    { "preset": "numbered_tools", "params": { "count": 5 } },
    {
      "preset": "simple_task",
      "params": { "name": "slow_task", "delayMs": 3000 }
    },
    { "preset": "elicitation_task" },
    { "preset": "collect_url_elicitation" }
  ],
  "resources": [
    { "preset": "architecture" },
    { "preset": "test_cwd" },
    { "preset": "numbered_resources", "params": { "count": 3 } }
  ],
  "resourceTemplates": [{ "preset": "file" }, { "preset": "user" }],
  "prompts": [{ "preset": "simple_prompt" }, { "preset": "args_prompt" }],
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

A **preset registry** maps preset names to factory functions that return definitions. The registry is populated with all fixtures from `test/src/test-server-fixtures.ts`.

| Preset Name                 | Type               | Params                          | Notes                                            |
| --------------------------- | ------------------ | ------------------------------- | ------------------------------------------------ |
| echo                        | tool               | none                            | Echo tool                                        |
| add                         | tool               | none                            | Add two numbers                                  |
| get_sum                     | tool               | none                            | Alias for add                                    |
| write_to_stderr             | tool               | none                            | Writes message to stderr                         |
| collect_sample              | tool               | none                            | Sends sampling request to client                 |
| list_roots                  | tool               | none                            | Calls roots/list on client                       |
| collect_elicitation         | tool               | none                            | Sends form elicitation request                   |
| collect_url_elicitation     | tool               | none                            | Sends URL elicitation request                    |
| send_notification           | tool               | none                            | Sends notification to client                     |
| get_annotated_message       | tool               | none                            | Returns annotated message with optional image    |
| add_resource                | tool               | none                            | Adds resource, sends list_changed                |
| remove_resource             | tool               | none                            | Removes resource                                 |
| add_tool                    | tool               | none                            | Adds tool dynamically                            |
| remove_tool                 | tool               | none                            | Removes tool                                     |
| add_prompt                  | tool               | none                            | Adds prompt dynamically                          |
| remove_prompt               | tool               | none                            | Removes prompt                                   |
| update_resource             | tool               | none                            | Updates resource content                         |
| send_progress               | tool               | params: name?                   | Sends progress notifications                     |
| numbered_tools              | tool[]             | count                           | Creates N echo-like tools                        |
| simple_task                 | taskTool           | name?, delayMs?                 | Task that completes after delay                  |
| progress_task               | taskTool           | name?, delayMs?, progressUnits? | Task with progress                               |
| elicitation_task            | taskTool           | name?                           | Task requiring form elicitation (default schema) |
| sampling_task               | taskTool           | name?, samplingText?            | Task requiring sampling                          |
| optional_task               | taskTool           | name?, delayMs?                 | Task with optional task support                  |
| forbidden_task              | tool               | name?, delayMs?                 | Non-task tool (completes immediately)            |
| immediate_return_task       | tool               | name?, delayMs?                 | Immediate return (no task)                       |
| architecture                | resource           | none                            | Static architecture doc                          |
| test_cwd                    | resource           | none                            | Exposes process.cwd()                            |
| test_env                    | resource           | none                            | Exposes process.env                              |
| test_argv                   | resource           | none                            | Exposes process.argv                             |
| numbered_resources          | resource[]         | count                           | N static resources                               |
| file                        | resourceTemplate   | none                            | file:///{path} template                          |
| user                        | resourceTemplate   | none                            | user://{userId} template                         |
| numbered_resource_templates | resourceTemplate[] | count                           | N templates                                      |
| simple_prompt               | prompt             | none                            | Simple static prompt                             |
| args_prompt                 | prompt             | none                            | Prompt with city, state args                     |
| numbered_prompts            | prompt[]           | count                           | N static prompts                                 |

**Preset params** (where applicable):

- `numbered_tools`, `numbered_resources`, `numbered_resource_templates`, `numbered_prompts`: `{ count: number }`
- `simple_task`, `progress_task`, etc.: `{ name?: string, delayMs?: number, progressUnits?: number, ... }` (see `TaskToolOptions`, `ImmediateToolOptions` in fixtures)
- `elicitation_task`, `sampling_task`: simple params only (`name`, `samplingText`). Use fixture default schemas—no custom elicitation schema in config.
- `collect_elicitation`, `collect_url_elicitation`: no params or simple params only (e.g. `url` if fixture supports it).
- `send_progress`: `{ name?: string }`

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

**Current state (post-refactor):**

- Test package (`test/`, `@modelcontextprotocol/inspector-test-server`) exists with `createMcpServer`, fixtures, stdio/HTTP transports. No dependency on core.
- `test/configs/` exists for composable server sample configs (see `test/configs/README.md`).
- Inspector MCP client configs live in `configs/` (e.g. `configs/mcpapps.json`), not in `test/`.
- Root build includes `build-test`; version scripts include the test package.

**Placement:** Add `server-composable` bin and supporting modules in the test package. Sample configs go in `test/configs/`.

**Phases:**

1. **Preset registry** (`test/src/preset-registry.ts`)
   - Map preset names (snake_case) to factory functions. Factories call existing fixtures (`createEchoTool()`, `createNumberedTools(count)`, etc.).
   - Export a generic resolver, e.g. `resolvePreset(type, name, params)`.

2. **Config loader** (`test/src/load-config.ts` or `test/src/config/load-config.ts`)
   - Read file from path. Format detection: use `--json` or `--yaml` if specified; otherwise infer from file extension (`.json` → JSON, `.yaml` / `.yml` → YAML). Fail if extension is missing or not `.json`/`.yaml`/`.yml` and no flag is given.
   - Parse JSON or YAML (add `yaml` as a dependency). Export typed config object.
   - Paths in config (if any) are resolved relative to **cwd**.
   - Basic validation: fail-fast on required fields (`serverInfo`, `transport`). No elaborate schema validation for v1.

3. **Resolver** (`test/src/resolve-config.ts`)
   - Input: parsed config. For each preset ref, call registry, collect definitions. Handle array-expanding presets.
   - Output: `ServerConfig` for `createMcpServer`.

4. **CLI entry point** (`test/src/server-composable.ts` → `test/build/server-composable.js`)
   - Parse argv; load config; resolve; create server; start transport (stdio or HTTP).
   - For HTTP: extract shared server creation into a reusable function from `test-server-http.ts` so the runnable server and API-based tests share the same code.
   - Graceful shutdown on SIGINT/SIGTERM.

5. **Package, bin, and scripts**
   - Add `server-composable` bin in `test/package.json`.
   - Add root script `"server-composable": "node test/build/server-composable.js"`.
   - Add initial sample config(s) in `test/configs/` (e.g. `demo.json`).

**Order of work:** Preset registry → config loader (JSON) → resolver → CLI (stdio first, then HTTP) → bin + root script + sample configs → end-to-end test with Inspector.

---

#### JSON / YAML format (decided)

Config files may be JSON or YAML. Format is determined by:

- **`--json`** or **`--yaml`** flag: use the specified format (overrides file extension).
- **Otherwise**: infer from file extension (`.json` → JSON, `.yaml` / `.yml` → YAML).
- **Fail** if extension is missing or not `.json` / `.yaml` / `.yml` and no flag is given.

#### Decided

- **Preset registry**: Use generic `resolvePreset(type, name, params)`.
- **Config validation**: Basic fail-fast on `serverInfo`, `transport`. Can add more later.
- **OAuth**: Defer to a future release. (See [Future Work](#7-limitations-and-future-work).)
- **HTTP server**: Extract shared logic from `test-server-http.ts` so the runnable composable server and API-based test servers share the same code.
- **Path resolution**: All paths in config are resolved relative to the process **cwd**.
- **Elicitation and sampling**: Use fixture default schemas. No custom elicitation schema in config. Support both form-based elicitation (`elicitation_task`, `collect_elicitation`) and URL elicitation (`collect_url_elicitation`). Simple params only (e.g. `name`, `samplingText`, `url` if the fixture accepts them).

---

### 6. Placement and Packaging

The test package (`test/`, `@modelcontextprotocol/inspector-test-server`) already exists and contains all composable server code. The config-driven server implementation will live there:

- Add preset registry, config loader, resolver, and `server-composable.ts` under `test/src/`.
- Add `server-composable` bin in `test/package.json`.
- Add root npm script for source users: `npm run server-composable -- --config ./demo.json`.

The test package is currently private. If published later, users could run `npx @modelcontextprotocol/inspector-test-server server-composable --config ./demo.json`. No dependency on core; the package depends only on the SDK, express, and zod.

---

### 7. Limitations and Future Work

1. **No custom handlers in config** — Only presets. Custom tools/resources require code or new presets.
2. **OAuth** — Deferred for v1. OAuth config is complex (issuer URL, static clients, DCR, CIMD). Add as a future enhancement.
3. **Elicitation/sampling** — Config uses fixture defaults (standard forms). No custom schema in config. Both form-based and URL elicitation presets are supported.
4. **Completion callbacks** — Resource templates and prompts can have completion callbacks. Presets like `file` and `args_prompt` support them; config-driven mode would use defaults (e.g. no completion) unless we add preset params for static completion data.
5. **YAML** — Format inferred from `.json` / `.yaml` / `.yml` extension; `--json` / `--yaml` overrides. Requires `yaml` dependency.

---

### 8. Example Usage

**Source users** (from repo after `npm run build`), once sample configs exist in `test/configs/`:

```bash
npm run server-composable -- --config test/configs/demo.json
# or
node test/build/server-composable.js --config test/configs/demo.json
```

**If the test package is published**:

```bash
npx @modelcontextprotocol/inspector-test-server server-composable --config ./demo.json
npx @modelcontextprotocol/inspector-test-server server-composable --config ./demo-http.json --port 3000
```

**mcp.json** (MCP Inspector config) for stdio, when `mcp.json` is at the Inspector repo root:

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

Ensure the working directory is the Inspector repo root (or use absolute paths). For HTTP transport, use a server URL instead of command/args.

---

## Summary

A config-driven composable MCP server would let users run a composed server from a JSON/YAML file without writing code. The design builds on the test package (`@modelcontextprotocol/inspector-test-server`), which already provides `createMcpServer` and fixtures. A preset registry maps config preset refs to those fixtures. The runtime resolves presets, builds `ServerConfig`, and starts stdio or HTTP transport. Implementation adds preset registry, config loader, resolver, and CLI entry point to the test package, plus a root npm script for source users.
