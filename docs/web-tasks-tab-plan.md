# Web App: Tasks Tab Implementation Plan

Implement a **Tasks** tab in the inspector web app with parity to **inspector-main**, using `InspectorClient` and `useInspectorClient` instead of `useConnection`.

**Scope:** The Tasks tab is for **requestor tasks** only — tasks that we (the client) created on the server (e.g. via `tools/call` with task support), listed via `tasks/list` (`listRequestorTasks`). **Receiver tasks** (server-initiated, e.g. task-augmented `createMessage`/`elicit` where the server polls us) are a different flow and are not shown in this tab.

---

## 1. Mainline behavior (inspector-main)

### 1.1 TasksTab component

- **Path:** `inspector-main/client/src/components/TasksTab.tsx`
- **Layout:** Two panels: left 1/3 list (via `ListPane`), right 2/3 task details.
- **List:** `ListPane` with `items` = tasks, `listItems` = `listTasks`, `clearItems` = `clearTasks`, `buttonText` = `nextCursor ? "List More Tasks" : "List Tasks"`, `isButtonDisabled` = `!nextCursor && tasks.length > 0`, `renderItem` = status icon + taskId + status + lastUpdatedAt.
- **Detail panel:** Empty state (“No Task Selected” + “Refresh Tasks”); when selected: “Task Details” (ID, Cancel when status is `working` or `input_required`), grid (Status, Last Updated, Created At, TTL), optional Status Message, “Full Task Object” `JsonView`.
- **Status icons:** `TaskStatusIcon` for `working` (pulse), `input_required` (yellow), `completed` (green), `failed` (red), `cancelled` (gray), default (PlayCircle).
- **Props:** `tasks`, `listTasks`, `clearTasks`, `cancelTask(taskId)`, `selectedTask`, `setSelectedTask`, `error`, `nextCursor`.

### 1.2 How tasks stay up to date in mainline

Tasks are updated by the **server** (status changes, completion, cancellation). The client does not update them locally except in response to server notifications:

1. **`notifications/tasks/list_changed`**  
   App’s `onNotification` calls `listTasks()` to refetch the full list.

2. **`notifications/tasks/status`**  
   App’s `onNotification` receives the updated task and:
   - Merges it into `tasks` (replace by `taskId` or prepend if new).
   - Updates `selectedTask` if it’s the same task.

So the list and selection stay in sync only by reacting to these two server notifications. Refetch on tab load is for initial load; ongoing updates depend on these handlers.

---

## 2. Our project: existing pieces

- **InspectorClient:**
  - `listRequestorTasks(cursor?)` → `Promise<{ tasks: Task[]; nextCursor?: string }>`
  - `cancelRequestorTask(taskId)` → `Promise<void>` (updates internal cache and dispatches `taskCancelled`; does not return the updated task).
- **Events:**
  - `tasksChange: Task[]` — dispatched only after **we** call `listRequestorTasks` (our own list result).
  - `taskStatusChange: { taskId: string; task: Task }` — exists on the event map but is not currently dispatched when the **server** sends `notifications/tasks/status`.
  - No event or handler for **server** `notifications/tasks/list_changed`.
- **useInspectorClient:** Does not expose tasks or task events. App can call `inspectorClient.listRequestorTasks()` and `inspectorClient.cancelRequestorTask()`.
- **Web app:** Has `ListPane`, same UI stack, no Tasks tab, no `errors.tasks`, no `"tasks"` in `validTabsForNavigation`. `serverCapabilities?.tasks` is already used elsewhere (e.g. Tools “Run as task”).
- **Icon:** Mainline uses `ListTodo` for the Tasks trigger; we can add it from `lucide-react`.

---

## 3. Implementation plan

### 3.1 TasksTab component

- **File:** `web/src/components/TasksTab.tsx`
- Port mainline’s `TasksTab.tsx` with the same layout, props, and behavior:
  - Same `TabsContent value="tasks"`, left `ListPane`, right detail panel (empty state + selected task: header, Cancel button, grid, status message, full task `JsonView`).
  - Same `TaskStatusIcon` and status styling.
  - Props: `tasks`, `listTasks`, `clearTasks`, `cancelTask`, `selectedTask`, `setSelectedTask`, `error`, `nextCursor`.
- **Cancel:** After `await cancelTask(taskId)`, the parent is responsible for refreshing the list (our `cancelRequestorTask` returns `void`), so parent will call `listTasks()` after a successful cancel.

### 3.2 App state and handlers

- **State in `App.tsx`:**
  - `tasks: Task[]`
  - `nextTaskCursor: string | undefined`
  - `selectedTask: Task | null`
  - Include `tasks: null` in initial `errors`; use `errors.tasks` for the tab.
