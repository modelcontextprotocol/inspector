# Protocol and State Managers Architecture

This document describes a target architecture that splits the current `InspectorClient` into a **protocol layer** and **optional, composable state managers**, with hooks aligned to each manager. Apps take a protocol instance and attach only the state managers they need; there is no single monolithic "client state" that always owns tools, resources, prompts, messages, and fetch requests.

---

## Overview

### Goals

- **Single protocol, optional state:** One object (the protocol) owns the connection and all MCP RPC + notification signaling. List and log state live in **optional** managers that take the protocol and subscribe to its events.
- **Composition by concern:** An app that only cares about a managed tool list uses the protocol plus `ManagedToolsState`. An app that needs paged tools uses `CachedToolsState`. An app that doesn't care about resources or prompts uses no state manager for those.
- **Clear nomenclature:** Protocol vs. state; list-style managers (sync on notification) vs. cache-style (paged, build-as-you-load) vs. log-style (append-only streams from the protocol).
- **Hooks per manager:** Each state manager has a corresponding hook (e.g. `useManagedTools`, `useCachedTools`). Apps that need the request log attach a log manager and use a hook for that manager.

### Relation to current design

Today, `InspectorClient` is a single facade that mixes protocol (transport, RPC, notification handling, request handlers) and state (cached lists, message log, fetch log). The sub-manager extraction described in [inspector-client-sub-managers.md](inspector-client-sub-managers.md) keeps one facade and moves behavior into **internal** delegation. This document describes a **different** split: a **public** protocol type and **optional, external** state managers that consumers compose. The two approaches can be combined (e.g. implement the protocol first, then extract internal sub-managers inside it) or the protocol + external managers can replace the monolith over time.

---

## Nomenclature

| Term                        | Meaning                                                                                                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **InspectorClientProtocol** | The object that owns the MCP connection, transport, and SDK client. Exposes list RPCs (return data only, no storage), notification events (e.g. `toolsListChanged`), and all other request/stream methods. No cached lists.             |
| **State manager**           | An optional object that holds state (lists or logs), takes an `InspectorClientProtocol` (or a narrow interface of it), subscribes to protocol events, and exposes getters + optional methods + its own change events.                   |
| **Managed\*State**          | A list-style state manager that keeps a full list in sync with the server: subscribes to the relevant `*ListChanged` event and (when enabled) refetches all pages and updates its cache, then dispatches a change event.                |
| **Cached\*State**           | A cache-style state manager that builds the list as the app loads pages: exposes `loadPage(cursor)` (or equivalent), merges results into its cache, dispatches change events; may subscribe to `*ListChanged` to invalidate or refetch. |
| **Log-style manager**       | Holds an append-only list (e.g. messages, fetch requests) that the protocol pushes into; does not call list RPCs or sync on list_changed.                                                                                               |
| **Hook**                    | A React hook that subscribes to a specific state manager’s events and exposes that manager’s state and methods to the component tree. One hook per manager (or per composition of managers).                                            |

---

## InspectorClientProtocol

### Responsibility

- **Connection and transport:** Create and own the MCP SDK `Client` and `Transport` (including message-tracking wrapper if desired). `connect()`, `disconnect()`, `getStatus()`.
- **List RPCs (stateless):** `listTools(params)`, `listResources(...)`, `listResourceTemplates(...)`, `listPrompts(...)`, `listRequestorTasks(cursor?)`, etc. Each returns `Promise<{ items, nextCursor? }>` (or the appropriate shape). **No** internal cache; no `this.tools`.
- **Notification handling:** Register with the SDK for server notifications; dispatch **signal** events such as `toolsListChanged`, `resourcesListChanged`, `promptsListChanged`, `tasksListChanged`, `taskStatusChange` (with payload where needed). Protocol does not merge lists or hold list state.
- **Other RPC and streams:** `callTool`, `callToolStream`, `readResource`, `getPrompt`, `createMessage`, `elicit`, subscribe/unsubscribe resource, `setLoggingLevel`, etc.
- **Request handlers (server → client):** Register handlers for roots, tasks, createMessage/elicit (receiver tasks), etc., so the server can call back into the client.
- **OAuth and session:** As today (or delegated to an internal OAuth manager); protocol remains the single entry point for connection and auth.
- **Log feeding (optional):** If the app attaches a message or fetch-request manager, the protocol (or transport) pushes new entries into it; the protocol does not have to hold messages/fetchRequests itself.

