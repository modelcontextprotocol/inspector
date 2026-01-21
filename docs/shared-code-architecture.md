# Shared Code Architecture for MCP Inspector

## Overview

This document describes a shared code architecture that enables code reuse across the MCP Inspector's three user interfaces: the **CLI**, **TUI** (Terminal User Interface), and **web client** (likely targeting v2). The shared codebase approach prevents the feature drift and maintenance burden that can occur when each app has a separate implementation.

### Motivation

Previously, the CLI and web client had no shared code, leading to:

- **Feature drift**: Implementations diverged over time
- **Maintenance burden**: Bug fixes and features had to be implemented twice
- **Inconsistency**: Different behavior across interfaces
- **Duplication**: Similar logic implemented separately in each interface

Adding the TUI (as-is) with yet another separate implementation seemed problematic given the above.

The shared code architecture addresses these issues by providing a single source of truth for MCP client operations that all three interfaces can use.

## Current Architecture

### Architecture Diagram

![Shared Code Architecture](shared-code-architecture.svg)

### Project Structure

```
inspector/
├── cli/              # CLI workspace (uses shared code)
├── tui/              # TUI workspace (uses shared code)
├── client/           # Web client workspace (to be migrated)
├── server/           # Proxy server workspace
├── shared/           # Shared code workspace package
│   ├── mcp/          # MCP client/server interaction
│   ├── react/        # Shared React code
│   ├── json/         # JSON utilities
│   └── test/         # Test fixtures and harness servers
└── package.json      # Root workspace config
```

### Shared Package (`@modelcontextprotocol/inspector-shared`)

The `shared/` directory is a **workspace package** that:

- **Private** (`"private": true`) - internal-only, not published
- **Built separately** - compiles to `shared/build/` with TypeScript declarations
- **Referenced via package name** - workspaces import using `@modelcontextprotocol/inspector-shared/*`
- **Uses TypeScript Project References** - CLI and TUI reference shared for build ordering and type resolution
- **React peer dependency** - declares React 19.2.3 as peer dependency (consumers provide React)

**Build Order**: Shared must be built before CLI and TUI (enforced via TypeScript Project References and CI workflows).

## InspectorClient: The Core Shared Component

### Overview

`InspectorClient` (`shared/mcp/inspectorClient.ts`) is a comprehensive wrapper around the MCP SDK `Client` that manages the creation and lifecycle of the MCP client and transport. It provides:

- **Unified Client Interface**: Single class handles all client operations
- **Client and Transport Lifecycle**: Manages creation, connection, and cleanup of MCP SDK `Client` and `Transport` instances
- **Message Tracking**: Automatically tracks all JSON-RPC messages (requests, responses, notifications)
- **Stderr Logging**: Captures and stores stderr output from stdio transports
- **Event-Driven Updates**: Uses `EventTarget` for reactive UI updates (cross-platform: works in browser and Node.js)
- **Server Data Management**: Automatically fetches and caches tools, resources, prompts, capabilities, server info, and instructions
- **State Management**: Manages connection status, message history, and server state
- **Transport Abstraction**: Works with all `Transport` types (stdio, SSE, streamable-http)
- **High-Level Methods**: Provides convenient wrappers for tools, resources, prompts, and logging

![InspectorClient Details](inspector-client-details.svg)

### Key Features

**Connection Management:**

- `connect()` - Establishes connection and optionally fetches server data
- `disconnect()` - Closes connection and clears server state
- Connection status tracking (`disconnected`, `connecting`, `connected`, `error`)

**Message Tracking:**

- Tracks all JSON-RPC messages with timestamps, direction, and duration
- `MessageEntry[]` format with full request/response/notification history
- Event-driven updates (`message`, `messagesChange` events)

**Server Data Management:**

- Auto-fetches tools, resources, prompts (configurable via `autoFetchServerContents`)
- Caches capabilities, serverInfo, instructions
- Event-driven updates for all server data (`toolsChange`, `resourcesChange`, `promptsChange`, etc.)

**MCP Method Wrappers:**

- `listTools(metadata?)` - List available tools
- `callTool(name, args, generalMetadata?, toolSpecificMetadata?)` - Call a tool with automatic parameter conversion
- `listResources(metadata?)` - List available resources
- `readResource(uri, metadata?)` - Read a resource by URI
- `listResourceTemplates(metadata?)` - List resource templates
- `listPrompts(metadata?)` - List available prompts
- `getPrompt(name, args?, metadata?)` - Get a prompt with automatic argument stringification
- `setLoggingLevel(level)` - Set logging level with capability checks

**Configurable Options:**

