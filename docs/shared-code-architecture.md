# Shared Code Architecture for MCP Inspector

## Overview

This document describes the **as-built** architecture for the MCP Inspector. The **CLI**, **TUI** (Terminal User Interface), and **web client** all use the **core** package and **InspectorClient**. This architecture prevents feature drift and reduces maintenance by providing a single source of truth for MCP client operations across all three interfaces.

### Environment Isolation

The architecture uses **environment isolation** to separate portable JavaScript from environment-specific code (Node.js vs. browser). `InspectorClient` is portable and accepts **injected dependencies** (seams) for environment-specific behavior:

- **CLI/TUI (Node)**: Inject Node-specific implementations (`createTransportNode`, `NodeOAuthStorage`, file-based logging)
- **Web client (Browser)**: Inject browser-specific implementations (`createRemoteTransport`, `createRemoteFetch`, `createRemoteLogger`, `BrowserOAuthStorage` or `RemoteOAuthStorage`)

`InspectorClient` remains unaware of which environment it's running in—it just uses the injected dependencies. This allows the same code to run in Node (CLI, TUI) and browser (web client). See [environment-isolation.md](environment-isolation.md) for detailed design.

### Motivation

Previously, the CLI and web client had no shared implementation, leading to:

- **Feature drift**: Implementations diverged over time
- **Maintenance burden**: Bug fixes and features had to be implemented twice
- **Inconsistency**: Different behavior across interfaces
- **Duplication**: Similar logic implemented separately in each interface

Adding the TUI (as-is) with yet another separate implementation seemed problematic given the above.

The architecture addresses these issues by providing a single source of truth for MCP client operations in core. **On this branch, CLI, TUI, and web client all use core (InspectorClient and state managers).**

## Architecture

### Architecture Diagram

![Shared Code Architecture](images/shared-code-architecture.svg)

**Key concept**: Each environment (CLI, TUI, web client) injects environment-specific dependencies into `InspectorClient`. All three use the same `InspectorClient` and optional state managers from core:

- **CLI/TUI**: Pass `environment` object with `transport: createTransportNode` (creates stdio, SSE, streamable-http transports directly in Node), `oauth.storage: NodeOAuthStorage` (file-based), `logger` (file-based pino logger)
- **Web client**: Pass `environment` object with `transport: createRemoteTransport` (creates `RemoteClientTransport` that talks to remote API server), `fetch: createRemoteFetch`, `logger: createRemoteLogger`, `oauth.storage: BrowserOAuthStorage` or `RemoteOAuthStorage` (sessionStorage or HTTP API)

`InspectorClient` uses these injected dependencies to create transports and manage OAuth, remaining portable across all environments.

### Protocol and state managers

`InspectorClient` is the **protocol layer**: it owns the connection, exposes list RPCs (stateless), and dispatches events. **List and log state** (tools, resources, prompts, requestor tasks, messages, fetch requests, stderr) live in **optional state managers** in `core/mcp/state/`. Apps create an `InspectorClient` and only the state managers they need (e.g. `PagedToolsState`, `MessageLogState`); React hooks in `core/react/` subscribe to those managers. See [protocol-and-state-managers-architecture.md](protocol-and-state-managers-architecture.md) for the full design.

### Project Structure

```
inspector/
├── clients/
│   ├── cli/              # CLI workspace (uses core)
│   ├── tui/              # TUI workspace (uses core)
│   ├── web/              # Web client workspace (uses core)
│   └── launcher/         # Global binary wrapper
├── core/              # Shared workspace package (InspectorClient, state managers, react, auth)
│   ├── mcp/           # InspectorClient (protocol) + state managers
│   │   └── state/     # Optional state managers (tools, resources, logs, tasks)
│   ├── react/         # useInspectorClient + hooks per state manager
│   ├── json/          # JSON utilities
│   └── auth/          # OAuth infrastructure
└── package.json       # Root workspace config
```

### Shared Package (`@modelcontextprotocol/inspector-core`)

The `core/` directory is a **workspace package** that:

- **Private** (`"private": true`) - internal-only, not published
- **Built separately** - compiles to `core/build/` with TypeScript declarations
- **Referenced via package name** - workspaces import using `@modelcontextprotocol/inspector-core/*`
- **Uses TypeScript Project References** - CLI, TUI, and web reference core for build ordering and type resolution
- **React peer dependency** - declares React 19.2.3 as peer dependency (consumers provide React)

**Build Order**: Core must be built before CLI, TUI, and web (enforced via TypeScript Project References and CI workflows).

## InspectorClient: The Core Shared Component

### Overview

