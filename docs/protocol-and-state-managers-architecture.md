# Protocol and State Managers Architecture

This document describes how the Inspector protocol and state managers work: **InspectorClient** is the protocol (connection, RPCs, notification dispatch). Optional **state managers** take the client, subscribe to its events, hold list or log state, and dispatch their own change events. **Hooks** subscribe to managers and expose state and methods to React. Apps create one InspectorClient and only the managers they need.

---

## Nomenclature

| Term                  | Meaning                                                                                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **InspectorClient**   | Owns the MCP connection, transport, and SDK client. Exposes list RPCs (return data only, no storage), notification events (e.g. `toolsListChanged`, `taskStatusChange`), and all other request/stream methods. No cached lists or log arrays. |
| **State manager**     | Optional object that holds state (lists or logs), takes an InspectorClient, subscribes to protocol events, and exposes getters, methods, and its own change events.                                                                           |
| **Managed\*State**    | Keeps a full list in sync with the server: subscribes to the relevant `*ListChanged` event and on connect/refresh fetches all pages, then dispatches a change event.                                                                          |
| **Paged\*State**      | Builds the list as the app loads pages: exposes `loadPage(cursor)`, merges results, dispatches change events; may subscribe to `*ListChanged` to refetch or invalidate.                                                                       |
| **Log-style manager** | Holds an append-only list (messages, fetch requests, stderr). Protocol emits only per-entry events (`message`, `fetchRequest`, `stderrLog`). Manager appends and emits its own list-change event.                                             |
| **Hook**              | React hook that subscribes to a state manager’s events and exposes that manager’s state and methods. One hook per manager.                                                                                                                    |

---

## InspectorClient

**Responsibilities:**

- **Connection and transport:** `connect()`, `disconnect()`, `getStatus()`.
- **List RPCs (stateless):** `listTools(cursor?, metadata?)`, `listResources(cursor?, metadata?)`, `listResourceTemplates(cursor?, metadata?)`, `listPrompts(cursor?, metadata?)`, `listRequestorTasks(cursor?)`. Each returns a promise with items and optional `nextCursor`. No internal cache.
- **Notification handling:** Registers for server notifications and dispatches signal events: `toolsListChanged`, `resourcesListChanged`, `resourceTemplatesListChanged`, `promptsListChanged`, `tasksListChanged`, `taskStatusChange` (with task payload), `requestorTaskUpdated` (client-origin task updates from getRequestorTask and callToolStream), `taskCancelled`.
- **Other RPC and streams:** `callTool`, `callToolStream`, `readResource`, `getPrompt`, `createMessage`, `elicit`, resource subscribe/unsubscribe, `setLoggingLevel`, etc.
- **Request handlers (server → client):** Roots, receiver tasks (createMessage/elicit with task params), etc.
- **OAuth and session:** Connection and auth; dispatches `saveSession` with sessionId (persistence is in FetchRequestLogState).
- **Log events (per-entry only):** Dispatches `message`, `fetchRequest`, `stderrLog` with payload. Does not maintain log lists or emit list-change events; log managers do that.

**Still inside InspectorClient (not extracted to external managers):** roots (and `getRoots()`), pendingSamples, pendingElicitations, receiverTaskRecords, OAuth state machine, sessionId. These may be refactored into internal sub-managers later.

---

## State Managers

Managers take an **InspectorClient** in their constructor, subscribe to protocol events, and optionally call list RPCs. They expose getters (e.g. `getTools()`), their own change events (e.g. `toolsChange` with the full list), and methods (e.g. `loadPage(cursor)`, `refresh()`, `clear()`).

**Protocol vs. manager events:** The protocol emits **signal** events (`toolsListChanged`, `taskStatusChange`, etc.). Managers subscribe to those and emit **state** events (`toolsChange`, `tasksChange`, etc.) with the current list as `event.detail`. UI and hooks subscribe to the manager’s events.