- `autoFetchServerContents` - Controls whether to auto-fetch tools/resources/prompts on connect (default: `true` for TUI, `false` for CLI)
- `initialLoggingLevel` - Sets the logging level on connect if server supports logging (optional)
- `maxMessages` - Maximum number of messages to store (default: 1000)
- `maxStderrLogEvents` - Maximum number of stderr log entries to store (default: 1000)
- `pipeStderr` - Whether to pipe stderr for stdio transports (default: `true` for TUI, `false` for CLI)

### Event System

`InspectorClient` extends `EventTarget` for cross-platform compatibility:

**Events with payloads:**

- `statusChange` → `ConnectionStatus`
- `toolsChange` → `Tool[]`
- `resourcesChange` → `ResourceReference[]`
- `promptsChange` → `PromptReference[]`
- `capabilitiesChange` → `ServerCapabilities | undefined`
- `serverInfoChange` → `Implementation | undefined`
- `instructionsChange` → `string | undefined`
- `message` → `MessageEntry`
- `stderrLog` → `StderrLogEntry`
- `error` → `Error`

**Events without payloads (signals):**

- `connect` - Connection established
- `disconnect` - Connection closed
- `messagesChange` - Message list changed (fetch via `getMessages()`)
- `stderrLogsChange` - Stderr logs changed (fetch via `getStderrLogs()`)

### Shared Module Structure

**`shared/mcp/`** - MCP client/server interaction:

- `inspectorClient.ts` - Main `InspectorClient` class
- `transport.ts` - Transport creation from `MCPServerConfig`
- `config.ts` - Config file loading (`loadMcpServersConfig`)
- `types.ts` - Shared types (`MCPServerConfig`, `MessageEntry`, `ConnectionStatus`, etc.)
- `messageTrackingTransport.ts` - Transport wrapper for message tracking
- `index.ts` - Public API exports

**`shared/json/`** - JSON utilities:

- `jsonUtils.ts` - JSON value types and conversion utilities (`JsonValue`, `convertParameterValue`, `convertToolParameters`, `convertPromptArguments`)

**`shared/react/`** - Shared React code:

- `useInspectorClient.ts` - React hook that subscribes to EventTarget events and provides reactive state (works in both TUI and web client)

**`shared/test/`** - Test fixtures and harness servers:

- `test-server-fixtures.ts` - Shared server configs and definitions
- `test-server-http.ts` - HTTP/SSE test server
- `test-server-stdio.ts` - Stdio test server

## Integration History

### Phase 1: TUI Integration (Complete)

