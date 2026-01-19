# TUI Integration Design

## Overview

This document outlines the design for integrating the Terminal User Interface (TUI) from the [`mcp-inspect`](https://github.com/TeamSparkAI/mcp-inspect) project into the MCP Inspector monorepo.

### Current TUI Project

The `mcp-inspect` project is a standalone Terminal User Interface (TUI) inspector for Model Context Protocol (MCP) servers. It implements similar functionality to the current MCP Inspector web UX, but as a TUI built with React and Ink. The project is currently maintained separately at https://github.com/TeamSparkAI/mcp-inspect.

### Integration Goal

Our goal is to integrate the TUI into the MCP Inspector project, making it a first-class UX option alongside the existing web client and CLI. The integration will be done incrementally across three development phases:

1. **Phase 1**: Integrate TUI as a standalone runnable workspace (no code sharing) ✅ COMPLETE
2. **Phase 2**: Extract MCP module to shared directory (move TUI's MCP code to `shared/` for reuse) ✅ COMPLETE
3. **Phase 3**: Convert CLI to use shared code (replace CLI's direct SDK usage with `InspectorClient` from `shared/`)

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
│   │   ├── index.ts  # CLI implementation (Phase 3: uses shared/mcp/)
│   │   ├── transport.ts  # Phase 3: deprecated (use shared/mcp/transport.ts)
│   │   └── client/   # MCP client utilities (Phase 3: deprecated, use InspectorClient)
│   ├── __tests__/
│   │   └── helpers/  # Phase 2: test fixtures moved to shared/test/, Phase 3: imports from shared/test/
│   └── package.json
├── tui/              # NEW: TUI workspace
│   ├── src/
│   │   ├── App.tsx   # Main TUI application
│   │   └── components/  # TUI React components
│   ├── tui.tsx       # TUI entry point
│   └── package.json
├── shared/           # NEW: Shared code directory (Phase 2)
│   ├── mcp/          # MCP client/server interaction code
│   │   ├── index.ts  # Public API exports
│   │   ├── inspectorClient.ts  # Main InspectorClient class
│   │   ├── transport.ts        # Transport creation from MCPServerConfig
│   │   ├── config.ts           # Config loading and argument conversion
│   │   ├── types.ts            # Shared types
│   │   ├── messageTrackingTransport.ts
│   │   └── client.ts
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

**Note**: The `shared/` directory is not a workspace/package, just a common directory for shared internal helpers. Direct imports are used from this directory. Test fixtures are also shared so both CLI and TUI tests can use the same test harness servers.

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
- **Transport Abstraction**: Works with all transport types (stdio, SSE, streamableHttp)

### Shared MCP Module Structure (Phase 2 Complete)

The MCP-related code has been moved to `shared/mcp/` and is used by both TUI and CLI:

- `inspectorClient.ts` - Main `InspectorClient` class
- `transport.ts` - Transport creation from `MCPServerConfig`
- `config.ts` - Config file loading (`loadMcpServersConfig`) and argument conversion (`argsToMcpServerConfig`)
- `types.ts` - Shared types (`MCPServerConfig`, `MessageEntry`, `ConnectionStatus`, etc.)
- `messageTrackingTransport.ts` - Transport wrapper for message tracking
- `client.ts` - Thin wrapper around SDK `Client` creation
- `index.ts` - Public API exports

### Benefits of InspectorClient

1. **Unified Client Interface**: Single class handles all client operations
2. **Automatic State Management**: No manual state synchronization needed
3. **Event-Driven Updates**: Perfect for reactive UIs (React/Ink)
4. **Message History**: Built-in request/response/notification tracking
5. **Stderr Capture**: Automatic logging for stdio transports
6. **Type Safety**: Uses SDK types directly, no data loss

## Phase 2: Extract MCP Module to Shared Directory ✅ COMPLETE

Move the TUI's MCP module to a shared directory so both TUI and CLI can use it. This establishes the shared codebase before converting the CLI.

**Status**: Phase 2 is complete. All MCP code has been moved to `shared/mcp/`, the React hook moved to `shared/react/`, and test fixtures moved to `shared/test/`. The `argsToMcpServerConfig()` function has been implemented.

### 2.1 Shared Directory Structure

Create a `shared/` directory at the root level (not a workspace, just a directory):

```
shared/              # Not a workspace, just a directory
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
  // Handle stdio, SSE, and streamableHttp transports
}
```

**Key conversions needed**:

- CLI `transport: "streamable-http"` → `MCPServerConfig.type: "streamableHttp"`
- CLI `command` + `args` + `envArgs` → `StdioServerConfig`
- CLI `serverUrl` + `headers` → `SseServerConfig` or `StreamableHttpServerConfig`
- Auto-detect transport type from URL if not specified

### 2.4 Status

**Phase 2 is complete.** All MCP code has been moved to `shared/mcp/`, the React hook to `shared/react/`, and test fixtures to `shared/test/`. The `argsToMcpServerConfig()` function has been implemented. TUI successfully imports from and uses the shared code.

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

| Current Location                             | Phase 2 Status                                                    | Phase 3 Action                                     | Notes                                                    |
| -------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| `tui/src/mcp/inspectorClient.ts`             | ✅ Moved to `shared/mcp/inspectorClient.ts`                       | CLI imports and uses                               | Main client wrapper, replaces CLI wrapper functions      |
| `tui/src/mcp/transport.ts`                   | ✅ Moved to `shared/mcp/transport.ts`                             | CLI imports and uses                               | Transport creation from MCPServerConfig                  |
| `tui/src/mcp/config.ts`                      | ✅ Moved to `shared/mcp/config.ts` (with `argsToMcpServerConfig`) | CLI imports and uses                               | Config loading and argument conversion                   |
| `tui/src/mcp/types.ts`                       | ✅ Moved to `shared/mcp/types.ts`                                 | CLI imports and uses                               | Shared types (MCPServerConfig, MessageEntry, etc.)       |
| `tui/src/mcp/messageTrackingTransport.ts`    | ✅ Moved to `shared/mcp/messageTrackingTransport.ts`              | CLI imports (if needed)                            | Transport wrapper for message tracking                   |
| `tui/src/hooks/useInspectorClient.ts`        | ✅ Moved to `shared/react/useInspectorClient.ts`                  | TUI imports from shared                            | React hook for InspectorClient                           |
| `cli/src/transport.ts`                       | Keep (temporary)                                                  | **Deprecated** (use `shared/mcp/transport.ts`)     | Replaced by `shared/mcp/transport.ts`                    |
| `cli/src/client/connection.ts`               | Keep (temporary)                                                  | **Deprecated** (use `InspectorClient`)             | Replaced by `InspectorClient`                            |
| `cli/src/client/tools.ts`                    | Keep (temporary)                                                  | **Deprecated** (use `InspectorClient.getClient()`) | Use SDK methods directly via `InspectorClient`           |
| `cli/src/client/resources.ts`                | Keep (temporary)                                                  | **Deprecated** (use `InspectorClient.getClient()`) | Use SDK methods directly via `InspectorClient`           |
| `cli/src/client/prompts.ts`                  | Keep (temporary)                                                  | **Deprecated** (use `InspectorClient.getClient()`) | Use SDK methods directly via `InspectorClient`           |
| `cli/src/client/types.ts`                    | Keep (temporary)                                                  | **Deprecated** (use SDK types)                     | Use SDK types directly                                   |
| `cli/src/index.ts::parseArgs()`              | Keep CLI-specific                                                 | Keep CLI-specific                                  | CLI-only argument parsing                                |
| `cli/__tests__/helpers/test-fixtures.ts`     | ✅ Moved to `shared/test/test-server-fixtures.ts` (renamed)       | CLI tests import from shared                       | Shared test server configs and definitions               |
| `cli/__tests__/helpers/test-server-http.ts`  | ✅ Moved to `shared/test/test-server-http.ts`                     | CLI tests import from shared                       | Shared test harness                                      |
| `cli/__tests__/helpers/test-server-stdio.ts` | ✅ Moved to `shared/test/test-server-stdio.ts`                    | CLI tests import from shared                       | Shared test harness                                      |
| `cli/__tests__/helpers/fixtures.ts`          | Keep in CLI tests                                                 | Keep in CLI tests                                  | CLI-specific test utilities (config file creation, etc.) |

## Phase 3: Convert CLI to Use Shared Code

Replace the CLI's direct MCP SDK usage with `InspectorClient` from `shared/mcp/`, consolidating client logic and leveraging the shared codebase.

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
   - Remove `createTransportOptions()` function
   - Replace `createTransport(transportOptions)` with `createTransportFromConfig(mcpServerConfig)`
   - Convert CLI args to `MCPServerConfig` using `argsToMcpServerConfig()`

2. **Replace connection management:**
   - Replace `new Client()` + `connect(client, transport)` with `new InspectorClient(config)` + `inspectorClient.connect()`
   - Replace `disconnect(transport)` with `inspectorClient.disconnect()`

3. **Update client utilities:**
   - Keep CLI-specific utility functions (`listTools`, `callTool`, etc.) but update them to accept `InspectorClient` instead of `Client`
   - Use `inspectorClient.getClient()` to access SDK methods
   - This preserves the CLI's API while using shared code internally

4. **Update main CLI flow:**
   - In `callMethod()`, replace transport/client setup with `InspectorClient`
   - Update all method calls to use utilities that work with `InspectorClient`

### 3.3 Migration Steps

1. **Update imports in `cli/src/index.ts`:**
   - Import `InspectorClient` from `../../shared/mcp/index.js`
   - Import `argsToMcpServerConfig` from `../../shared/mcp/index.js`
   - Import `createTransportFromConfig` from `../../shared/mcp/index.js`
   - Import `MCPServerConfig` type from `../../shared/mcp/index.js`

2. **Replace transport creation:**
   - Remove `createTransportOptions()` function
   - Remove `createTransport()` import from `./transport.js`
   - Update `callMethod()` to use `argsToMcpServerConfig()` to convert CLI args
   - Use `createTransportFromConfig()` instead of `createTransport()`

3. **Replace Client with InspectorClient:**
   - Replace `new Client(clientIdentity)` with `new InspectorClient(mcpServerConfig)`
   - Replace `connect(client, transport)` with `inspectorClient.connect()`
   - Replace `disconnect(transport)` with `inspectorClient.disconnect()`

4. **Update client utilities:**
   - Update `cli/src/client/tools.ts` to accept `InspectorClient` instead of `Client`
   - Update `cli/src/client/resources.ts` to accept `InspectorClient` instead of `Client`
   - Update `cli/src/client/prompts.ts` to accept `InspectorClient` instead of `Client`
   - Update `cli/src/client/connection.ts` or remove it (use `InspectorClient` methods directly)
   - All utilities should use `inspectorClient.getClient()` to access SDK methods

5. **Update CLI argument conversion:**
   - Map CLI's `Args` type to `argsToMcpServerConfig()` parameters
   - Handle transport type mapping: CLI uses `"http"` for streamable-http, map to `"streamable-http"` for the function
   - Ensure all CLI argument combinations are correctly converted

6. **Update tests:**
   - Update CLI test imports to use `../../shared/test/` (already done in Phase 2)
   - Update tests to use `InspectorClient` instead of direct `Client`
   - Verify all test scenarios still pass

7. **Deprecate old files:**
   - Mark `cli/src/transport.ts` as deprecated (keep for now, add deprecation comment)
   - Mark `cli/src/client/connection.ts` as deprecated (keep for now, add deprecation comment)
   - These can be removed in a future cleanup after confirming everything works

8. **Test thoroughly:**
   - Test all CLI methods (tools/list, tools/call, resources/list, resources/read, prompts/list, prompts/get, logging/setLevel)
   - Test all transport types (stdio, SSE, streamable-http)
   - Verify CLI output format is preserved (JSON output should be identical)
   - Run all CLI tests
   - Test with real MCP servers (not just test harness)

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
const config = argsToMcpServerConfig({
  command: args.target[0],
  args: args.target.slice(1),
  transport: args.transport === "http" ? "streamable-http" : args.transport,
  serverUrl: args.target[0]?.startsWith("http") ? args.target[0] : undefined,
  headers: args.headers,
});
const inspectorClient = new InspectorClient(config);
await inspectorClient.connect();
const result = await listTools(inspectorClient, args.metadata);
await inspectorClient.disconnect();
```

## Package.json Configuration

### Root package.json

```json
{
  "workspaces": ["client", "server", "cli", "tui"],
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
    "build": "npm run build-server && npm run build-client && npm run build-cli && npm run build-tui",
    "build-tui": "cd tui && npm run build",
    "update-version": "node scripts/update-version.js",
    "check-version": "node scripts/check-version-consistency.js"
  }
}
```

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

**Note**: TUI will have its own copy of React initially (different React versions for Ink vs web React). After v2 web UX lands and more code sharing begins, we may consider integrating React dependencies.

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
- [x] Update TUI imports to use `../../shared/mcp/` and `../../shared/react/`
- [x] Update CLI test imports to use `../../shared/test/`
- [x] Test TUI functionality (verify it still works with shared code)
- [x] Test CLI tests (verify test fixtures work from new location)
- [x] Update documentation

### Phase 3: Convert CLI to Use Shared Code

- [ ] Update CLI imports to use `InspectorClient`, `argsToMcpServerConfig`, `createTransportFromConfig` from `../../shared/mcp/`
- [ ] Replace `createTransportOptions()` with `argsToMcpServerConfig()` in `cli/src/index.ts`
- [ ] Replace `createTransport()` with `createTransportFromConfig()`
- [ ] Replace `new Client()` + `connect()` with `new InspectorClient()` + `connect()`
- [ ] Replace `disconnect(transport)` with `inspectorClient.disconnect()`
- [ ] Update `cli/src/client/tools.ts` to accept `InspectorClient` instead of `Client`
- [ ] Update `cli/src/client/resources.ts` to accept `InspectorClient` instead of `Client`
- [ ] Update `cli/src/client/prompts.ts` to accept `InspectorClient` instead of `Client`
- [ ] Update `cli/src/client/connection.ts` or remove it (use `InspectorClient` methods)
- [ ] Handle transport type mapping (`"http"` → `"streamable-http"`)
- [ ] Mark `cli/src/transport.ts` as deprecated
- [ ] Mark `cli/src/client/connection.ts` as deprecated
- [ ] Test all CLI methods with all transport types
- [ ] Verify CLI output format is preserved (identical JSON)
- [ ] Run all CLI tests
- [ ] Update documentation