### Interface shape (for state managers)

State managers need a narrow view of the protocol. Conceptually:

- **List RPC:** `listTools(params): Promise<{ tools: Tool[]; nextCursor?: string }>`, and similarly for resources, resource templates, prompts, requestor tasks.
- **Events:** `addEventListener("toolsListChanged", ...)`, `addEventListener("tasksListChanged", ...)`, `addEventListener("taskStatusChange", ...)`, etc.
- **Connection:** `getStatus()`, and optionally `addEventListener("statusChange", ...)` so managers can clear state on disconnect.

So managers depend on **InspectorClientProtocol** (or an interface like `InspectorListProtocol` that exposes only list RPCs + the relevant events). The protocol is the **first** thing created; managers are created with a reference to it.

---

## State Managers

Managers take an **InspectorClientProtocol** (or the minimal protocol interface they need) in their constructor. They subscribe to protocol events and optionally call protocol list RPCs. They expose:

- Getters for their state (e.g. `getTools()`).
- Their own change events (e.g. `toolsChange` with the full list), so React hooks can subscribe and re-render.
- Optional methods (e.g. `loadPage(cursor)` for cached lists, `refresh()` for managed lists).

Apps **compose** only the managers they need; there is no single “InspectorClientState” that owns every list and log.

### List-style managers (sync on notification)

| Manager                   | Purpose                                    | Protocol events        | Protocol RPC                             | Behavior                                                                                                                                                                               |
| ------------------------- | ------------------------------------------ | ---------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ManagedToolsState**     | Full tool list, always in sync with server | `toolsListChanged`     | `listTools` (all pages)                  | On `toolsListChanged` (and optionally on first attach), fetches all pages via `listTools`, updates internal `tools`, dispatches `toolsChange`. Optional `refresh()` for manual reload. |
| **ManagedResourcesState** | Full resources list                        | `resourcesListChanged` | `listResources` (+ templates if desired) | Same pattern as tools.                                                                                                                                                                 |
| **ManagedPromptsState**   | Full prompts list                          | `promptsListChanged`   | `listPrompts`                            | Same pattern.                                                                                                                                                                          |

### Cache-style managers (paged, build-as-you-load)

| Manager                       | Purpose                                          | Protocol events                        | Protocol RPC                 | Behavior                                                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------ | -------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CachedToolsState**          | Paged tool list; cache grows as pages are loaded | `toolsListChanged`                     | `listTools(cursor)`          | Exposes `loadPage(cursor)` (or `listTools(cursor)`). Calls protocol `listTools`, merges into internal cache, dispatches `toolsChange`. On `toolsListChanged`, may invalidate cache or refetch first page. Returns `nextCursor` for “Load more”. |
| **CachedResourcesState**      | Paged resources                                  | `resourcesListChanged`                 | `listResources(cursor)`      | Same pattern.                                                                                                                                                                                                                                   |
| **CachedPromptsState**        | Paged prompts                                    | `promptsListChanged`                   | `listPrompts(cursor)`        | Same pattern.                                                                                                                                                                                                                                   |
| **CachedRequestorTasksState** | Paged requestor tasks; app drives when to load   | `tasksListChanged`, `taskStatusChange` | `listRequestorTasks(cursor)` | Holds task list; exposes `loadPage(cursor)`. On `taskStatusChange`, merges updated task into cache and dispatches. On `tasksListChanged`, invalidate or refetch.                                                                                |

### Log-style managers (append-only, protocol pushes)

| Manager                  | Purpose                                                        | Protocol / transport                                        | Behavior                                                                                                                                                      |
| ------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MessageLogState**      | Message history (requests, responses, notifications)           | Protocol or transport pushes entries (e.g. on send/receive) | Holds `messages[]`; exposes `getMessages()`, optional `clear()`. Dispatches `messagesChange` when new entries are added. No list RPC; protocol feeds the log. |
| **FetchRequestLogState** | HTTP/fetch request log (e.g. for OAuth or transport debugging) | Protocol or transport pushes entries                        | Same idea: `getFetchRequests()`, `fetchRequestsChange`.                                                                                                       |
| **StderrLogState**       | Stderr log (stdio transports)                                  | Transport pushes                                            | Same idea: `getStderrLogs()`, `stderrLogsChange`.                                                                                                             |

