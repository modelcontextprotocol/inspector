# MCP Inspector Core

The Core package provides the shared foundation for all MCP Inspector clients (`web`, `cli`, and `tui`). It acts as the single source of truth for MCP protocol interactions, state management, and React hooks across the monorepo.

## Architecture

The Inspector follows a unified architecture where `InspectorClient` acts as the primary protocol layer.

For detailed information about the shared architecture, please see the [Shared Code Architecture Document](../../docs/shared-code-architecture.md).

### InspectorClient

The `InspectorClient` (`core/mcp/inspectorClient.ts`) wraps the official MCP SDK `Client`. Its responsibilities include:

- Managing the lifecycle and connection of the transport layer.
- Exposing stateless list RPCs (e.g. `listTools`, `listResources`).
- Dispatching events (e.g., `message`, `toolsListChanged`).

It uses **environment isolation** to remain fully portable across Node.js (CLI, TUI, Dev server) and the browser (Web). Environment-specific implementations like transports (`createTransportNode` vs `createRemoteTransport`) and storage adapters are injected into it via an `InspectorClientEnvironment`.

### State Managers

While `InspectorClient` is stateless, list and log state are held in dedicated state managers located in `core/mcp/state/`.

These managers (e.g. `PagedToolsState`, `MessageLogState`) subscribe to the `InspectorClient` events, request data via its RPCs, hold caches or lists, and emit their own granular change events.

### React Integration

For clients utilizing React (Web and TUI), the `src/react/` directory provides custom React hooks (e.g. `useInspectorClient`, `usePagedTools`, `useMessageLog`) that bind the class-based state managers to component state.