- **Handlers:**
  - **listTasks:** Call `inspectorClient.listRequestorTasks(nextTaskCursor)`; on success set `tasks`, `nextTaskCursor`, clear `errors.tasks`; on catch set `errors.tasks`.
  - **clearTasks:** `setTasks([])`, `setNextTaskCursor(undefined)`.
  - **cancelTask(taskId):** `await inspectorClient.cancelRequestorTask(taskId)`; on success clear `errors.tasks` and call `listTasks()` (or `listRequestorTasks(undefined)`) to refresh the list so the cancelled task shows updated status.
- **Tab load:** When user switches to the Tasks tab (or on first load with hash `tasks`), call `listRequestorTasks()` once so the list is loaded (parity with mainline “load when selecting tab”).
- **validTabsForNavigation:** Add `...(serverCapabilities?.tasks ? ["tasks"] : [])`.
- **Tab trigger:** Add `TabsTrigger value="tasks"` disabled when `!serverCapabilities?.tasks`, with `ListTodo` icon.
- **Render:** Add `<TasksTab ... />` with the same props as mainline, after ToolsTab (or same order as mainline).

### 3.3 Syncing when the server updates tasks (required for parity)

We handle tasks like other capabilities: when **`capabilities.tasks`** is present, subscribe to the relevant server notifications (same pattern as tools/resources/prompts and their list_changed handlers). No separate “open” design — use existing `capabilities.tasks`; no new config needed for parity (when the server supports tasks, we register the handlers).

1. **InspectorClient (core)**
   - When `capabilities?.tasks` is true, register notification handlers (same style as tools/resources/prompts list_changed):
     - **`notifications/tasks/list_changed`:** On receipt, either call `listRequestorTasks(undefined)` and dispatch `tasksChange` with the result, or dispatch a `tasksListChanged` event so the web App refetches. Follow the same choice as for tools/resources/prompts (e.g. dispatch event and let App refetch, or refetch inside client and dispatch `tasksChange`).
     - **`notifications/tasks/status`:** On receipt, dispatch `taskStatusChange: { taskId, task }` so the web App can merge the task and update `selectedTask` if it’s the same task.
   - Use the same capability gating as other list_changed handlers (register only when the server advertises the capability).

2. **Web App**
   - Subscribe to:
     - **tasks list_changed** (or `tasksChange` if client refetches and dispatches): set `tasks` and `nextTaskCursor` (e.g. by calling `listRequestorTasks(undefined)` if the client dispatched a “list changed” event).
     - **taskStatusChange:** merge the task into `tasks` by `taskId`; if `selectedTask?.taskId === taskId`, call `setSelectedTask(task)`.

### 3.4 Types and imports

- Use `Task` from `@modelcontextprotocol/sdk/types.js` in `TasksTab` and App.
- Add `ListTodo` from `lucide-react` for the tab trigger.
- Reuse existing imports for `ListPane`, `TabsContent`, `Alert`, `Button`, `JsonView`, `cn`, and other icons used in the ported `TasksTab`.

### 3.5 ListPane

- Use `buttonText={nextCursor ? "List More Tasks" : "List Tasks"}` and `isButtonDisabled={!nextCursor && tasks.length > 0}` so behavior matches mainline.

---

## 4. Summary checklist

| Item                     | Action                                                                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add `TasksTab.tsx`       | Port from mainline (same layout, props, `TaskStatusIcon`, detail panel, `JsonView`).                                                                                                                                                   |
| App state                | Add `tasks`, `nextTaskCursor`, `selectedTask`, `errors.tasks`.                                                                                                                                                                         |
| App handlers             | `listTasks` (uses `listRequestorTasks`), `clearTasks`, `cancelTask` (calls `cancelRequestorTask` then `listTasks()`).                                                                                                                  |
| Tab trigger              | Add `TabsTrigger value="tasks"` with `ListTodo`, disabled when `!serverCapabilities?.tasks`.                                                                                                                                           |
| validTabsForNavigation   | Include `"tasks"` when `serverCapabilities?.tasks`.                                                                                                                                                                                    |
| Render TasksTab          | Pass same props as mainline; get `inspectorClient` from existing hook/context.                                                                                                                                                         |
| Load on tab select       | When switching to Tasks tab, call `listRequestorTasks()` once.                                                                                                                                                                         |
| **Server notifications** | InspectorClient: when `capabilities.tasks`, register handlers for `notifications/tasks/list_changed` and `notifications/tasks/status` (same pattern as tools/resources/prompts). Dispatch events; App subscribes and refetches/merges. |

---

## 5. Implementation notes

- **No open design issues.** Design is: handle tasks like other capabilities; when `capabilities.tasks` is present, register the two notification handlers and dispatch events; App subscribes and updates state. Use existing `capabilities.tasks`; no new config.
- **SDK schemas:** When implementing, use the same notification method names and schemas as mainline (`notifications/tasks/list_changed`, `notifications/tasks/status`). If the SDK exports a schema for incoming task status (e.g. same as outbound `TaskStatusNotificationSchema`), use it; otherwise match the payload shape mainline expects.
- **Pagination after list_changed:** Refetch with `listRequestorTasks(undefined)` and replace the list with the first page (same as mainline).