These can be separate or combined (e.g. a single **RequestLogState** that holds messages + fetch requests + stderr if the app wants one place for “all tracking”).

---

## Hooks

Each state manager has a corresponding hook so React components can subscribe to that manager’s state and events. Hooks take the **manager** (or the protocol and create/obtain the manager from context).

| Manager                       | Hook                        | Returns (conceptually)                                                                                     |
| ----------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **ManagedToolsState**         | **useManagedTools**         | `{ tools, refresh, status? }` — tools from manager, optional refresh, optional loading/error from protocol |
| **CachedToolsState**          | **useCachedTools**          | `{ tools, loadPage(cursor), nextCursor, invalidate?, status? }`                                            |
| **ManagedResourcesState**     | **useManagedResources**     | `{ resources, resourceTemplates?, refresh }`                                                               |
| **CachedResourcesState**      | **useCachedResources**      | `{ resources, loadPage(cursor), nextCursor, ... }`                                                         |
| **ManagedPromptsState**       | **useManagedPrompts**       | `{ prompts, refresh }`                                                                                     |
| **CachedPromptsState**        | **useCachedPrompts**        | `{ prompts, loadPage(cursor), nextCursor, ... }`                                                           |
| **CachedRequestorTasksState** | **useCachedRequestorTasks** | `{ tasks, loadPage(cursor), nextCursor, cancelTask(taskId), taskStatusChange, ... }`                       |
| **MessageLogState**           | **useMessageLog**           | `{ messages }`                                                                                             |
| **FetchRequestLogState**      | **useFetchRequestLog**      | `{ fetchRequests }`                                                                                        |
| **StderrLogState**            | **useStderrLog**            | `{ stderrLogs }`                                                                                           |

- **Protocol-level hook (optional):** A thin **useInspectorProtocol** (or **useInspectorConnection**) that only exposes `status`, `connect`, `disconnect`, and optionally `capabilities`, `serverInfo`, `instructions` from the protocol. Used when the app only needs connection lifecycle and no list/log state.
- **Composition hook (optional):** A **useInspectorClient**-style hook that takes the protocol and a **bag of managers** (e.g. `{ managedTools: true, cachedRequestorTasks: true, messageLog: true }`) and returns a combined object (tools from managed manager, tasks from cached tasks manager, messages from message log). This is convenience only; the core model is “one hook per manager.”

---

## App composition

1. **Create protocol:** One `InspectorClientProtocol` instance (with environment, config, OAuth as today). This is the only object that connects and talks to the server.
2. **Create only the state managers you need:**
   - Managed tool list only → `new ManagedToolsState(protocol, { autoSync: true })`.
   - Paged tools + request log → `new CachedToolsState(protocol)`, `new MessageLogState(protocol)` (or pass a callback from protocol that pushes messages).
   - No resources or prompts → no `ManagedResourcesState` / `ManagedPromptsState`.
3. **Use the matching hooks:**
   - `useManagedTools(protocol, managedToolsState)` or `useManagedTools(protocol)` if the hook creates/gets the manager from context.
   - Same for `useCachedTools`, `useMessageLog`, etc.
4. **Optional facade:** A thin **InspectorClient** facade that holds the protocol and a default set of managers can still be provided for apps that want “one client” and don’t care about picking managers. That facade would delegate list/get methods to the appropriate manager and expose a single `useInspectorClient(client)` that composes the same data. The architecture still prefers “protocol + optional managers” as the primary model.

---

## Summary table: managers and hooks

| State manager             | Hook                    | Takes protocol?                 | Use when                                                      |
| ------------------------- | ----------------------- | ------------------------------- | ------------------------------------------------------------- |
| ManagedToolsState         | useManagedTools         | Yes                             | App wants “the full tool list” and auto-sync on list_changed. |
| CachedToolsState          | useCachedTools          | Yes                             | App wants paged tool loading and “Load more” (cursor).        |
| ManagedResourcesState     | useManagedResources     | Yes                             | App wants full resources (and optionally templates) in sync.  |
| CachedResourcesState      | useCachedResources      | Yes                             | App wants paged resources.                                    |
| ManagedPromptsState       | useManagedPrompts       | Yes                             | App wants full prompts in sync.                               |
| CachedPromptsState        | useCachedPrompts        | Yes                             | App wants paged prompts.                                      |
| CachedRequestorTasksState | useCachedRequestorTasks | Yes                             | App wants task list with pagination and task status updates.  |
| MessageLogState           | useMessageLog           | Yes (or callback from protocol) | App cares about message/request history.                      |
| FetchRequestLogState      | useFetchRequestLog      | Yes (or callback)               | App cares about fetch request log.                            |
| StderrLogState            | useStderrLog            | Yes (or callback)               | App cares about stderr (e.g. stdio).                          |

