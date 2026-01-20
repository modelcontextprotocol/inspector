# TUI Integration Design

## Overview

This document outlines the design for integrating the Terminal User Interface (TUI) from the [`mcp-inspect`](https://github.com/TeamSparkAI/mcp-inspect) project into the MCP Inspector monorepo.

### Current TUI Project

The `mcp-inspect` project is a standalone Terminal User Interface (TUI) inspector for Model Context Protocol (MCP) servers. It implements similar functionality to the current MCP Inspector web UX, but as a TUI built with React and Ink. The project is currently maintained separately at https://github.com/TeamSparkAI/mcp-inspect.

### Integration Goal

Our goal is to integrate the TUI into the MCP Inspector project, making it a first-class UX option alongside the existing web client and CLI. The integration will be done incrementally across three development phases:

1. **Phase 1**: Integrate TUI as a standalone runnable workspace (no code sharing) ✅ COMPLETE
2. **Phase 2**: Extract MCP module to shared directory (move TUI's MCP code to `shared/` for reuse) ✅ COMPLETE
3. **Phase 3**: Convert CLI to use shared code (replace CLI's direct SDK usage with `InspectorClient` from `shared/`) ✅ COMPLETE

**Note**: These three phases represent development staging to break down the work into manageable steps. The first release (PR) will be submitted at the completion of Phase 3, after all code sharing and organization is complete.

Initially, the TUI will share code primarily with the CLI, as both are terminal-based Node.js applications with similar needs (transport handling, config file loading, MCP client operations).

**Experimental Status**: The TUI functionality may be considered "experimental" until we have done sufficient testing and review of features and implementation. This allows for iteration and refinement based on user feedback before committing to a stable feature set.

### Feature Gaps

Current feature gaps with the web UX include lack of support for elicitation and tasks. These features can be fast follow-ons to the initial integration. After v2 is landed, we will review feature gaps and create a roadmap to bring the TUI to as close to feature parity as possible. Note that some features, like MCP-UI, may not be feasible in a terminal-based interface.

### Future Vision

After the v2 work on the web UX lands, an effort will be made to centralize more code so that all three UX modes (web, CLI, TUI) share code to the extent that it makes sense. The goal is to move as much logic as possible into shared code, making the UX implementations as thin as possible. This will:

- Reduce code duplication across the three interfaces
- Ensure consistent behavior across all UX modes
- Simplify maintenance and feature development
- Create a solid foundation for future enhancements

## Current Project Structure

```
inspector/
├── cli/              # CLI workspace
│   ├── src/
│   │   ├── cli.ts    # Launcher (spawns web client or CLI)
│   │   ├── index.ts  # CLI implementation
│   │   ├── transport.ts
│   │   └── client/   # MCP client utilities
│   └── package.json
├── client/           # Web client workspace (React)
├── server/           # Server workspace
└── package.json      # Root workspace config
```

## Proposed Structure

```
inspector/
├── cli/              # CLI workspace
│   ├── src/
│   │   ├── cli.ts    # Launcher (spawns web client, CLI, or TUI)
│   │   ├── index.ts  # CLI implementation (Phase 3: uses InspectorClient methods)
│   │   └── transport.ts  # Phase 3: deprecated (use shared/mcp/transport.ts)
│   ├── __tests__/
│   │   └── helpers/  # Phase 2: test fixtures moved to shared/test/, Phase 3: imports from shared/test/
│   └── package.json
├── tui/              # NEW: TUI workspace
│   ├── src/
│   │   ├── App.tsx   # Main TUI application
│   │   └── components/  # TUI React components
│   ├── tui.tsx       # TUI entry point
│   └── package.json
├── shared/           # NEW: Shared code workspace package (Phase 2)
│   ├── package.json  # Workspace package config (private, internal-only)
│   ├── tsconfig.json # TypeScript config with composite: true
│   ├── mcp/          # MCP client/server interaction code
│   │   ├── index.ts  # Public API exports
│   │   ├── inspectorClient.ts  # Main InspectorClient class (with MCP method wrappers)
│   │   ├── transport.ts        # Transport creation from MCPServerConfig
│   │   ├── config.ts           # Config loading and argument conversion
│   │   ├── types.ts            # Shared types
│   │   ├── messageTrackingTransport.ts
│   │   └── client.ts
│   ├── json/         # JSON utilities (Phase 3)
│   │   └── jsonUtils.ts  # JsonValue type and conversion utilities
│   ├── react/        # React-specific utilities
│   │   └── useInspectorClient.ts  # React hook for InspectorClient
│   └── test/         # Test fixtures and harness servers
│       ├── test-server-fixtures.ts
│       ├── test-server-http.ts
│       └── test-server-stdio.ts
├── client/           # Web client workspace
├── server/           # Server workspace
└── package.json
```

**Note**: The `shared/` directory is a **workspace package** (`@modelcontextprotocol/inspector-shared`) that is:

- **Private** (`"private": true`) - not published, internal-only
- **Built separately** - compiles to `shared/build/` with TypeScript declarations
- **Referenced via package name** - workspaces import using `@modelcontextprotocol/inspector-shared/*`
- **Uses TypeScript Project References** - CLI and TUI reference shared for build ordering and type resolution
- **React peer dependency** - declares React 19.2.3 as peer dependency (consumers provide React)

## Phase 1: Initial Integration (Standalone TUI)

**Goal**: Get TUI integrated and runnable as a standalone workspace with no code sharing.

### 1.1 Create TUI Workspace

Create a new `tui/` workspace that mirrors the structure of `mcp-inspect`:

- **Location**: `/Users/bob/Documents/GitHub/inspector/tui/`
- **Package name**: `@modelcontextprotocol/inspector-tui`
- **Dependencies**:
  - `ink`, `ink-form`, `ink-scroll-view`, `fullscreen-ink` (TUI libraries)
  - `react` (for Ink components)
  - `@modelcontextprotocol/sdk` (MCP SDK)
  - **No dependencies on CLI workspace** (Phase 1 is self-contained)

### 1.2 Remove CLI Functionality from TUI

The `mcp-inspect` TUI includes a `src/cli.ts` file that implements CLI functionality. This should be **removed** entirely:

- **Delete**: `src/cli.ts` from the TUI workspace
- **Remove**: CLI mode handling from `tui.tsx` entry point
- **Rationale**: The inspector project already has a complete CLI implementation in `cli/src/index.ts`. Users should use `mcp-inspector --cli` for CLI functionality.

### 1.3 Keep TUI Self-Contained (Phase 1)

For Phase 1, the TUI should be completely self-contained:

- **Keep**: All utilities from `mcp-inspect` (transport, config, client) in the TUI workspace
- **No imports**: Do not import from CLI workspace yet
- **Goal**: Get TUI working standalone first, then refactor to share code

**Note**: During Phase 1 implementation, the TUI developed `InspectorClient` and organized MCP code into a `tui/src/mcp/` module. This provides a better foundation for code sharing than originally planned. See "Phase 1.5: InspectorClient Architecture" for details.

### 1.4 Entry Point Strategy

The root `cli/src/cli.ts` launcher should be extended to support a `--tui` flag:

```typescript
// cli/src/cli.ts
async function runTui(args: Args): Promise<void> {
  const tuiPath = resolve(__dirname, "../../tui/build/tui.js");
  // Spawn TUI process with appropriate arguments
  // Similar to runCli and runWebClient
}

function main() {
  const args = parseArgs();

  if (args.tui) {
    return runTui(args);
  } else if (args.cli) {
    return runCli(args);
  } else {
    return runWebClient(args);
  }
}
```

**Alternative**: The TUI could also be invoked directly via `mcp-inspector-tui` binary, but using the main launcher provides consistency and shared argument parsing.

### 1.5 Migration Plan

1. **Create TUI workspace**
   - Copy TUI code from `mcp-inspect/src/` to `tui/src/`
   - Copy `tui.tsx` entry point
   - Set up `tui/package.json` with dependencies
   - **Keep all utilities** (transport, config, client) in TUI for now

2. **Remove CLI functionality**
   - Delete `src/cli.ts` from TUI
   - Remove CLI mode handling from `tui.tsx`
   - Update entry point to only support TUI mode

3. **Update root launcher**
   - Add `--tui` flag to `cli/src/cli.ts`
   - Implement `runTui()` function
   - Update argument parsing

4. **Update root package.json**
   - Add `tui` to workspaces
   - Add build script for TUI
   - Add `tui/build` to `files` array (for publishing)
   - Update version management scripts to include TUI:
     - Add `tui/package.json` to the list of files updated by `update-version.js`
     - Add `tui/package.json` to the list of files checked by `check-version-consistency.js`

5. **Testing**
   - Test TUI with test harness servers from `cli/__tests__/helpers/`
   - Test all transport types (stdio, SSE, HTTP) using test servers
   - Test config file loading
   - Test server selection
   - Verify TUI works standalone without CLI dependencies

## Phase 1.5: InspectorClient Architecture (Current State)

During Phase 1 implementation, the TUI developed a comprehensive client wrapper architecture that provides a better foundation for code sharing than originally planned.

### InspectorClient Overview

The project now includes `InspectorClient` (`shared/mcp/inspectorClient.ts`), a comprehensive client wrapper that:

- **Wraps MCP SDK Client**: Provides a clean interface over the underlying SDK `Client`
- **Message Tracking**: Automatically tracks all JSON-RPC messages (requests, responses, notifications)
- **Stderr Logging**: Captures and stores stderr output from stdio transports
- **Event-Driven**: Extends `EventEmitter` for reactive UI updates
- **Server Data Management**: Automatically fetches and caches tools, resources, prompts, capabilities, server info, and instructions
- **State Management**: Manages connection status, message history, and server state
- **Transport Abstraction**: Works with all transport types (stdio, sse, streamable-http)
- **MCP Method Wrappers**: Provides high-level methods for tools, resources, prompts, and logging:
  - `listTools()`, `callTool()` - Tool operations with automatic parameter conversion
  - `listResources()`, `readResource()`, `listResourceTemplates()` - Resource operations
  - `listPrompts()`, `getPrompt()` - Prompt operations with automatic argument stringification
  - `setLoggingLevel()` - Logging level management with capability checks
- **Configurable Options**:
  - `autoFetchServerContents`: Controls whether to auto-fetch tools/resources/prompts on connect (default: `true` for TUI, `false` for CLI)
  - `initialLoggingLevel`: Sets the logging level on connect if server supports logging (optional)
  - `maxMessages`: Maximum number of messages to store (default: 1000)
  - `maxStderrLogEvents`: Maximum number of stderr log entries to store (default: 1000)
  - `pipeStderr`: Whether to pipe stderr for stdio transports (default: `true` for TUI, `false` for CLI)

### Shared Module Structure (Phase 2 Complete)

The shared codebase includes MCP, React, JSON utilities, and test fixtures:

**`shared/mcp/`** - MCP client/server interaction:

- `inspectorClient.ts` - Main `InspectorClient` class with MCP method wrappers
- `transport.ts` - Transport creation from `MCPServerConfig`
- `config.ts` - Config file loading (`loadMcpServersConfig`) and argument conversion (`argsToMcpServerConfig`)
- `types.ts` - Shared types (`MCPServerConfig`, `MessageEntry`, `ConnectionStatus`, etc.)
- `messageTrackingTransport.ts` - Transport wrapper for message tracking
- `client.ts` - Thin wrapper around SDK `Client` creation
- `index.ts` - Public API exports

**`shared/json/`** - JSON utilities:

- `jsonUtils.ts` - JSON value types and conversion utilities (`JsonValue`, `convertParameterValue`, `convertToolParameters`, `convertPromptArguments`)

**`shared/react/`** - React-specific utilities:

- `useInspectorClient.ts` - React hook for `InspectorClient`

**`shared/test/`** - Test fixtures and harness servers:

- `test-server-fixtures.ts` - Shared server configs and definitions
- `test-server-http.ts` - HTTP/SSE test server
- `test-server-stdio.ts` - Stdio test server

### Benefits of InspectorClient

1. **Unified Client Interface**: Single class handles all client operations
2. **Automatic State Management**: No manual state synchronization needed
3. **Event-Driven Updates**: Perfect for reactive UIs (React/Ink)
4. **Message History**: Built-in request/response/notification tracking
5. **Stderr Capture**: Automatic logging for stdio transports
6. **Type Safety**: Uses SDK types directly, no data loss
7. **High-Level Methods**: Provides convenient wrappers for tools, resources, prompts, and logging with automatic parameter conversion and error handling
8. **Code Reuse**: CLI and TUI both use the same `InspectorClient` methods, eliminating duplicate helper code

## Phase 2: Extract MCP Module to Shared Directory ✅ COMPLETE

Move the TUI's MCP module to a shared directory so both TUI and CLI can use it. This establishes the shared codebase before converting the CLI.

**Status**: Phase 2 is complete. All MCP code has been moved to `shared/mcp/`, the React hook moved to `shared/react/`, and test fixtures moved to `shared/test/`. The `argsToMcpServerConfig()` function has been implemented. Shared is configured as a workspace package with TypeScript Project References. React 19.2.3 is used consistently across all workspaces.

### 2.1 Shared Package Structure

Create a `shared/` workspace package at the root level:

```
shared/              # Workspace package: @modelcontextprotocol/inspector-shared
├── package.json     # Package config (private: true, peerDependencies: react)
├── tsconfig.json    # TypeScript config (composite: true, declaration: true)
├── build/           # Compiled output (JS + .d.ts files)
├── mcp/             # MCP client/server interaction code
│   ├── index.ts     # Re-exports public API
│   ├── inspectorClient.ts  # Main InspectorClient class
│   ├── transport.ts       # Transport creation from MCPServerConfig
│   ├── config.ts           # Config loading and argument conversion
│   ├── types.ts            # Shared types (MCPServerConfig, MessageEntry, etc.)
│   ├── messageTrackingTransport.ts  # Transport wrapper for message tracking
│   └── client.ts           # Thin wrapper around SDK Client creation
├── react/           # React-specific utilities
│   └── useInspectorClient.ts  # React hook for InspectorClient
└── test/            # Test fixtures and harness servers
    ├── test-server-fixtures.ts  # Shared server configs and definitions
    ├── test-server-http.ts
    └── test-server-stdio.ts
```

**Package Configuration:**

- `package.json`: Declares `"private": true"` (internal-only, not published)
- `peerDependencies`: `"react": "^19.2.3"` (consumers provide React)
- `devDependencies`: `react`, `@types/react`, `typescript` (for compilation)
- `main`: `"./build/index.js"` (compiled output)
- `types`: `"./build/index.d.ts"` (TypeScript declarations)

**TypeScript Configuration:**

- `composite: true` - Enables Project References
- `declaration: true` - Generates .d.ts files
- `rootDir: "."` - Compiles from source root
- `outDir: "./build"` - Outputs to build directory

**Workspace Integration:**

- Added to root `workspaces` array
- CLI and TUI declare dependency: `"@modelcontextprotocol/inspector-shared": "*"`
- TypeScript Project References: `"references": [{ "path": "../shared" }]`
- Build order: shared builds first, then CLI/TUI

### 2.2 Code to Move

**MCP Module** (from `tui/src/mcp/` to `shared/mcp/`):

- `inspectorClient.ts` → `shared/mcp/inspectorClient.ts`
- `transport.ts` → `shared/mcp/transport.ts`
- `config.ts` → `shared/mcp/config.ts` (add `argsToMcpServerConfig` function)
- `types.ts` → `shared/mcp/types.ts`
- `messageTrackingTransport.ts` → `shared/mcp/messageTrackingTransport.ts`
- `client.ts` → `shared/mcp/client.ts`
- `index.ts` → `shared/mcp/index.ts`

**React Hook** (from `tui/src/hooks/` to `shared/react/`):

- `useInspectorClient.ts` → `shared/react/useInspectorClient.ts`

**Test Fixtures** (from `cli/__tests__/helpers/` to `shared/test/`):

- `test-fixtures.ts` → `shared/test/test-server-fixtures.ts` (renamed)
- `test-server-http.ts` → `shared/test/test-server-http.ts`
- `test-server-stdio.ts` → `shared/test/test-server-stdio.ts`

### 2.3 Add argsToMcpServerConfig Function

Add a utility function to convert CLI arguments to `MCPServerConfig`:

```typescript
// shared/mcp/config.ts
export function argsToMcpServerConfig(args: {
  command?: string;
  args?: string[];
  envArgs?: Record<string, string>;
  transport?: "stdio" | "sse" | "streamable-http";
  serverUrl?: string;
  headers?: Record<string, string>;
}): MCPServerConfig {
  // Convert CLI args format to MCPServerConfig format
  // Handle stdio, SSE, and streamable-http transports
}
```

**Key conversions needed**:

- CLI `transport: "streamable-http"` → `MCPServerConfig.type: "streamable-http"` (no mapping needed)
- CLI `command` + `args` + `envArgs` → `StdioServerConfig`
- CLI `serverUrl` + `headers` → `SseServerConfig` or `StreamableHttpServerConfig`
- Auto-detect transport type from URL if not specified
- CLI uses `"http"` for streamable-http, so map `"http"` → `"streamable-http"` when calling `argsToMcpServerConfig()`

### 2.4 Implementation Details

**Shared Package Setup:**

1. Created `shared/package.json` as a workspace package (`@modelcontextprotocol/inspector-shared`)
2. Configured TypeScript with `composite: true` and `declaration: true` for Project References
3. Set React 19.2.3 as peer dependency (both client and TUI upgraded to React 19.2.3)
4. Added React and @types/react to devDependencies for TypeScript compilation
5. Added `shared` to root `workspaces` array
6. Updated root build script to build shared first: `"build-shared": "cd shared && npm run build"`

**Import Strategy:**

- Workspaces import using package name: `@modelcontextprotocol/inspector-shared/mcp/types.js`
- No path mappings needed - npm workspaces resolve package name automatically
- TypeScript Project References ensure correct build ordering and type resolution

**Build Process:**

- Shared compiles to `shared/build/` with TypeScript declarations
- CLI and TUI reference shared via Project References
- Build order: `npm run build-shared` → `npm run build-cli` → `npm run build-tui`

**React Version Alignment:**

- Upgraded client from React 18.3.1 to React 19.2.3 (matching TUI)
- All Radix UI components support React 19
- Single React 19.2.3 instance hoisted to root node_modules
- Shared code uses peer dependency pattern (consumers provide React)

### 2.5 Status

**Phase 2 is complete.** All MCP code has been moved to `shared/mcp/`, the React hook to `shared/react/`, and test fixtures to `shared/test/`. The `argsToMcpServerConfig()` function has been implemented. Shared is configured as a workspace package with TypeScript Project References. TUI and CLI successfully import from and use the shared code. React 19.2.3 is used consistently across all workspaces.

## File-by-File Migration Guide

### From mcp-inspect to inspector/tui

| mcp-inspect                 | inspector/tui                   | Phase | Notes                                                            |
| --------------------------- | ------------------------------- | ----- | ---------------------------------------------------------------- |
| `tui.tsx`                   | `tui/tui.tsx`                   | 1     | Entry point, remove CLI mode handling                            |
| `src/App.tsx`               | `tui/src/App.tsx`               | 1     | Main TUI application                                             |
| `src/components/*`          | `tui/src/components/*`          | 1     | All TUI components                                               |
| `src/hooks/*`               | `tui/src/hooks/*`               | 1     | TUI-specific hooks                                               |
| `src/types/*`               | `tui/src/types/*`               | 1     | TUI-specific types                                               |
| `src/cli.ts`                | **DELETE**                      | 1     | CLI functionality exists in `cli/src/index.ts`                   |
| `src/utils/transport.ts`    | `shared/mcp/transport.ts`       | 2     | Moved to `shared/mcp/` (Phase 2 complete)                        |
| `src/utils/config.ts`       | `shared/mcp/config.ts`          | 2     | Moved to `shared/mcp/` (Phase 2 complete)                        |
| `src/utils/client.ts`       | **N/A**                         | 1     | Replaced by `InspectorClient` in `shared/mcp/inspectorClient.ts` |
| `src/utils/schemaToForm.ts` | `tui/src/utils/schemaToForm.ts` | 1     | TUI-specific (form generation), keep                             |

### Code Sharing Strategy

| Current Location                             | Phase 2 Status                                                                             | Phase 3 Action                                 | Notes                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------- | -------------------------------------------------------- |
| `tui/src/mcp/inspectorClient.ts`             | ✅ Moved to `shared/mcp/inspectorClient.ts`                                                | CLI imports and uses                           | Main client wrapper, replaces CLI wrapper functions      |
| `tui/src/mcp/transport.ts`                   | ✅ Moved to `shared/mcp/transport.ts`                                                      | CLI imports and uses                           | Transport creation from MCPServerConfig                  |
| `tui/src/mcp/config.ts`                      | ✅ Moved to `shared/mcp/config.ts` (with `argsToMcpServerConfig`)                          | CLI imports and uses                           | Config loading and argument conversion                   |
| `tui/src/mcp/types.ts`                       | ✅ Moved to `shared/mcp/types.ts`                                                          | CLI imports and uses                           | Shared types (MCPServerConfig, MessageEntry, etc.)       |
| `tui/src/mcp/messageTrackingTransport.ts`    | ✅ Moved to `shared/mcp/messageTrackingTransport.ts`                                       | CLI imports (if needed)                        | Transport wrapper for message tracking                   |
| `tui/src/hooks/useInspectorClient.ts`        | ✅ Moved to `shared/react/useInspectorClient.ts`                                           | TUI imports from shared                        | React hook for InspectorClient                           |
| `cli/src/transport.ts`                       | Keep (temporary)                                                                           | **Deprecated** (use `shared/mcp/transport.ts`) | Replaced by `shared/mcp/transport.ts`                    |
| `cli/src/client/connection.ts`               | Keep (temporary)                                                                           | **Deprecated** (use `InspectorClient`)         | Replaced by `InspectorClient`                            |
| `cli/src/client/tools.ts`                    | ✅ Moved to `InspectorClient.listTools()`, `callTool()`                                    | **Deleted**                                    | Methods now in `InspectorClient`                         |
| `cli/src/client/resources.ts`                | ✅ Moved to `InspectorClient.listResources()`, `readResource()`, `listResourceTemplates()` | **Deleted**                                    | Methods now in `InspectorClient`                         |
| `cli/src/client/prompts.ts`                  | ✅ Moved to `InspectorClient.listPrompts()`, `getPrompt()`                                 | **Deleted**                                    | Methods now in `InspectorClient`                         |
| `cli/src/client/types.ts`                    | Keep (temporary)                                                                           | **Deprecated** (use SDK types)                 | Use SDK types directly                                   |
| `cli/src/index.ts::parseArgs()`              | Keep CLI-specific                                                                          | Keep CLI-specific                              | CLI-only argument parsing                                |
| `cli/__tests__/helpers/test-fixtures.ts`     | ✅ Moved to `shared/test/test-server-fixtures.ts` (renamed)                                | CLI tests import from shared                   | Shared test server configs and definitions               |
| `cli/__tests__/helpers/test-server-http.ts`  | ✅ Moved to `shared/test/test-server-http.ts`                                              | CLI tests import from shared                   | Shared test harness                                      |
| `cli/__tests__/helpers/test-server-stdio.ts` | ✅ Moved to `shared/test/test-server-stdio.ts`                                             | CLI tests import from shared                   | Shared test harness                                      |
| `cli/__tests__/helpers/fixtures.ts`          | Keep in CLI tests                                                                          | Keep in CLI tests                              | CLI-specific test utilities (config file creation, etc.) |

## Phase 3: Convert CLI to Use Shared Code ✅ COMPLETE

Replace the CLI's direct MCP SDK usage with `InspectorClient` from `shared/mcp/`, consolidating client logic and leveraging the shared codebase.

**Status**: Phase 3 is complete. The CLI now uses `InspectorClient` for all MCP operations, with a local `argsToMcpServerConfig()` function to convert CLI arguments to `MCPServerConfig`. The CLI helper functions (`tools.ts`, `resources.ts`, `prompts.ts`) have been moved into `InspectorClient` as methods (`listTools()`, `callTool()`, `listResources()`, `readResource()`, `listResourceTemplates()`, `listPrompts()`, `getPrompt()`, `setLoggingLevel()`), and the `cli/src/client/` directory has been removed. JSON utilities were extracted to `shared/json/jsonUtils.ts`. The CLI sets `autoFetchServerContents: false` (since it calls methods directly) and `initialLoggingLevel: "debug"` for consistent logging. The TUI's `ToolTestModal` has also been updated to use `InspectorClient.callTool()` instead of the SDK Client directly. All CLI tests pass with the new implementation.

### 3.1 Current CLI Architecture

The CLI currently:

- Uses direct SDK `Client` instances (`new Client()`)
- Has its own `transport.ts` with `createTransport()` and `TransportOptions`
- Has `createTransportOptions()` function to convert CLI args to transport options
- Uses `client/*` utilities that wrap SDK methods (tools, resources, prompts, connection)
- Manages connection lifecycle manually (`connect()`, `disconnect()`)

**Current files to be replaced/deprecated:**

- `cli/src/transport.ts` - Replace with `shared/mcp/transport.ts`
- `cli/src/client/connection.ts` - Replace with `InspectorClient.connect()`/`disconnect()`
- `cli/src/client/tools.ts` - Update to use `InspectorClient.getClient()`
- `cli/src/client/resources.ts` - Update to use `InspectorClient.getClient()`
- `cli/src/client/prompts.ts` - Update to use `InspectorClient.getClient()`

### 3.2 Conversion Strategy

**Replace direct Client usage with InspectorClient:**

1. **Replace transport creation:**
   - ✅ Removed `createTransportOptions()` function
   - ✅ Implemented local `argsToMcpServerConfig()` function in `cli/src/index.ts` that converts CLI `Args` to `MCPServerConfig`
   - ✅ `InspectorClient` handles transport creation internally via `createTransportFromConfig()`

2. **Replace connection management:**
   - ✅ Replaced `new Client()` + `connect(client, transport)` with `new InspectorClient(config)` + `inspectorClient.connect()`
   - ✅ Replaced `disconnect(transport)` with `inspectorClient.disconnect()`

3. **Update client utilities:**
   - ✅ Kept CLI-specific utility functions (`listTools`, `callTool`, etc.) - they still accept `Client` (SDK type)
   - ✅ Utilities use `inspectorClient.getClient()` to access SDK methods
   - ✅ This preserves the CLI's API while using shared code internally

4. **Update main CLI flow:**
   - ✅ In `callMethod()`, replaced transport/client setup with `InspectorClient`
   - ✅ All method calls use utilities that work with `inspectorClient.getClient()`
   - ✅ Configured `InspectorClient` with `autoFetchServerContents: false` (CLI calls methods directly)
   - ✅ Configured `InspectorClient` with `initialLoggingLevel: "debug"` for consistent CLI logging

### 3.3 Migration Steps

1. **Update imports in `cli/src/index.ts`:** ✅
   - ✅ Import `InspectorClient` from `@modelcontextprotocol/inspector-shared/mcp/inspectorClient.js`
   - ✅ Import `MCPServerConfig`, `StdioServerConfig`, `SseServerConfig`, `StreamableHttpServerConfig` types from `@modelcontextprotocol/inspector-shared/mcp/types.js`
   - ✅ Import `LoggingLevel` and `LoggingLevelSchema` from SDK for log level validation

2. **Replace transport creation:** ✅
   - ✅ Removed `createTransportOptions()` function
   - ✅ Removed `createTransport()` import from `./transport.js`
   - ✅ Implemented local `argsToMcpServerConfig()` function in `cli/src/index.ts` that:
     - Takes CLI `Args` type directly
     - Handles all CLI-specific conversions (URL detection, transport validation, `"http"` → `"streamable-http"` mapping)
     - Returns `MCPServerConfig` for use with `InspectorClient`
   - ✅ `InspectorClient` handles transport creation internally

3. **Replace Client with InspectorClient:** ✅
   - ✅ Replaced `new Client(clientIdentity)` with `new InspectorClient(mcpServerConfig, options)`
   - ✅ Replaced `connect(client, transport)` with `inspectorClient.connect()`
   - ✅ Replaced `disconnect(transport)` with `inspectorClient.disconnect()`
   - ✅ Configured `InspectorClient` with:
     - `autoFetchServerContents: false` (CLI calls methods directly, no auto-fetching needed)
     - `initialLoggingLevel: "debug"` (consistent CLI logging)

4. **Update client utilities:** ✅
   - ✅ Moved CLI helper functions (`tools.ts`, `resources.ts`, `prompts.ts`) into `InspectorClient` as methods
   - ✅ Added `listTools()`, `callTool()`, `listResources()`, `readResource()`, `listResourceTemplates()`, `listPrompts()`, `getPrompt()`, `setLoggingLevel()` methods to `InspectorClient`
   - ✅ Extracted JSON conversion utilities to `shared/json/jsonUtils.ts`
   - ✅ Deleted `cli/src/client/` directory entirely
   - ✅ CLI now calls `inspectorClient.listTools()`, `inspectorClient.callTool()`, etc. directly

5. **Update CLI argument conversion:** ✅
   - ✅ Local `argsToMcpServerConfig()` handles all CLI-specific logic:
     - Detects URL vs. command
     - Validates transport/URL combinations
     - Auto-detects transport type from URL path (`/mcp` → streamable-http, `/sse` → SSE)
     - Maps CLI's `"http"` to `"streamable-http"`
     - Handles stdio command/args/env conversion
   - ✅ All CLI argument combinations are correctly converted

6. **Update tests:** ✅
   - ✅ CLI tests already use `@modelcontextprotocol/inspector-shared/test/` (done in Phase 2)
   - ✅ Tests use `InspectorClient` via the CLI's `callMethod()` function
   - ✅ All test scenarios pass

7. **Cleanup:**
   - ✅ Deleted `cli/src/client/` directory (tools.ts, resources.ts, prompts.ts, types.ts, index.ts)
   - `cli/src/transport.ts` - Still exists but is no longer used (can be removed in future cleanup)

8. **Test thoroughly:** ✅
   - ✅ All CLI methods tested (tools/list, tools/call, resources/list, resources/read, prompts/list, prompts/get, logging/setLevel)
   - ✅ All transport types tested (stdio, SSE, streamable-http)
   - ✅ CLI output format preserved (identical JSON)
   - ✅ All CLI tests pass

### 3.4 Example Conversion

**Before (current):**

```typescript
const transportOptions = createTransportOptions(
  args.target,
  args.transport,
  args.headers,
);
const transport = createTransport(transportOptions);
const client = new Client(clientIdentity);
await connect(client, transport);
const result = await listTools(client, args.metadata);
await disconnect(transport);
```

**After (with shared code):**

```typescript
// Local function in cli/src/index.ts converts CLI Args to MCPServerConfig
const config = argsToMcpServerConfig(args); // Handles all CLI-specific conversions

const inspectorClient = new InspectorClient(config, {
  clientIdentity,
  autoFetchServerContents: false, // CLI calls methods directly
  initialLoggingLevel: "debug", // Consistent CLI logging
});

await inspectorClient.connect();
const result = await listTools(inspectorClient.getClient(), args.metadata);
await inspectorClient.disconnect();
```

**Key differences:**

- `argsToMcpServerConfig()` is a **local function** in `cli/src/index.ts` (not imported from shared)
- It takes CLI's `Args` type directly and handles all CLI-specific conversions internally
- `InspectorClient` is configured with `autoFetchServerContents: false` (CLI doesn't need auto-fetching)
- Client utilities still accept `Client` (SDK type) and use `inspectorClient.getClient()` to access it

## Package.json Configuration

### Root package.json

```json
{
  "workspaces": ["client", "server", "cli", "tui", "shared"],
  "bin": {
    "mcp-inspector": "cli/build/cli.js"
  },
  "files": [
    "client/bin",
    "client/dist",
    "server/build",
    "cli/build",
    "tui/build"
  ],
  "scripts": {
    "build": "npm run build-shared && npm run build-server && npm run build-client && npm run build-cli && npm run build-tui",
    "build-shared": "cd shared && npm run build",
    "build-tui": "cd tui && npm run build",
    "update-version": "node scripts/update-version.js",
    "check-version": "node scripts/check-version-consistency.js"
  }
}
```

**Note**: `shared/` is a workspace package but is not included in `files` array (it's internal-only, not published).

**Note**:

- TUI build artifacts (`tui/build`) are included in the `files` array for publishing, following the same approach as CLI
- TUI will use the same version number as CLI and web client. The version management scripts (`update-version.js` and `check-version-consistency.js`) will need to be updated to include TUI in the version synchronization process

### tui/package.json

```json
{
  "name": "@modelcontextprotocol/inspector-tui",
  "version": "0.18.0",
  "type": "module",
  "main": "build/tui.js",
  "bin": {
    "mcp-inspector-tui": "./build/tui.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx tui.tsx"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.25.2",
    "fullscreen-ink": "^0.1.0",
    "ink": "^6.6.0",
    "ink-form": "^2.0.1",
    "ink-scroll-view": "^0.3.5",
    "react": "^19.2.3"
  },
  "devDependencies": {
    "@types/node": "^25.0.3",
    "@types/react": "^19.2.7",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3"
  }
}
```

**Note**: TUI and client both use React 19.2.3. React is hoisted to root node_modules, ensuring a single React instance across all workspaces. Shared package declares React as a peer dependency.

### tui/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "jsx": "react",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "tui.tsx"],
  "exclude": ["node_modules", "build"]
}
```

**Note**: No path mappings needed in Phase 1. In Phase 2, use direct relative imports instead of path mappings.

## Entry Point Strategy

The main `mcp-inspector` command will support a `--tui` flag to launch TUI mode:

- `mcp-inspector --cli ...` → CLI mode
- `mcp-inspector --tui ...` → TUI mode
- `mcp-inspector ...` → Web client mode (default)

This provides a single entry point with consistent argument parsing across all three UX modes.

## Testing Strategy

### Unit Tests

- Test TUI components in isolation where possible
- Mock MCP client for TUI component tests
- Test shared utilities (transport, config) independently (when shared in Phase 2)

### Integration Tests

- **Use test harness servers**: Test TUI with test harness servers from `cli/__tests__/helpers/`
  - `TestServerHttp` for HTTP/SSE transport testing
  - `TestServerStdio` for stdio transport testing
  - These servers are composable and support all transports
- Test config file loading and server selection
- Test all transport types (stdio, SSE, HTTP) using test servers
- Test shared code paths between CLI and TUI (Phase 2)

### E2E Tests

- Test full TUI workflows (connect, list tools, call tool, etc.)
- Test TUI with various server configurations using test harness servers
- Test TUI error handling and edge cases

## Implementation Checklist

### Phase 1: Initial Integration (Standalone TUI)

- [x] Create `tui/` workspace directory
- [x] Set up `tui/package.json` with dependencies
- [x] Configure `tui/tsconfig.json` (no path mappings needed)
- [x] Copy TUI source files from mcp-inspect
- [x] **Remove CLI functionality**: Delete `src/cli.ts` from TUI
- [x] **Remove CLI mode**: Remove CLI mode handling from `tui.tsx` entry point
- [x] **Keep utilities**: Keep transport, config, client utilities in TUI (self-contained)
- [x] Add `--tui` flag to `cli/src/cli.ts`
- [x] Implement `runTui()` function in launcher
- [x] Update root `package.json` with tui workspace
- [x] Add build scripts for TUI
- [x] Update version management scripts (`update-version.js` and `check-version-consistency.js`) to include TUI
- [x] Test config file loading
- [x] Test server selection
- [x] Verify TUI works standalone without CLI dependencies

### Phase 2: Extract MCP Module to Shared Directory

- [x] Create `shared/` directory structure (not a workspace)
- [x] Create `shared/mcp/` subdirectory
- [x] Create `shared/react/` subdirectory
- [x] Create `shared/test/` subdirectory
- [x] Move MCP module from `tui/src/mcp/` to `shared/mcp/`:
  - [x] `inspectorClient.ts` → `shared/mcp/inspectorClient.ts`
  - [x] `transport.ts` → `shared/mcp/transport.ts`
  - [x] `config.ts` → `shared/mcp/config.ts`
  - [x] `types.ts` → `shared/mcp/types.ts`
  - [x] `messageTrackingTransport.ts` → `shared/mcp/messageTrackingTransport.ts`
  - [x] `client.ts` → `shared/mcp/client.ts`
  - [x] `index.ts` → `shared/mcp/index.ts`
- [x] Add `argsToMcpServerConfig()` function to `shared/mcp/config.ts`
- [x] Move React hook from `tui/src/hooks/useInspectorClient.ts` to `shared/react/useInspectorClient.ts`
- [x] Move test fixtures from `cli/__tests__/helpers/` to `shared/test/`:
  - [x] `test-fixtures.ts` → `shared/test/test-server-fixtures.ts` (renamed)
  - [x] `test-server-http.ts` → `shared/test/test-server-http.ts`
  - [x] `test-server-stdio.ts` → `shared/test/test-server-stdio.ts`
- [x] Update TUI imports to use `@modelcontextprotocol/inspector-shared/mcp/` and `@modelcontextprotocol/inspector-shared/react/`
- [x] Create `shared/package.json` as workspace package
- [x] Configure `shared/tsconfig.json` with composite and declaration
- [x] Add shared to root workspaces
- [x] Set React 19.2.3 as peer dependency in shared
- [x] Upgrade client to React 19.2.3
- [x] Configure TypeScript Project References in CLI and TUI
- [x] Update root build script to build shared first
- [x] Update CLI test imports to use `@modelcontextprotocol/inspector-shared/test/`
- [x] Test TUI functionality (verify it still works with shared code)
- [x] Test CLI tests (verify test fixtures work from new location)
- [x] Update documentation

### Phase 3: Convert CLI to Use Shared Code ✅ COMPLETE

- [x] Update CLI imports to use `InspectorClient` from `@modelcontextprotocol/inspector-shared/mcp/inspectorClient.js`
- [x] Update CLI imports to use `MCPServerConfig` types from `@modelcontextprotocol/inspector-shared/mcp/types.js`
- [x] Implement local `argsToMcpServerConfig()` function in `cli/src/index.ts` that converts CLI `Args` to `MCPServerConfig`
- [x] Remove `createTransportOptions()` function
- [x] Remove `createTransport()` import and usage
- [x] Replace `new Client()` + `connect()` with `new InspectorClient()` + `connect()`
- [x] Replace `disconnect(transport)` with `inspectorClient.disconnect()`
- [x] Configure `InspectorClient` with `autoFetchServerContents: false` and `initialLoggingLevel: "debug"`
- [x] Move CLI helper functions to `InspectorClient` as methods (`listTools`, `callTool`, `listResources`, `readResource`, `listResourceTemplates`, `listPrompts`, `getPrompt`, `setLoggingLevel`)
- [x] Extract JSON utilities to `shared/json/jsonUtils.ts`
- [x] Delete `cli/src/client/` directory
- [x] Update TUI `ToolTestModal` to use `InspectorClient.callTool()` instead of SDK Client
- [x] Handle transport type mapping (`"http"` → `"streamable-http"`) in local `argsToMcpServerConfig()`
- [x] Handle URL detection and transport auto-detection in local `argsToMcpServerConfig()`
- [x] Update `validLogLevels` to use `LoggingLevelSchema.enum` from SDK
- [x] Test all CLI methods with all transport types
- [x] Verify CLI output format is preserved (identical JSON)
- [x] Run all CLI tests (all passing)
- [x] Update documentation