**Type-safe events:** Protocol and managers use `TypedEventTarget<EventMap>`; each manager defines its own event map (e.g. `ManagedToolsStateEventMap`: `{ toolsChange: Tool[] }`).

### List-style managers (Managed\*)

| Manager                           | Protocol events                                                                                            | RPC                     | Behavior                                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| **ManagedToolsState**             | `toolsListChanged`, `statusChange`                                                                         | `listTools`             | On connect and `toolsListChanged`, fetches all pages; dispatches `toolsChange`. `refresh()`.           |
| **ManagedResourcesState**         | `resourcesListChanged`, `statusChange`                                                                     | `listResources`         | Same pattern. Optional `setMetadata()` for list_resources metadata.                                    |
| **ManagedResourceTemplatesState** | `resourceTemplatesListChanged`, `statusChange`                                                             | `listResourceTemplates` | Same pattern.                                                                                          |
| **ManagedPromptsState**           | `promptsListChanged`, `statusChange`                                                                       | `listPrompts`           | Same pattern.                                                                                          |
| **ManagedRequestorTasksState**    | `connect`, `tasksListChanged`, `statusChange`, `taskStatusChange`, `requestorTaskUpdated`, `taskCancelled` | `listRequestorTasks`    | Fetches all pages on connect/list changed; merges task updates; dispatches `tasksChange`. `refresh()`. |

### Paged managers (Paged\*)

| Manager                         | Protocol events                                                                                 | RPC                             | Behavior                                                                                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **PagedToolsState**             | `statusChange`                                                                                  | `listTools(cursor)`             | `loadPage(cursor)`, `clear()`. Clears on disconnect.                                                                                     |
| **PagedResourcesState**         | `statusChange`                                                                                  | `listResources(cursor)`         | `loadPage(cursor)`, `clear()`. Clears on disconnect.                                                                                     |
| **PagedResourceTemplatesState** | `statusChange`                                                                                  | `listResourceTemplates(cursor)` | Same.                                                                                                                                    |
| **PagedPromptsState**           | `statusChange`                                                                                  | `listPrompts(cursor)`           | Same.                                                                                                                                    |
| **PagedRequestorTasksState**    | `statusChange`, `tasksListChanged`, `taskStatusChange`, `requestorTaskUpdated`, `taskCancelled` | `listRequestorTasks(cursor)`    | `loadPage(cursor)`, `clear()`, `getNextCursor()`. Merges task updates; on `tasksListChanged` refetches first page. Clears on disconnect. |

### Log-style managers

| Manager                  | Protocol events | Manager emits                                                                                                                      |
| ------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **MessageLogState**      | `message`       | Appends; emits `messagesChange` (list). `getMessages()`, `clearMessages()`. Matches request/response; computes duration.           |
| **FetchRequestLogState** | `fetchRequest`  | Appends; emits `fetchRequestsChange` (list). Optional sessionStorage + sessionId: listens for `saveSession`, restores on creation. |
| **StderrLogState**       | `stderrLog`     | Appends; emits `stderrLogsChange` (list).                                                                                          |

---

## Hooks

Each state manager has a matching React hook. Hooks take `(InspectorClient | null, StateManager | null)` and return the manager’s state plus methods.