All managers take an **InspectorClientProtocol** (or the minimal interface they need) to start; they subscribe to its events and call its list RPCs as described above. Log-style managers may alternatively receive a push callback from the protocol instead of holding a reference to the full protocol.

---

## Code organization

State managers and their hooks live in the shared **core** package (`@modelcontextprotocol/inspector-core`). **Final:** state lives under **`core/mcp/state/`**

State is “MCP client state” and depends on the protocol, so it sits next to the protocol under the same umbrella.

```
core/
├── mcp/
│   ├── inspectorClient.ts          # or inspectorClientProtocol.ts
│   ├── index.ts
│   ├── ...                         # existing: transport, event target, config, etc.
│   └── state/                      # state managers (no React)
│       ├── index.ts
│       ├── managedToolsState.ts
│       ├── cachedToolsState.ts
│       ├── managedResourcesState.ts
│       ├── cachedResourcesState.ts
│       ├── managedPromptsState.ts
│       ├── cachedPromptsState.ts
│       ├── cachedRequestorTasksState.ts
│       ├── messageLogState.ts
│       ├── fetchRequestLogState.ts
│       └── stderrLogState.ts
├── react/
│   ├── useConnectionManager.ts     # status, connect, disconnect, capabilities, serverInfo, instructions
│   ├── useManagedTools.ts
│   ├── useCachedTools.ts
│   ├── useManagedResources.ts
│   ├── useCachedResources.ts
│   ├── useManagedPrompts.ts
│   ├── useCachedPrompts.ts
│   ├── useCachedRequestorTasks.ts
│   ├── useMessageLog.ts
│   ├── useFetchRequestLog.ts
│   ├── useStderrLog.ts
│   ├── useInspectorClient.ts       # optional: composition hook over protocol + chosen managers
│   └── index.ts
├── auth/
├── json/
└── ...
```

- **State managers** (`core/mcp/state/`) import the protocol type (or a narrow interface) from `../` (e.g. `../inspectorClientProtocol.js`). They are framework-agnostic (EventTarget only).
- **Hooks** (`core/react/`) import the protocol from `../mcp/` and state managers from `../mcp/state/` (or receive them via props/context). The connection hook (**useConnectionManager**) subscribes to the protocol for `status`, `connect`, `disconnect`, and optionally `capabilities`, `serverInfo`, `instructions` — no separate connection state manager, since the protocol is the source of truth for connection state.

## After state extraction: remaining sub-managers

Once list state, log state, and requestor-task cache are moved into **external** state managers (as above), the protocol (InspectorClientProtocol) still contains a substantial amount of logic. The following **internal** sub-managers (delegation inside the protocol, not public state managers) would still make sense for organization and testability. See [inspector-client-sub-managers.md](inspector-client-sub-managers.md) for the original delegation strategy.

| Sub-manager                          | Responsibility                                                                                                                                         | Why it remains                                                                                                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ReceiverTaskManager**              | Server-initiated tasks: create task record, TTL cleanup, payload promise, respond to `tasks/get`, `tasks/cancel`, `tasks/list`, emit status to server. | Protocol must implement the server→client request handlers and task lifecycle; this is not list state but request-handling and in-memory task records for the duration of the flow. ~100–120 lines.                                                                    |
| **OAuthManager**                     | OAuth config, state machine, storage, navigation, guided flow, token exchange.                                                                         | All OAuth behavior stays in the protocol; no external state manager for it. ~350–400 lines.                                                                                                                                                                            |
| **PendingSamplesElicitationManager** | Hold `pendingSamples`, `pendingElicitations`; createMessage/elicit handlers and elicitation-complete notification resolve them.                        | Tightly coupled to protocol request handlers. ~40–50 lines.                                                                                                                                                                                                            |
| **SessionManager**                   | Save/restore session state (e.g. fetch requests + timestamps).                                                                                         | Protocol still needs to persist/restore; session shape may reference data that now lives in log managers (e.g. fetch requests). Either the protocol gets a snapshot from FetchRequestLogState when saving, or session no longer persists fetch requests. ~60–80 lines. |
| **Content cache**                    | Already a separate class (`ContentCache` / `ReadOnlyContentCache`); populated by `readResource`, `getPrompt`.                                          | Keep as-is or treat as a small internal dependency; not a “state manager” in the same sense.                                                                                                                                                                           |

