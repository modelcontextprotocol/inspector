# Task Support Design

## Overview

Tasks (SEP-1686) were introduced in the MCP November 2025 release (version 2025-11-25) to move MCP beyond simple "wait-and-response" tool calls. They provide a standardized "call-now, fetch-later" pattern for long-running operations like document analysis, database indexing, or complex agentic reasoning.

This document describes the task support implementation in `InspectorClient`.

### Scope: Tools First

**Current Implementation**: Task support is implemented for **tools** (`tools/call`), leveraging the SDK's first-class support via `client.experimental.tasks.callToolStream()`.

**Future Support**: At the protocol level, tasks could be supported for resources (`resources/read`) and prompts (`prompts/get`), but the SDK does not currently provide built-in support for these operations. The design is structured to allow adding support for these operations later if/when the SDK adds first-class support.

**Design Principle**: InspectorClient's task support wraps SDK methods rather than implementing protocol-level task handling directly. This ensures we leverage SDK features and maintain compatibility with SDK updates.

## Architecture

### SDK Integration

InspectorClient wraps the MCP TypeScript SDK's `client.experimental.tasks` API:

- **Streaming API**: `callToolStream()` uses the SDK's async generator pattern to receive real-time task updates
- **Task Management**: All task operations (`getTask`, `getTaskResult`, `cancelTask`, `listTasks`) delegate to SDK methods
- **State Management**: InspectorClient maintains a local cache of active tasks for UI display and event dispatching, but authoritative state always comes from the server via the SDK

### Event-Based API

InspectorClient uses an event-driven architecture for task lifecycle notifications:

- **Task Lifecycle Events**: `taskCreated`, `taskStatusChange`, `taskCompleted`, `taskFailed`, `taskCancelled`
- **Task List Events**: `tasksChange` (dispatched when `listTasks()` is called)
- **Tool Call Events**: `toolCallResultChange` (includes task results)

This pattern is consistent with InspectorClient's existing event system and works well for UI state management.

### Task State Tracking

InspectorClient maintains a `Map<taskId, Task>` cache of active tasks:

- **Cache Updates**: Tasks are added/updated when:
  - Task is created (from `callToolStream` `taskCreated` message)
  - Task status changes (from `callToolStream` `taskStatus` messages or `getTask()` calls)
  - Task completes/fails (from `callToolStream` `result`/`error` messages)
  - Tasks are listed (from `listTasks()` calls)
- **Cache Lifecycle**: Tasks are cleared on disconnect
- **Purpose**: The cache is for convenience and performance - authoritative state is always from the server via SDK

## API Reference

### Task-Aware Tool Execution

#### `callToolStream(name, args, generalMetadata?, toolSpecificMetadata?)`

Calls a tool using the task-capable streaming API. This method can be used on any tool, regardless of `execution.taskSupport`:

- **`taskSupport: "forbidden"`** → Returns immediate result (no task created)
- **`taskSupport: "optional"`** → Server decides: may create task or return immediately
- **`taskSupport: "required"`** → Will create a task (or fail if server doesn't support tasks)

**Message Flow**:

- **Task created**: Yields `taskCreated` → `taskStatus` updates → `result` (when complete)
- **Immediate result**: Yields `result` directly (no task created, but still uses streaming API)

**Returns**: `Promise<ToolCallInvocation>` with the final result

**Events Dispatched**:

- `taskCreated` - when a task is created
- `taskStatusChange` - on each status update
- `taskCompleted` - when task completes successfully
- `taskFailed` - when task fails
- `toolCallResultChange` - when tool call completes (with result or error)

#### `callTool(name, args, generalMetadata?, toolSpecificMetadata?)`

Calls a tool for immediate execution only. This method:

- **Fails** if tool has `execution.taskSupport: "required"` (must use `callToolStream()`)
- **Works** for tools with `taskSupport: "forbidden"` or `"optional"` (but won't create tasks)

**Rationale**: Provides explicit choice between immediate execution and task-capable execution.

### Task Management Methods

#### `getTask(taskId: string): Promise<Task>`

Retrieves the current status of a task by taskId.

**Events Dispatched**: `taskStatusChange`

#### `getTaskResult(taskId: string): Promise<CallToolResult>`

Retrieves the result of a completed task. The task must be in a terminal state (`completed`, `failed`, or `cancelled`).

**Note**: No event is dispatched - the task is already completed.

#### `cancelTask(taskId: string): Promise<void>`

Cancels a running task. The task must be in a non-terminal state.

**Events Dispatched**: `taskCancelled`

#### `listTasks(cursor?: string): Promise<{ tasks: Task[]; nextCursor?: string }>`

Lists all active tasks with optional pagination support.

**Events Dispatched**: `tasksChange` (with all tasks from the result)

### Task State Access

#### `getClientTasks(): Task[]`

Returns an array of all currently tracked tasks from the local cache. This is useful for UI display without constantly calling `listTasks()`.

**Note**: This returns cached tasks. For authoritative state, use `getTask()` or `listTasks()`.

### Capability Detection

#### `getTaskCapabilities(): { list: boolean; cancel: boolean } | undefined`

Returns the server's task capabilities, or `undefined` if tasks are not supported.

**Capabilities**:

- `list: true` - Server supports `tasks/list` method
- `cancel: true` - Server supports `tasks/cancel` method

## Task Lifecycle Events

All task events are dispatched via InspectorClient's event system:

```typescript
// Task created
taskCreated: { taskId: string; task: Task }

// Task status changed
taskStatusChange: { taskId: string; task: Task }

// Task completed successfully
taskCompleted: { taskId: string; result: CallToolResult }

// Task failed
taskFailed: { taskId: string; error: McpError }

// Task cancelled
taskCancelled: { taskId: string }

// Task list changed (from listTasks())
tasksChange: Task[]
```

**Usage Example**:

```typescript
client.addEventListener("taskCreated", (event) => {
  console.log("Task created:", event.detail.taskId);
});

client.addEventListener("taskStatusChange", (event) => {
  console.log("Task status:", event.detail.task.status);
});

client.addEventListener("taskCompleted", (event) => {
  console.log("Task completed:", event.detail.result);
});
```

## Elicitation and Sampling Integration

Tasks can require user input through elicitation or sampling requests. When a task needs input:

1. Server updates task status to `input_required`
2. Server sends an elicitation request (`elicitation/create`) or sampling request (`sampling/createMessage`) to the client
3. Server includes `related-task` metadata (`io.modelcontextprotocol/related-task: { taskId }`) in the request
4. When the client responds, the server:
   - Receives the response
   - Updates task status back to `working`
   - Continues task execution

### Implementation Details

**ElicitationCreateMessage** and **SamplingCreateMessage** both include an optional `taskId` field that is automatically extracted from the request metadata when present:

```typescript
// ElicitationCreateMessage
public readonly taskId?: string; // Extracted from request.params._meta[RELATED_TASK_META_KEY]?.taskId

// SamplingCreateMessage
public readonly taskId?: string; // Extracted from request.params._meta[RELATED_TASK_META_KEY]?.taskId
```

This allows UI clients to:

- Display which task is waiting for input
- Link elicitation/sampling UI to the associated task
- Show task status as `input_required` while waiting for user response

**Usage Example**:

```typescript
client.addEventListener("newPendingElicitation", (event) => {
  const elicitation = event.detail;
  if (elicitation.taskId) {
    // This elicitation is linked to a task
    const task = client
      .getClientTasks()
      .find((t) => t.taskId === elicitation.taskId);
    console.log("Task waiting for input:", task?.status); // "input_required"
  }
});
```

## Progress Notifications

Progress notifications can be linked to tasks via `related-task` metadata. When a server sends a progress notification with `related-task` metadata, the notification is associated with the specified task.

**Implementation**: Progress notifications are dispatched via the `progressNotification` event. The event includes metadata that may contain `related-task` information, allowing UI clients to link progress updates to specific tasks.

## Design Decisions

### 1. SDK-First Approach

**Decision**: Use SDK's `experimental.tasks` API directly, wrap with InspectorClient events.

**Rationale**:

- SDK handles all protocol details (JSON-RPC, polling, state management)
- No need to reimplement low-level functionality
- Ensures compatibility with SDK updates
- Reduces maintenance burden

### 2. Event-Based API

**Decision**: Use event-based API (consistent with existing InspectorClient patterns).

**Rationale**:

- InspectorClient already uses EventTarget pattern
- Events work well for UI state management (web client, TUI, etc.)
- Allows multiple listeners for the same task
- Consistent with existing patterns (sampling, elicitation)

### 3. Task State Tracking

**Decision**: Track tasks created through InspectorClient's API, but rely on SDK/server for authoritative state.

**Rationale**:

- SDK does not maintain an in-memory cache of tasks
- We receive task status updates through `callToolStream()` messages - we should cache these for event dispatching
- UI needs to display tasks without constantly calling `listTasks()`
- Tasks created through our API should be tracked to link them to tool calls and dispatch events
- For tasks created outside our API (e.g., by other clients), we can use `listTasks()` when needed

### 4. Streaming vs. Polling

**Decision**: Use SDK's streaming API (`callToolStream`) as primary method, with polling methods as fallback.

**Rationale**:

- Streaming API provides real-time updates via async generator
- More efficient than manual polling
- SDK handles all the complexity
- Polling methods (`getTask`) available for manual refresh

### 5. Elicitation and Sampling Integration

**Decision**: Link elicitations and sampling requests to tasks via `related-task` metadata when task is `input_required`.

**Rationale**:

- Provides seamless UX for task input requirements
- Maintains relationship between task and elicitation/sampling requests
- Server handles task resumption after input provided
- Both elicitation and sampling work the same way: server sets task to `input_required`, sends request with `related-task` metadata, then resumes when client responds

## Tool Support Hints

Tools can declare their task support requirements via `execution.taskSupport`:

- **`"required"`**: Tool must be called via `callToolStream()` - will always create a task
- **`"optional"`**: Tool may be called via `callTool()` or `callToolStream()` - server decides whether to create a task
- **`"forbidden"`**: Tool must be called via `callTool()` - will never create a task (immediate return)

**Access**: Tool definitions returned by `listTools()` or `listAllTools()` include `execution?.taskSupport`.

**Example**:

```typescript
const tools = await client.listAllTools();
const tool = tools.find((t) => t.name === "myTool");
if (tool?.execution?.taskSupport === "required") {
  // Must use callToolStream()
  const result = await client.callToolStream("myTool", {});
} else {
  // Can use callTool() for immediate execution
  const result = await client.callTool("myTool", {});
}
```

## References

- MCP Specification: [Tasks (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)
- MCP SDK TypeScript: `@modelcontextprotocol/sdk/experimental/tasks`
- SDK Client API: `client.experimental.tasks`
- ResponseMessage Types: `@modelcontextprotocol/sdk/shared/responseMessage`
- SDK Task Types: `@modelcontextprotocol/sdk/experimental/tasks/types`
- Related Task Metadata: `io.modelcontextprotocol/related-task` (from spec types)