The TUI was integrated from the [`mcp-inspect`](https://github.com/TeamSparkAI/mcp-inspect) project as a standalone workspace. During integration, the TUI developed `InspectorClient` as a comprehensive client wrapper, providing a good foundation for code sharing.

**Key decisions:**

- TUI developed `InspectorClient` to wrap MCP SDK `Client`
- Organized MCP code into `tui/src/mcp/` module
- Created React hook `useInspectorClient` for reactive state management

### Phase 2: Extract to Shared Package (Complete)

All MCP-related code was moved from TUI to `shared/` to enable reuse:

**Moved to `shared/mcp/`:**

- `inspectorClient.ts` - Main client wrapper
- `transport.ts` - Transport creation
- `config.ts` - Config loading
- `types.ts` - Shared types
- `messageTrackingTransport.ts` - Message tracking wrapper

**Moved to `shared/react/`:**

- `useInspectorClient.ts` - React hook

**Moved to `shared/test/`:**

- Test fixtures and harness servers (from CLI tests)

**Configuration:**

- Created `shared/package.json` as workspace package
- Configured TypeScript Project References
- Set React 19.2.3 as peer dependency
- Aligned all workspaces to React 19.2.3

### Phase 3: CLI Migration (Complete)

The CLI was migrated to use `InspectorClient` from the shared package:

**Changes:**

- Replaced direct SDK `Client` usage with `InspectorClient`
- Moved CLI helper functions (`tools.ts`, `resources.ts`, `prompts.ts`) into `InspectorClient` as methods
- Extracted JSON utilities to `shared/json/jsonUtils.ts`
- Deleted `cli/src/client/` directory
- Implemented local `argsToMcpServerConfig()` function in CLI to convert CLI arguments to `MCPServerConfig`
- CLI now uses `inspectorClient.listTools()`, `inspectorClient.callTool()`, etc. directly

**Configuration:**

- CLI sets `autoFetchServerContents: false` (calls methods directly)
- CLI sets `initialLoggingLevel: "debug"` for consistent logging

## Current Usage

### CLI Usage

The CLI uses `InspectorClient` for all MCP operations:

```typescript
// Convert CLI args to MCPServerConfig
const config = argsToMcpServerConfig(args);

// Create InspectorClient
const inspectorClient = new InspectorClient(config, {
  clientIdentity,
  autoFetchServerContents: false, // CLI calls methods directly
  initialLoggingLevel: "debug",
});

// Connect and use
await inspectorClient.connect();
const result = await inspectorClient.listTools(args.metadata);
await inspectorClient.disconnect();
```

### TUI Usage

The TUI uses `InspectorClient` via the `useInspectorClient` React hook:

```typescript
// In TUI component
const { status, messages, tools, resources, prompts, connect, disconnect } =
  useInspectorClient(inspectorClient);

// InspectorClient is created from config and managed by App.tsx
// The hook automatically subscribes to events and provides reactive state
```

**TUI Configuration:**

- Sets `autoFetchServerContents: true` (default) - automatically fetches server data on connect
- Uses `useInspectorClient` hook for reactive UI updates
- `ToolTestModal` uses `inspectorClient.callTool()` directly

**TUI Status:**

- **Experimental**: The TUI functionality may be considered "experimental" until sufficient testing and review of features and implementation. This allows for iteration and refinement based on user feedback before committing to a stable feature set.
- **Feature Gaps**: Current feature gaps with the web UX include lack of support for OAuth, completions, elicitation, and sampling. These will be addressed in Phase 4 by extending `InspectorClient` with the required functionality. Note that some features, like MCP-UI, may not be feasible in a terminal-based interface. There is a plan for implementing OAuth from the TUI.

**Entry Point:**
The TUI is invoked via the main `mcp-inspector` command with a `--tui` flag:

- `mcp-inspector --tui ...` → TUI mode
- `mcp-inspector --cli ...` → CLI mode
- `mcp-inspector ...` → Web client mode (default)

This provides a single entry point with consistent argument parsing across all three UX modes.

## Phase 4: TUI Feature Gap Implementation (Planned)

### Overview

The next phase will address TUI feature gaps (OAuth, completions, elicitation, and sampling) by extending `InspectorClient` with the required functionality. This approach serves dual purposes:

1. **TUI Feature Parity**: Brings TUI closer to feature parity with the web client
2. **InspectorClient Preparation**: Prepares `InspectorClient` for full web client integration

When complete, `InspectorClient` will be very close to ready for full support of the v2 web client (which is currently under development).

### Features to Implement

**1. OAuth Support**

- Add OAuth authentication flow support to `InspectorClient`
- TUI-specific: Browser-based OAuth flow with localhost callback server
- Web client benefit: OAuth support will be ready for v2 web client integration

**2. Completion Support**

- Add completion capability detection and management
- Add `handleCompletion()` method or access pattern for `completion/complete` requests
- TUI benefit: Enables autocomplete in TUI forms
- Web client benefit: Completion support ready for v2 web client

**3. Elicitation Support**

- Add request handler support for elicitation requests
- Add convenience methods: `setElicitationHandler()`, `setPendingRequestHandler()`, `setRootsHandler()`
- TUI benefit: Enables elicitation workflows in TUI
- Web client benefit: Request handler support ready for v2 web client

**4. Sampling Support**

- Add sampling capability detection and management
- Add methods or access patterns for sampling requests
- TUI benefit: Enables sampling workflows in TUI
- Web client benefit: Sampling support ready for v2 web client

### Implementation Strategy

As each TUI feature gap is addressed:

1. Extend `InspectorClient` with the required functionality
2. Implement the feature in TUI using the new `InspectorClient` capabilities
3. Test the feature in TUI context
4. Document the new `InspectorClient` API

This incremental approach ensures:

- Features are validated in real usage (TUI) before web client integration
- `InspectorClient` API is refined based on actual needs
- Both TUI and v2 web client benefit from shared implementation

### Relationship to Web Client Integration

The features added in Phase 4 directly address the "Features Needed in InspectorClient for Web Client" listed in the Web Client Integration Plan. By implementing these for TUI first, we:

- Validate the API design with real usage
- Ensure the implementation works in a React context (TUI uses React/Ink)
- Build toward full v2 web client support incrementally

Once Phase 4 is complete, `InspectorClient` will have most of the functionality needed for v2 web client integration, with primarily adapter/wrapper work remaining.

## Web Client Integration Plan

### Current Web Client Architecture

The web client currently uses `useConnection` hook (`client/src/lib/hooks/useConnection.ts`) that handles:

1. **Connection Management**
   - Connection status state (`disconnected`, `connecting`, `connected`, `error`, `error-connecting-to-proxy`)
   - Direct vs. proxy connection modes
   - Proxy health checking

2. **Transport Creation**
   - Creates SSE or StreamableHTTP transports directly
   - Handles proxy mode (connects to proxy server endpoints)
   - Handles direct mode (connects directly to MCP server)
   - Manages transport options (headers, fetch wrappers, reconnection options)

3. **OAuth Authentication**
   - Browser-based OAuth flow (authorization code flow)
   - OAuth token management via `InspectorOAuthClientProvider`
   - Session storage for OAuth tokens
   - OAuth callback handling
   - Token refresh

4. **Custom Headers**
   - Custom header management (migration from legacy auth)
   - Header validation
   - OAuth token injection into headers
   - Special header processing (`x-custom-auth-headers`)

5. **Request/Response Tracking**
   - Request history (`{ request: string, response?: string }[]`)
   - History management (`pushHistory`, `clearRequestHistory`)
   - Different format than InspectorClient's `MessageEntry[]`

6. **Notification Handling**
   - Notification handlers via callbacks (`onNotification`, `onStdErrNotification`)
   - Multiple notification schemas (Cancelled, Logging, ResourceUpdated, etc.)
   - Fallback notification handler

7. **Request Handlers**
   - Elicitation request handling (`onElicitationRequest`)
   - Pending request handling (`onPendingRequest`)
   - Roots request handling (`getRoots`)

8. **Completion Support**
   - Completion capability detection
   - Completion state management

9. **Progress Notifications**
   - Progress notification handling
   - Timeout reset on progress

10. **Session Management**
    - Session ID tracking (`mcpSessionId`)
    - Protocol version tracking (`mcpProtocolVersion`)
    - Response header capture

11. **Server Information**
    - Server capabilities
    - Server implementation info
    - Protocol version

12. **Error Handling**
    - Proxy auth errors
    - OAuth errors
    - Connection errors
    - Retry logic

The main `App.tsx` component manages extensive state including:

- Resources, resource templates, resource content
- Prompts, prompt content
- Tools, tool results
- Errors per tab
- Connection configuration (command, args, sseUrl, transportType, etc.)
- OAuth configuration
- Custom headers
- Notifications
- Roots
- Environment variables
- Log level
- Active tab
- Pending requests

### Features Needed in InspectorClient for Web Client

To fully support the web client, `InspectorClient` needs to add support for:

1. **Custom Headers** - Support for OAuth tokens and custom authentication headers in transport configuration
2. **Request Handlers** - Support for setting elicitation, pending request, and roots handlers
3. **Completion Support** - Methods or access patterns for `completion/complete` requests
4. **Progress Notifications** - Callback support for progress notifications and timeout reset
5. **Session Management** - Access to session ID and protocol version from transport

### Integration Challenges

**1. OAuth Authentication**

- Web client uses browser-based OAuth flow (authorization code with PKCE)
- Requires browser redirects and callback handling
- **Solution**: Keep OAuth handling in web client, inject tokens via custom headers in `MCPServerConfig`

**2. Proxy Mode**

- Web client connects through proxy server for stdio transports
- **Solution**: Handle proxy URL construction in web client, pass final URL to `InspectorClient`

**3. Custom Headers**

- Web client manages custom headers (OAuth tokens, custom auth headers)
- **Solution**: Extend `MCPServerConfig` to support `headers` in `SseServerConfig` and `StreamableHttpServerConfig`

**4. Request History Format**

- Web client uses `{ request: string, response?: string }[]`
- `InspectorClient` uses `MessageEntry[]` (more detailed)
- **Solution**: Migrate web client to use `MessageEntry[]` format

**5. Completion Support**

- Web client detects and manages completion capability
- **Solution**: Use `inspectorClient.getCapabilities()?.completions` to detect support, access SDK client via `getClient()` for completion requests

**6. Elicitation and Request Handlers**

- Web client sets request handlers for elicitation, pending requests, roots
- **Solution**: Use `inspectorClient.getClient()` to set request handlers (minimal change)

**7. Progress Notifications**

- Web client handles progress notifications and timeout reset
- **Solution**: Handle progress via existing notification system (`InspectorClient` already tracks notifications)

**8. Session Management**

- Web client tracks session ID and protocol version
- **Solution**: Access transport via `inspectorClient.getClient()` to get session info

### Integration Strategy

**Phase 1: Extend InspectorClient for Web Client Needs**

1. **Add Custom Headers Support**
   - Add `headers?: Record<string, string>` to `SseServerConfig` and `StreamableHttpServerConfig` in `MCPServerConfig`
   - Pass headers to transport creation in `shared/mcp/transport.ts`

2. **Add Request Handler Support**
   - Add convenience methods: `setRequestHandler()`, `setElicitationHandler()`, `setRootsHandler()`
   - Or document that `getClient()` can be used to set request handlers directly
   - Support for elicitation requests, pending requests, and roots requests

3. **Add Completion Support**
   - Add `handleCompletion()` method or document access via `getClient()`
   - Completion capability is already available via `getCapabilities()?.completions`
   - Web client can use `getClient()` to call `completion/complete` directly

4. **Add Progress Notification Support**
   - Add `onProgress?: (progress: Progress) => void` to `InspectorClientOptions`
   - Forward progress notifications to callback
   - Support timeout reset on progress notifications

5. **Add Session Management**
   - Expose session ID and protocol version via getter methods
   - Or provide access to transport for session information

**Phase 2: Create Web-Specific Adapter**

Create adapter function that:

- Converts web client config to `MCPServerConfig`
- Handles proxy URL construction
- Manages OAuth token injection into headers
- Handles direct vs. proxy mode

**Phase 3: Hybrid Integration (Recommended)**

**Short Term:**

- Keep `useConnection` for OAuth, proxy, and web-specific features
- Use `InspectorClient` for core MCP operations (tools, resources, prompts) via `getClient()`
- Gradually migrate state management

**Medium Term:**

- Use `useInspectorClient` hook for state management
- Keep OAuth/proxy handling in web-specific wrapper
- Migrate request history to `MessageEntry[]` format

**Long Term:**

- Replace `useConnection` with `useInspectorClient` + web-specific wrapper
- Remove duplicate transport creation
- Remove duplicate server data fetching

### Benefits of Web Client Integration

1. **Code Reuse**: Share MCP client logic across all three interfaces, including the shared React hook (`useInspectorClient`) between TUI and web client
2. **Consistency**: Same behavior across CLI, TUI, and web client
3. **Maintainability**: Single source of truth for MCP operations
4. **Features**: Web client gets message tracking, stderr logging, event-driven updates
5. **Type Safety**: Shared types ensure consistency
6. **Testing**: Shared code is tested once, works everywhere

### Implementation Steps

1. **Extend `MCPServerConfig`** to support custom headers
2. **Create adapter function** to convert web client config to `MCPServerConfig`
3. **Use `InspectorClient`** for tools/resources/prompts operations (via `getClient()` initially)
4. **Gradually migrate** state management to `useInspectorClient`
5. **Eventually replace** `useConnection` with `useInspectorClient` + web-specific wrapper

## Technical Details

### TypeScript Project References

The shared package uses TypeScript Project References for build orchestration:

**`shared/tsconfig.json`:**

```json
{
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "declarationMap": true
  }
}
```

**`cli/tsconfig.json` and `tui/tsconfig.json`:**

```json
{
  "references": [{ "path": "../shared" }]
}
```

This ensures:

- Shared builds first (required for type resolution)
- Type checking across workspace boundaries
- Correct build ordering in CI

### Build Process

**Root `package.json` build script:**

```json
{
  "scripts": {
    "build": "npm run build-shared && npm run build-server && npm run build-client && npm run build-cli && npm run build-tui",
    "build-shared": "cd shared && npm run build"
  }
}
```

**CI Workflow:**

- Build shared package first
- Then build dependent workspaces (CLI, TUI)
- TypeScript Project References enforce this ordering

### Module Resolution

Workspaces import using package name:

```typescript
import { InspectorClient } from "@modelcontextprotocol/inspector-shared/mcp/inspectorClient.js";
import { useInspectorClient } from "@modelcontextprotocol/inspector-shared/react/useInspectorClient.js";
```

npm workspaces automatically resolve package names to the workspace package.

## Summary

The shared code architecture provides:

- **Single source of truth** for MCP client operations via `InspectorClient`
- **Code reuse** across CLI, TUI, and (planned) web client
- **Consistent behavior** across all interfaces
- **Reduced maintenance burden** - fix once, works everywhere
- **Type safety** through shared types
- **Event-driven updates** via EventTarget (cross-platform compatible)

**Current Status:**

- ✅ Phase 1: TUI integrated and using shared code
- ✅ Phase 2: Shared package created and configured
- ✅ Phase 3: CLI migrated to use shared code
- 🔄 Phase 4: TUI feature gap implementation (planned)
- 🔄 Phase 5: v2 web client integration (planned)

**Next Steps:**

1. **Phase 4**: Implement TUI feature gaps (OAuth, completions, elicitation, sampling) by extending `InspectorClient`
2. **Phase 5**: Integrate `InspectorClient` with v2 web client (once Phase 4 is complete and v2 web client is ready)