**Not needed as separate sub-managers after state extraction:**

- **ListSyncManager** — Replaced by external Managed* and Cached* state managers.
- **TrackingManager** — Replaced by external MessageLogState, FetchRequestLogState, StderrLogState; protocol only pushes to callbacks (or does not track unless a log manager is attached).
- **RequestorTaskManager (cache)** — The _list_ of requestor tasks moves to CachedRequestorTasksState. The protocol keeps: `listRequestorTasks(cursor)` (call SDK, return; no cache), `cancelRequestorTask`, `getRequestorTask` (call SDK), `getRequestorTaskResult`, and the `callToolStream` loop that **dispatches** task events. No internal `trackedRequestorTasks` map; stream logic can use local variables for the current task. So no internal “requestor task manager” beyond inline RPC + stream dispatch.

---

## Estimated code removal from InspectorClient

If we extract all state management as described (list state → Managed/Cached state managers, logs → log-style managers, requestor task list → CachedRequestorTasksState), the following code would be **removed** from the current `InspectorClient` (~3,470 lines). Ranges are approximate.

| Area                             | What is removed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Approx. lines  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **List state and list sync**     | Private state (`tools`, `resources`, `resourceTemplates`, `prompts`). All `listTools`, `listAllTools`, `listResources`, `listAllResources`, `listResourceTemplates`, `listAllResourceTemplates`, `listPrompts`, `listAllPrompts` (merge/cursor logic and dispatch). Getters `getTools`, `getResources`, `getResourceTemplates`, `getPrompts`. `clearTools`, `clearResources`, `clearResourceTemplates`, `clearPrompts`. List-changed notification handlers that call `listAll*` and update state. Disconnect clearing of list state and dispatch of list change events. | **~700–900**   |
| **Message / stderr / fetch log** | Private state (`messages`, `stderrLogs`, `fetchRequests`). `createMessageTrackingCallbacks`, `addMessage`, `updateMessageResponse`, `addStderrLog`, `addFetchRequest`. Getters `getMessages`, `getStderrLogs`, `getFetchRequests`. Trimming-at-max logic. Any dispatch of `messagesChange`, `stderrLogsChange`, `fetchRequestsChange`. (Protocol would instead invoke callbacks that log-style managers register.)                                                                                                                                                      | **~90–110**    |
| **Requestor task cache**         | Private state `trackedRequestorTasks`. `getTrackedRequestorTasks`, `upsertTrackedRequestorTask`. Cache-update branches in `getRequestorTask`, `cancelRequestorTask`, `listRequestorTasks`; all `upsertTrackedRequestorTask` usages in `callToolStream` and in the task status notification handler. Disconnect clearing of `trackedRequestorTasks`. Protocol keeps: RPC implementations that call SDK and return, and `callToolStream` that dispatches events only.                                                                                                     | **~50–80**     |
| **Total removed**                |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **~840–1,090** |

**Rough outcome:** Remove on the order of **~1,000 lines** (about **28–32%** of the current file). The protocol would drop from ~3,470 lines to roughly **~2,400–2,600 lines**, with the remainder being: connection/transport lifecycle, OAuth, receiver tasks, request handlers, pending samples/elicitation, session, content cache, RPC/stream methods that delegate to the SDK and (where applicable) dispatch events only, and wiring. Internal sub-managers (receiver tasks, OAuth, pending, session) would then further reduce the size of the main protocol class by moving another ~550–650 lines into dedicated modules.

---

## Document history

- **Created:** Describes protocol + optional state managers architecture, nomenclature, managers, and hooks; managers take InspectorClientProtocol.
- **Added:** “After state extraction: remaining sub-managers” and “Estimated code removal from InspectorClient”.
- **Added:** “Code organization” — state managers under `core/mcp/state/`, hooks in `core/react/`, useConnectionManager for connection state.
- **Finalized:** Code organization on Option A only; removed Option B and recommendation; state under `core/mcp/state/` is the chosen layout.