`InspectorClient` (`core/mcp/inspectorClient.ts`) is the **protocol layer** around the MCP SDK `Client`: it owns the connection and transport, exposes list RPCs (stateless), and dispatches events. **List and log state** (tools, resources, prompts, tasks, messages, fetch requests, stderr) are held by **optional state managers** (`core/mcp/state/`); see [protocol-and-state-managers-architecture.md](protocol-and-state-managers-architecture.md). InspectorClient provides:

- **Unified Client Interface**: Single class for connection and all MCP operations
- **Client and Transport Lifecycle**: Creates and manages MCP SDK `Client` and `Transport`; `connect()` / `disconnect()`
- **Event-Driven Protocol**: Uses `EventTarget`; dispatches signal events (`*ListChanged`, `taskStatusChange`, `message`, `fetchRequest`, `stderrLog`, etc.) so state managers can subscribe
- **List RPCs (stateless)**: `listTools`, `listResources`, `listPrompts`, `listRequestorTasks`, etc.—return data only; no internal cache
- **Server Metadata**: Holds capabilities, serverInfo, instructions; dispatches change events
- **Transport Abstraction**: Works with all `Transport` types (stdio, SSE, streamable-http)
- **High-Level Methods**: Wrappers for tools/call, readResource, getPrompt, createMessage, elicit, and other MCP methods

### Key Features

**Connection Management:**

- `connect()` - Establishes connection; registers notification handlers and fetches server metadata
- `disconnect()` - Closes connection and clears references
- Connection status tracking (`disconnected`, `connecting`, `connected`, `error`)

**Protocol events (list and log data):**

- InspectorClient dispatches **per-entry** and **signal** events (e.g. `message`, `fetchRequest`, `stderrLog`, `toolsListChanged`, `taskStatusChange`). **State managers** subscribe to these, hold lists (messages, tools, resources, tasks, etc.), and dispatch their own change events; React hooks subscribe to the managers. List and log state are not stored on InspectorClient. See [protocol-and-state-managers-architecture.md](protocol-and-state-managers-architecture.md).

**Request and stderr events:**

- Dispatches `fetchRequest` (per entry) and `stderrLog` (per entry) so log state managers (`FetchRequestLogState`, `StderrLogState`) can append and hold the lists. InspectorClient does not store message, fetch, or stderr lists.

**MCP Method Wrappers:**

- `listTools(metadata?)` - List available tools
- `callTool(name, args, generalMetadata?, toolSpecificMetadata?)` - Call a tool with automatic parameter conversion
- `listResources(metadata?)` - List available resources
- `readResource(uri, metadata?)` - Read a resource by URI
- `listResourceTemplates(metadata?)` - List resource templates
- `listPrompts(metadata?)` - List available prompts
- `getPrompt(name, args?, metadata?)` - Get a prompt with automatic argument stringification
- `getCompletions(resourceUri, prompt, metadata?)` - Get completions for resource templates or prompts
- `getRoots()` - List roots
- `setRoots(roots)` - Set roots
- `setLoggingLevel(level)` - Set logging level with capability checks

**Advanced Features:**

- **OAuth 2.1** - Full OAuth support (static client, DCR, CIMD, guided auth) with injectable storage, navigation, and redirect URL providers
- **Sampling** - Handles sampling requests, tracks pending samples, dispatches `newPendingSample` events
- **Elicitation** - Handles elicitation requests (form and URL), tracks pending elicitations, dispatches `newPendingElicitation` events
- **Roots** - Manages roots capability, handles `roots/list` requests, dispatches `rootsChange` events
- **Progress Notifications** - Handles progress notifications, dispatches `progressNotification` events, resets request timeout on progress
- **ListChanged Notifications** - Automatically reloads tools/resources/prompts when `listChanged` notifications are received

**Configurable Options:**

- `initialLoggingLevel` - Sets the logging level on connect if server supports logging (optional)
- `pipeStderr` - Whether to pipe stderr for stdio transports (default: `false`; TUI and CLI set this explicitly)
- `sample` - Whether to advertise sampling capability (default: `true`)
- Elicitation and other capability options as defined in `InspectorClientOptions`

List and log size limits (`maxMessages`, `maxStderrLogEvents`, `maxFetchRequests`) are **not** properties of InspectorClient. Apps that use state managers (`MessageLogState`, `StderrLogState`, `FetchRequestLogState`) pass these as options when constructing those managers (e.g. `new MessageLogState(client, { maxMessages: 1000 })`).

### Event System

`InspectorClient` extends `EventTarget` for cross-platform compatibility. It dispatches **signal** and **per-entry** events; state managers subscribe and hold list state. Events include:

- **Connection:** `statusChange`, `connect`, `disconnect`
- **Server metadata:** `capabilitiesChange`, `serverInfoChange`, `instructionsChange`
- **List signals:** `toolsListChanged`, `resourcesListChanged`, `promptsListChanged`, `tasksListChanged`, `taskStatusChange`, `requestorTaskUpdated`, `taskCancelled`
- **Log (per-entry):** `message`, `fetchRequest`, `stderrLog`
- **Other:** `error`, OAuth events, etc.

State managers emit their own change events (e.g. `toolsChange`, `messagesChange`) with the current list. See [protocol-and-state-managers-architecture.md](protocol-and-state-managers-architecture.md).

### Shared Module Structure

The shared package is organized with environment-specific code separated into `node/` and `browser/` subdirectories. Portable code (no environment-specific APIs) lives in module roots; Node-specific code is under `node/` subdirectories; browser-specific code is under `browser/` subdirectories.

**Main modules:**

- **`core/mcp/`** - `InspectorClient` (protocol) and MCP types, transport, config
- **`core/mcp/state/`** - Optional state managers (Managed*/Paged* for tools, resources, prompts, tasks; MessageLogState, FetchRequestLogState, StderrLogState). See [protocol-and-state-managers-architecture.md](protocol-and-state-managers-architecture.md).
- **`core/mcp/remote/`** - Remote transport infrastructure (portable client code)
- **`core/auth/`** - OAuth infrastructure (portable base code)
- **`core/react/`** - `useInspectorClient` and hooks per state manager (`usePagedTools`, `useMessageLog`, etc.)
- **`core/json/`** - JSON utilities
- **`core/storage/`** - Storage abstraction layer

For detailed module organization, environment-specific modules, and package exports, see [environment-isolation.md](environment-isolation.md).

## Current Usage

### CLI Usage

The CLI uses `InspectorClient` for all MCP operations:

```typescript
// Convert CLI args to MCPServerConfig
const config = argsToMcpServerConfig(args);

// Create InspectorClient
const inspectorClient = new InspectorClient(config, {
  clientIdentity,
  environment: { transport: createTransportNode, ... },
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

- Uses state managers (e.g. `PagedToolsState`, `MessageLogState`) attached to InspectorClient; state managers subscribe to events and optionally auto-fetch lists on connect as needed
- Uses `useInspectorClient` and per–state-manager hooks (`usePagedTools`, `useMessageLog`, etc.) for reactive UI updates
- `ToolTestModal` uses `inspectorClient.callTool()` directly

**TUI Status:**

- **Experimental**: The TUI functionality may be considered "experimental" until sufficient testing and review of features and implementation. This allows for iteration and refinement based on user feedback before committing to a stable feature set.
- **Feature parity**: The TUI now supports OAuth (static client, CIMD, DCR, guided auth), completions, elicitation, sampling, and HTTP request tracking. InspectorClient provides all of these.

**Entry Point:**
The TUI is invoked via the main `mcp-inspector` command with a `--tui` flag:

- `mcp-inspector --tui ...` → TUI mode
- `mcp-inspector --cli ...` → CLI mode
- `mcp-inspector ...` → Web client mode (default)

This provides a single entry point with consistent argument parsing across all three UX modes.

### Web Client Usage

The web client uses InspectorClient for all MCP operations:

- **Environment**: `createWebEnvironment()` supplies `createRemoteTransport`, `createRemoteFetch`, `createRemoteLogger`, and OAuth storage/navigation. The browser talks to the same-origin API server (Hono `createRemoteApp`) for transport, fetch proxy, logging, and storage.
- **Lifecycle**: InspectorClient is created lazily via `ensureInspectorClient()` when the user connects or performs OAuth. The app attaches the same state managers (e.g. PagedToolsState, MessageLogState) and uses `useInspectorClient`, `usePagedTools`, `useMessageLog`, etc.
- **Config**: Web UI config (transport type, URL, command/args for stdio, headers, OAuth) is converted to `MCPServerConfig` and `InspectorClientOptions` when creating the client.

### Feature coverage

InspectorClient supports OAuth (static client, CIMD, DCR, guided auth), completions (`getCompletions`), elicitation, sampling, roots, progress notifications, and custom headers via `MCPServerConfig`. For which features are implemented in the TUI vs. web client, see [mcp-feature-tracker.md](mcp-feature-tracker.md).

## Web App Integration

### Current State

The web client uses **InspectorClient** and the same state managers and hooks as the TUI. Core functionality:

| Capability                             | Web client implementation                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Connection management                  | InspectorClient `connect()`, `disconnect()`, status events                                           |
| Tools, resources, prompts              | State managers (PagedToolsState, etc.) + hooks; InspectorClient methods                              |
| Message tracking                       | MessageLogState + useMessageLog; MessageEntry[]                                                      |
| OAuth                                  | environment.oauth (BrowserOAuthStorage or RemoteOAuthStorage), environment.fetch (createRemoteFetch) |
| Custom headers                         | headers in MCPServerConfig (SSE/streamable-http)                                                     |
| Elicitation, sampling, roots, progress | InspectorClient events and methods; state managers as needed                                         |
| Request history                        | FetchRequestLogState + useFetchRequestLog                                                            |
| Transport                              | createRemoteTransport (talks to Hono API server)                                                     |

### Environment Isolation: What's Done vs. Pending

Per [environment-isolation.md](environment-isolation.md):

**Implemented:** All environment-specific dependencies are consolidated into `InspectorClientEnvironment` (transport, fetch, logger, oauth.storage, oauth.navigation, oauth.redirectUrlProvider). Transport is required; fetch, logger, and OAuth components are optional. Node uses `createTransportNode`; browser uses `createRemoteTransport`, `createRemoteFetch`, `createRemoteLogger`. Core runs in Node (CLI, TUI) and browser (web client).

**Implemented (remote infrastructure):**

- **Hono API server** — In `core/mcp/remote/node/`. Endpoints for transport (`/api/mcp/connect`, `send`, `events`, `disconnect`), proxy fetch (`/api/fetch`), logging (`/api/log`), and storage (`/api/storage/:storeId`).
- **createRemoteTransport + RemoteClientTransport** — In `core/mcp/remote/` (portable). Browser transport that talks to the remote server.
- **createRemoteFetch** — In `core/mcp/remote/`. Fetch that POSTs to `/api/fetch` for OAuth (CORS bypass).
- **createRemoteLogger** — In `core/mcp/remote/`. Pino logger that POSTs to `/api/log` via `pino/browser` transmit.
- **Storage abstraction** — `FileStorageAdapter` (Node), `RemoteStorageAdapter` (browser), `RemoteOAuthStorage` (HTTP API). All OAuth storage implementations use Zustand persist middleware for consistency.
- **Generic storage API** — `GET/POST/DELETE /api/storage/:storeId` endpoints for shared on-disk state between web app and TUI/CLI. See [environment-isolation.md](environment-isolation.md).
- **Node code organization** — `core/auth/node/`, `core/mcp/node/`, `core/mcp/remote/node/`.

**Summary:** The web client uses InspectorClient with `createRemoteTransport`, `createRemoteFetch`, `createRemoteLogger`, and OAuth storage adapters. The Hono API server (`createRemoteApp`) is integrated into the web app server (see `web/src/server.ts`). The web app creates InspectorClient lazily (`ensureInspectorClient`), attaches state managers, and uses the same React hooks (`useInspectorClient`, `usePagedTools`, `useMessageLog`, etc.) as the TUI.

## Web Client Implementation Notes

### Architecture (as-built)

The web client uses InspectorClient and state managers. Key pieces:

- **Environment**: `createWebEnvironment()` (in `web/src/lib/adapters/environmentFactory.ts`) builds `InspectorClientEnvironment` with `createRemoteTransport`, `createRemoteFetch`, `createRemoteLogger`, and OAuth storage/navigation/redirect providers. The web server runs `createRemoteApp` (Hono) and serves `/api/mcp/*`, `/api/fetch`, `/api/log`, `/api/storage/*`.
- **InspectorClient lifecycle**: The web app creates InspectorClient lazily via `ensureInspectorClient()` when the user connects or performs auth. Config is converted to `MCPServerConfig`; the same state managers (PagedToolsState, MessageLogState, etc.) and hooks (`useInspectorClient`, `usePagedTools`, `useMessageLog`, etc.) as the TUI are used.
- **OAuth**: Injected via environment (`BrowserOAuthStorage` or `RemoteOAuthStorage`, `BrowserNavigation`, redirect URL provider). The web app implements the `oauth/callback` route and calls `inspectorClient.completeOAuthFlow()` or guided-auth APIs as needed.
- **State**: MessageEntry[], fetch request log, stderr log, tools/resources/prompts/tasks all come from state managers subscribed to InspectorClient events; no separate useConnection state.

## Summary

The architecture provides:

- **Single source of truth** for MCP client operations via `InspectorClient` in core
- **CLI, TUI, and web client** all use core (InspectorClient and, where applicable, state managers and React hooks)
- **Consistent behavior** across all three interfaces
- **Reduced maintenance burden** — fix once, works everywhere
- **Type safety** through shared types
- **Event-driven updates** via EventTarget (cross-platform compatible)

**As-built:** CLI, TUI, and web client use InspectorClient from core. TUI and web use state managers and the same React hooks; CLI calls InspectorClient methods directly. For TUI vs. web feature coverage, see [mcp-feature-tracker.md](mcp-feature-tracker.md).
