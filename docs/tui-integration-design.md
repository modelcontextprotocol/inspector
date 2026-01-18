# TUI Integration Design

## Overview

This document outlines the design for integrating the Terminal User Interface (TUI) from the [`mcp-inspect`](https://github.com/TeamSparkAI/mcp-inspect) project into the MCP Inspector monorepo.

### Current TUI Project

The `mcp-inspect` project is a standalone Terminal User Interface (TUI) inspector for Model Context Protocol (MCP) servers. It implements similar functionality to the current MCP Inspector web UX, but as a TUI built with React and Ink. The project is currently maintained separately at https://github.com/TeamSparkAI/mcp-inspect.

### Integration Goal

Our goal is to integrate the TUI into the MCP Inspector project, making it a first-class UX option alongside the existing web client and CLI. The integration will be done incrementally across three development phases:

1. **Phase 1**: Integrate TUI as a standalone runnable workspace (no code sharing)
2. **Phase 2**: Share code with CLI via direct imports (transport, config, client utilities)
3. **Phase 3**: Extract shared code to a common directory for better organization

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
│   │   ├── index.ts  # CLI implementation
│   │   ├── transport.ts  # Phase 2: TUI imports, Phase 3: moved to shared/
│   │   └── client/   # MCP client utilities (Phase 2: TUI imports, Phase 3: moved to shared/)
│   ├── __tests__/
│   │   └── helpers/  # Phase 2: keep here, Phase 3: moved to shared/test/
│   └── package.json
├── tui/              # NEW: TUI workspace
│   ├── src/
│   │   ├── App.tsx   # Main TUI application
│   │   ├── components/  # TUI React components
│   │   ├── hooks/       # TUI-specific hooks
│   │   ├── types/       # TUI-specific types
│   │   └── utils/       # Phase 1: self-contained, Phase 2: imports from CLI, Phase 3: imports from shared/
│   ├── tui.tsx       # TUI entry point
│   └── package.json
├── shared/           # NEW: Shared code directory (Phase 3)
│   ├── transport.ts
│   ├── config.ts
│   ├── client/       # MCP client utilities
│   │   ├── index.ts
│   │   ├── connection.ts
│   │   ├── tools.ts
│   │   ├── resources.ts
│   │   ├── prompts.ts
│   │   └── types.ts
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

## Phase 2: Code Sharing via Direct Imports

Once Phase 1 is complete and TUI is working, update TUI to use code from the CLI workspace via direct imports.

### 2.1 Identify Shared Code

The following utilities from TUI should be replaced with CLI equivalents:

1. **Transport creation** (`tui/src/utils/transport.ts`)
   - Replace with direct import from `cli/src/transport.ts`
   - Use `createTransport()` from CLI

2. **Config file loading** (`tui/src/utils/config.ts`)
   - Extract `loadConfigFile()` from `cli/src/cli.ts` to `cli/src/utils/config.ts` if not already there
   - Replace TUI config loading with CLI version
   - **Note**: TUI will use the same config file format and location as CLI/web client for consistency

3. **Client utilities** (`tui/src/utils/client.ts`)
   - Replace with direct imports from `cli/src/client/`
   - Use existing MCP client wrapper functions:
     - `connect()`, `disconnect()`, `setLoggingLevel()` from `cli/src/client/connection.ts`
     - `listTools()`, `callTool()` from `cli/src/client/tools.ts`
     - `listResources()`, `readResource()`, `listResourceTemplates()` from `cli/src/client/resources.ts`
     - `listPrompts()`, `getPrompt()` from `cli/src/client/prompts.ts`
     - `McpResponse` type from `cli/src/client/types.ts`

4. **Types** (consolidate)
   - Align TUI types with CLI types
   - Use CLI types where possible

### 2.2 Direct Import Strategy

Use direct relative imports from TUI to CLI:

```typescript
// tui/src/utils/transport.ts (or wherever needed)
import { createTransport } from "../../cli/src/transport.js";
import { loadConfigFile } from "../../cli/src/utils/config.js";
import { listTools, callTool } from "../../cli/src/client/tools.js";
```

**No TypeScript path mappings needed** - direct relative imports are simpler and clearer.

**Path Structure**: From `tui/src/` to `cli/src/`, the relative path is `../../cli/src/`. This works because both `tui/` and `cli/` are sibling directories at the workspace root level.

### 2.3 Migration Steps

1. **Extract config utility from CLI** (if needed)
   - Move `loadConfigFile()` from `cli/src/cli.ts` to `cli/src/utils/config.ts`
   - Ensure it's exported and reusable

2. **Update TUI imports**
   - Replace TUI transport code with import from CLI
   - Replace TUI config code with import from CLI
   - Replace TUI client code with imports from CLI:
     - Replace direct SDK calls (`client.listTools()`, `client.callTool()`, etc.) with wrapper functions
     - Use `connect()`, `disconnect()`, `setLoggingLevel()` from `cli/src/client/connection.ts`
     - Use `listTools()`, `callTool()` from `cli/src/client/tools.ts`
     - Use `listResources()`, `readResource()`, `listResourceTemplates()` from `cli/src/client/resources.ts`
     - Use `listPrompts()`, `getPrompt()` from `cli/src/client/prompts.ts`
   - Delete duplicate utilities from TUI

3. **Test thoroughly**
   - Ensure all functionality still works
   - Test with test harness servers
   - Verify no regressions

## Phase 3: Extract Shared Code to Shared Directory

After Phase 2 is complete and working, extract shared code to a `shared/` directory for better organization. This includes both runtime utilities and test fixtures.

### 3.1 Shared Directory Structure

```
shared/              # Not a workspace, just a directory
├── transport.ts
├── config.ts
├── client/          # MCP client utilities
│   ├── index.ts     # Re-exports
│   ├── connection.ts
│   ├── tools.ts
│   ├── resources.ts
│   ├── prompts.ts
│   └── types.ts
└── test/            # Test fixtures and harness servers
    ├── test-server-fixtures.ts  # Shared server configs and definitions
    ├── test-server-http.ts
    └── test-server-stdio.ts
```

### 3.2 Code to Move to Shared Directory

**Runtime utilities:**

- `cli/src/transport.ts` → `shared/transport.ts`
- `cli/src/utils/config.ts` (extracted from `cli/src/cli.ts`) → `shared/config.ts`
- `cli/src/client/connection.ts` → `shared/client/connection.ts`
- `cli/src/client/tools.ts` → `shared/client/tools.ts`
- `cli/src/client/resources.ts` → `shared/client/resources.ts`
- `cli/src/client/prompts.ts` → `shared/client/prompts.ts`
- `cli/src/client/types.ts` → `shared/client/types.ts`
- `cli/src/client/index.ts` → `shared/client/index.ts` (re-exports)

**Test fixtures:**

- `cli/__tests__/helpers/test-fixtures.ts` → `shared/test/test-server-fixtures.ts` (renamed)
- `cli/__tests__/helpers/test-server-http.ts` → `shared/test/test-server-http.ts`
- `cli/__tests__/helpers/test-server-stdio.ts` → `shared/test/test-server-stdio.ts`

**Note**: `cli/__tests__/helpers/fixtures.ts` (CLI-specific test utilities like config file creation) stays in CLI tests, not shared.

### 3.3 Migration to Shared Directory

1. **Create shared directory structure**
   - Create `shared/` directory at root
   - Create `shared/test/` subdirectory

2. **Move runtime utilities**
   - Move transport code from `cli/src/transport.ts` to `shared/transport.ts`
   - Move config code from `cli/src/utils/config.ts` to `shared/config.ts`
   - Move client utilities from `cli/src/client/` to `shared/client/`:
     - `connection.ts` → `shared/client/connection.ts`
     - `tools.ts` → `shared/client/tools.ts`
     - `resources.ts` → `shared/client/resources.ts`
     - `prompts.ts` → `shared/client/prompts.ts`
     - `types.ts` → `shared/client/types.ts`
     - `index.ts` → `shared/client/index.ts` (re-exports)

3. **Move test fixtures**
   - Move `test-fixtures.ts` from `cli/__tests__/helpers/` to `shared/test/test-server-fixtures.ts` (renamed)
   - Move test server implementations to `shared/test/`
   - Update imports in CLI tests to use `shared/test/`
   - Update imports in TUI tests (if any) to use `shared/test/`
   - **Note**: `fixtures.ts` (CLI-specific test utilities) stays in CLI tests

4. **Update imports**
   - Update CLI to import from `../shared/`
   - Update TUI to import from `../shared/`
   - Update CLI tests to import from `../../shared/test/`
   - Update TUI tests to import from `../../shared/test/`

5. **Test thoroughly**
   - Ensure CLI still works
   - Ensure TUI still works
   - Ensure all tests pass (CLI and TUI)
   - Verify test harness servers work correctly

### 3.4 Considerations

- **Not a package**: This is just a directory for internal helpers, not a published package
- **Direct imports**: Both CLI and TUI import directly from `shared/` directory
- **Test fixtures shared**: Test harness servers and fixtures are available to both CLI and TUI tests
- **Browser vs Node**: Some utilities may need different implementations for web client (evaluate later)

## File-by-File Migration Guide

### From mcp-inspect to inspector/tui

| mcp-inspect                 | inspector/tui                   | Phase | Notes                                               |
| --------------------------- | ------------------------------- | ----- | --------------------------------------------------- |
| `tui.tsx`                   | `tui/tui.tsx`                   | 1     | Entry point, remove CLI mode handling               |
| `src/App.tsx`               | `tui/src/App.tsx`               | 1     | Main TUI application                                |
| `src/components/*`          | `tui/src/components/*`          | 1     | All TUI components                                  |
| `src/hooks/*`               | `tui/src/hooks/*`               | 1     | TUI-specific hooks                                  |
| `src/types/*`               | `tui/src/types/*`               | 1     | TUI-specific types                                  |
| `src/cli.ts`                | **DELETE**                      | 1     | CLI functionality exists in `cli/src/index.ts`      |
| `src/utils/transport.ts`    | `tui/src/utils/transport.ts`    | 1     | Keep in Phase 1, replace with CLI import in Phase 2 |
| `src/utils/config.ts`       | `tui/src/utils/config.ts`       | 1     | Keep in Phase 1, replace with CLI import in Phase 2 |
| `src/utils/client.ts`       | `tui/src/utils/client.ts`       | 1     | Keep in Phase 1, replace with CLI import in Phase 2 |
| `src/utils/schemaToForm.ts` | `tui/src/utils/schemaToForm.ts` | 1     | TUI-specific (form generation), keep                |

### CLI Code to Share

| Current Location                             | Phase 2 Action                                    | Phase 3 Action                                          | Notes                                                    |
| -------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| `cli/src/transport.ts`                       | TUI imports directly                              | Move to `shared/transport.ts`                           | Already well-structured                                  |
| `cli/src/cli.ts::loadConfigFile()`           | Extract to `cli/src/utils/config.ts`, TUI imports | Move to `shared/config.ts`                              | Needs extraction                                         |
| `cli/src/client/connection.ts`               | TUI imports directly                              | Move to `shared/client/connection.ts`                   | Connection management, logging                           |
| `cli/src/client/tools.ts`                    | TUI imports directly                              | Move to `shared/client/tools.ts`                        | Tool listing and calling with metadata                   |
| `cli/src/client/resources.ts`                | TUI imports directly                              | Move to `shared/client/resources.ts`                    | Resource operations with metadata                        |
| `cli/src/client/prompts.ts`                  | TUI imports directly                              | Move to `shared/client/prompts.ts`                      | Prompt operations with metadata                          |
| `cli/src/client/types.ts`                    | TUI imports directly                              | Move to `shared/client/types.ts`                        | Shared types (McpResponse, etc.)                         |
| `cli/src/client/index.ts`                    | TUI imports directly                              | Move to `shared/client/index.ts`                        | Re-exports                                               |
| `cli/src/index.ts::parseArgs()`              | Keep CLI-specific                                 | Keep CLI-specific                                       | CLI-only argument parsing                                |
| `cli/__tests__/helpers/test-fixtures.ts`     | Keep in CLI tests                                 | Move to `shared/test/test-server-fixtures.ts` (renamed) | Shared test server configs and definitions               |
| `cli/__tests__/helpers/test-server-http.ts`  | Keep in CLI tests                                 | Move to `shared/test/test-server-http.ts`               | Shared test harness                                      |
| `cli/__tests__/helpers/test-server-stdio.ts` | Keep in CLI tests                                 | Move to `shared/test/test-server-stdio.ts`              | Shared test harness                                      |
| `cli/__tests__/helpers/fixtures.ts`          | Keep in CLI tests                                 | Keep in CLI tests                                       | CLI-specific test utilities (config file creation, etc.) |

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

- [ ] Create `tui/` workspace directory
- [ ] Set up `tui/package.json` with dependencies
- [ ] Configure `tui/tsconfig.json` (no path mappings needed)
- [ ] Copy TUI source files from mcp-inspect
- [ ] **Remove CLI functionality**: Delete `src/cli.ts` from TUI
- [ ] **Remove CLI mode**: Remove CLI mode handling from `tui.tsx` entry point
- [ ] **Keep utilities**: Keep transport, config, client utilities in TUI (self-contained)
- [ ] Add `--tui` flag to `cli/src/cli.ts`
- [ ] Implement `runTui()` function in launcher
- [ ] Update root `package.json` with tui workspace
- [ ] Add build scripts for TUI
- [ ] Update version management scripts (`update-version.js` and `check-version-consistency.js`) to include TUI
- [ ] Test TUI with test harness servers (stdio transport)
- [ ] Test TUI with test harness servers (SSE transport)
- [ ] Test TUI with test harness servers (HTTP transport)
- [ ] Test config file loading
- [ ] Test server selection
- [ ] Verify TUI works standalone without CLI dependencies
- [ ] Update documentation

### Phase 2: Code Sharing via Direct Imports

- [ ] Extract `loadConfigFile()` from `cli/src/cli.ts` to `cli/src/utils/config.ts` (if not already there)
- [ ] Update TUI to import transport from `cli/src/transport.ts`
- [ ] Update TUI to import config from `cli/src/utils/config.ts`
- [ ] Update TUI to import client utilities from `cli/src/client/`
- [ ] Delete duplicate utilities from TUI (transport, config, client)
- [ ] Test TUI with test harness servers (all transports)
- [ ] Verify all functionality still works
- [ ] Update documentation

### Phase 3: Extract Shared Code to Shared Directory

- [ ] Create `shared/` directory structure (not a workspace)
- [ ] Create `shared/test/` subdirectory
- [ ] Move transport code from CLI to `shared/transport.ts`
- [ ] Move config code from CLI to `shared/config.ts`
- [ ] Move client utilities from CLI to `shared/client/`:
  - [ ] `connection.ts` → `shared/client/connection.ts`
  - [ ] `tools.ts` → `shared/client/tools.ts`
  - [ ] `resources.ts` → `shared/client/resources.ts`
  - [ ] `prompts.ts` → `shared/client/prompts.ts`
  - [ ] `types.ts` → `shared/client/types.ts`
  - [ ] `index.ts` → `shared/client/index.ts`
- [ ] Move test fixtures from `cli/__tests__/helpers/test-fixtures.ts` to `shared/test/test-server-fixtures.ts` (renamed)
- [ ] Move test server HTTP from `cli/__tests__/helpers/test-server-http.ts` to `shared/test/test-server-http.ts`
- [ ] Move test server stdio from `cli/__tests__/helpers/test-server-stdio.ts` to `shared/test/test-server-stdio.ts`
- [ ] Update CLI to import from `../shared/`
- [ ] Update TUI to import from `../shared/`
- [ ] Update CLI tests to import from `../../shared/test/`
- [ ] Update TUI tests (if any) to import from `../../shared/test/`
- [ ] Test CLI functionality
- [ ] Test TUI functionality
- [ ] Test CLI tests (verify test harness servers work)
- [ ] Test TUI tests (if any)
- [ ] Evaluate web client needs (may need different implementations)
- [ ] Update documentation

## Notes

- The TUI from mcp-inspect is well-structured and should integrate cleanly
- All phase-specific details, code sharing strategies, and implementation notes are documented in their respective sections above