| Manager                       | Hook                        | Returns (conceptually)                              |
| ----------------------------- | --------------------------- | --------------------------------------------------- |
| ManagedToolsState             | useManagedTools             | `{ tools, refresh }`                                |
| PagedToolsState               | usePagedTools               | `{ tools, loadPage(cursor), clear }`                |
| ManagedResourcesState         | useManagedResources         | `{ resources, refresh }`                            |
| PagedResourcesState           | usePagedResources           | `{ resources, loadPage(cursor, metadata?), clear }` |
| ManagedResourceTemplatesState | useManagedResourceTemplates | `{ resourceTemplates, refresh }`                    |
| PagedResourceTemplatesState   | usePagedResourceTemplates   | `{ resourceTemplates, loadPage(cursor), clear }`    |
| ManagedPromptsState           | useManagedPrompts           | `{ prompts, refresh }`                              |
| PagedPromptsState             | usePagedPrompts             | `{ prompts, loadPage(cursor), clear }`              |
| ManagedRequestorTasksState    | useManagedRequestorTasks    | `{ tasks, refresh }`                                |
| PagedRequestorTasksState      | usePagedRequestorTasks      | `{ tasks, loadPage(cursor), clear, nextCursor }`    |
| MessageLogState               | useMessageLog               | `{ messages }`                                      |
| FetchRequestLogState          | useFetchRequestLog          | `{ fetchRequests }`                                 |
| StderrLogState                | useStderrLog                | `{ stderrLogs }`                                    |

**useInspectorClient:** Takes the InspectorClient only. Returns `{ status, capabilities, serverInfo, instructions, appRendererClient, connect, disconnect }`. No list or log state.

---

## App composition

1. **Create client:** One `InspectorClient` instance (config, environment, OAuth as needed).
2. **Create only the state managers you need:** e.g. `new PagedToolsState(client)`, `new MessageLogState(client)`. Create them when the client is created or when switching clients; destroy them when the client is replaced.
3. **Use the matching hooks:** e.g. `usePagedTools(inspectorClient, pagedToolsState)`, `useMessageLog(messageLogState)`.

**Web** uses InspectorClient plus Paged* managers (tools, resources, resource templates, prompts, requestor tasks) and log managers. **TUI** uses InspectorClient plus Managed* managers for lists and log managers. **CLI** uses InspectorClient plus Managed\* managers where it needs list output.

---

## Code organization

```
core/
├── mcp/
│   ├── inspectorClient.ts
│   ├── inspectorClientEventTarget.ts
│   ├── index.ts
│   ├── ...                         # transport, config, types, etc.
│   └── state/
│       ├── index.ts
│       ├── managedToolsState.ts
│       ├── pagedToolsState.ts
│       ├── managedResourcesState.ts
│       ├── pagedResourcesState.ts
│       ├── managedResourceTemplatesState.ts
│       ├── pagedResourceTemplatesState.ts
│       ├── managedPromptsState.ts
│       ├── pagedPromptsState.ts
│       ├── managedRequestorTasksState.ts
│       ├── pagedRequestorTasksState.ts
│       ├── messageLogState.ts
│       ├── fetchRequestLogState.ts
│       └── stderrLogState.ts
├── react/
│   ├── useInspectorClient.ts
│   ├── useManagedTools.ts
│   ├── usePagedTools.ts
│   ├── useManagedResources.ts
│   ├── usePagedResources.ts
│   ├── useManagedResourceTemplates.ts
│   ├── usePagedResourceTemplates.ts
│   ├── useManagedPrompts.ts
│   ├── usePagedPrompts.ts
│   ├── useManagedRequestorTasks.ts
│   ├── usePagedRequestorTasks.ts
│   ├── useMessageLog.ts
│   ├── useFetchRequestLog.ts
│   └── useStderrLog.ts
├── auth/
├── json/
└── ...
```

Managers are framework-agnostic (EventTarget only). Hooks import the protocol and state types from core and subscribe to manager events.

---

## Testing

- **State managers:** Each manager has a test file in `core/__tests__/mcp/state/`. Tests use a **mocked InspectorClient** (stub list RPCs, dispatch protocol events). Assert manager state (e.g. `getTools()`) and events (e.g. `toolsChange`). No real transport.
- **Hooks:** Hook tests in `core/__tests__/react/` use mock state managers (EventTarget with getters and dispatch). Assert initial state, updates when manager dispatches, and method behavior (loadPage, clear, refresh).
- **InspectorClient:** Tests cover connection lifecycle, RPC delegation, notification dispatch, and integration with real or test servers where needed.
