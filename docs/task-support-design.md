# Task Support Design and Implementation Plan

## Overview

Tasks (SEP-1686) were introduced in the MCP November 2025 release (version 2025-11-25) to move MCP beyond simple "wait-and-response" tool calls. They provide a standardized "call-now, fetch-later" pattern for long-running operations like document analysis, database indexing, or complex agentic reasoning.

This document outlines the design and implementation plan for adding Task support to InspectorClient and the TUI.

### Scope: Tools First, Resources and Prompts Later

**Current Focus**: This implementation focuses on task support for **tools** (`tools/call`), as the SDK provides first-class support via `client.experimental.tasks.callToolStream()`.

**Future Support**: At the protocol level, tasks could be supported for:

- **Resources** (`resources/read`) - for long-running resource processing
- **Prompts** (`prompts/get`) - for prompt generation that requires processing

However, the SDK does not currently provide built-in support for task-augmented resource or prompt requests. The design is structured to allow adding support for these operations later if/when the SDK adds first-class support (e.g., `client.experimental.tasks.readResourceStream()` or similar methods).

**Design Principle**: InspectorClient's task support will wrap SDK methods rather than implementing protocol-level task handling directly. This ensures we leverage SDK features and maintain compatibility with SDK updates.

## SDK API Overview

The MCP TypeScript SDK provides task support through `client.experimental.tasks`:

### Key Methods

- **`callToolStream(params, resultSchema?, options?)`**: Calls a tool and returns an `AsyncGenerator<ResponseMessage>` that yields:
  - `taskCreated` - when a task is created (contains `task: Task`)
  - `taskStatus` - status updates (contains `task: Task`)
  - `result` - final result when task completes
  - `error` - error if task fails
- **`getTask(taskId, options?)`**: Gets current task status (`GetTaskResult`)
- **`getTaskResult(taskId, resultSchema?, options?)`**: Retrieves result of completed task
- **`listTasks(cursor?, options?)`**: Lists tasks with pagination
- **`cancelTask(taskId, options?)`**: Cancels a running task

### ResponseMessage Types

```typescript
type ResponseMessage<T extends Result> =
  | TaskCreatedMessage // { type: 'taskCreated', task: Task }
  | TaskStatusMessage // { type: 'taskStatus', task: Task }
  | ResultMessage<T> // { type: 'result', result: T }
  | ErrorMessage; // { type: 'error', error: McpError }
```

The SDK handles all low-level protocol details (JSON-RPC, polling, state management).

## Implementation Plan

### Phase 1: InspectorClient Core Support

#### 1.1 SDK Integration

**Goal**: Wrap SDK's `client.experimental.tasks` API with InspectorClient's event-based pattern.

**Implementation**:

- Access SDK tasks via `this.client.experimental.tasks` (already available after `connect()`)
- Wrap SDK methods to dispatch InspectorClient events
- Track active tasks in a `Map<taskId, Task>` for event dispatching

#### 1.2 Task-Aware Tool Calls

**Goal**: Add explicit method for task-based tool execution, separate from immediate execution.

**Implementation**:

- Keep existing `callTool(name, args, metadata?, options?)` for immediate execution (wraps SDK's `client.callTool()`)
  - Fails if tool has `execution.taskSupport: "required"` (must use `callToolStream()`)
  - Works for tools with `taskSupport: "forbidden"` or `"optional"` (but won't create tasks)
- Add new `callToolStream(name, args, metadata?, options?)` method for task-based execution that:
  - Calls `client.experimental.tasks.callToolStream()`
  - Iterates the async generator
  - Dispatches events for each message type
  - Returns the final result or throws on error
  - **Can be used on any tool**, regardless of `taskSupport`:
    - `taskSupport: "forbidden"` → Returns immediate result (no task created)
    - `taskSupport: "optional"` → Server decides: may create task or return immediately
    - `taskSupport: "required"` → Will create a task (or fail if server doesn't support tasks)
  - Message flow:
    - **Task created**: Yields `taskCreated` → `taskStatus` updates → `result` (when complete)
    - **Immediate result**: Yields `result` directly (no task created, but still uses streaming API)
- **Explicit choice**: Users must choose between:
  - `callTool()` - immediate execution only (fails if tool requires tasks)
  - `callToolStream()` - task-capable execution (handles all cases via streaming API)

**Event Flow**:

```typescript
// When taskCreated message received:
dispatchTypedEvent("taskCreated", { taskId, task });

// When taskStatus message received:
dispatchTypedEvent("taskStatusChange", { taskId, task });

// When result message received:
dispatchTypedEvent("taskCompleted", { taskId, result });

// When error message received:
dispatchTypedEvent("taskFailed", { taskId, error });
```

#### 1.3 Task Management Methods

**Goal**: Expose SDK task methods through InspectorClient.

**Implementation**:

- `getTask(taskId)`: Wraps `client.experimental.tasks.getTask()`, dispatches `taskStatusChange` event
- `getTaskResult(taskId)`: Wraps `client.experimental.tasks.getTaskResult()`
- `cancelTask(taskId)`: Wraps `client.experimental.tasks.cancelTask()`, dispatches `taskCancelled` event
- `listTasks(cursor?)`: Wraps `client.experimental.tasks.listTasks()`, dispatches `tasksChange` event

#### 1.4 Event System Integration

**Goal**: Dispatch events for task lifecycle changes.

**Implementation**:
Add to `InspectorClientEventMap`:

```typescript
taskCreated: { taskId: string; task: Task }
taskStatusChange: { taskId: string; task: Task }
taskCompleted: { taskId: string; result: CallToolResult }
taskFailed: { taskId: string; error: McpError }
taskCancelled: { taskId: string }
tasksChange: Task[] // All tasks from listTasks()
```

#### 1.5 Task State Tracking

**Goal**: Track active tasks for UI display and event dispatching.

**Implementation**:

- Add `private activeTasks: Map<string, Task>` to InspectorClient
- Update map when:
  - Task created (from `callToolStream`)
  - Task status changes (from `taskStatus` messages or `getTask`)
  - Task completed/failed/cancelled
- Clear tasks on disconnect
- Optionally: Use `listTasks()` on reconnect to recover tasks (if server supports it)

#### 1.6 Elicitation and Sampling Integration

**Goal**: Link elicitation and sampling requests to tasks when task enters `input_required` state.

**How it works**:

- When a task needs user input, the server:
  1. Updates task status to `input_required`
  2. Sends an elicitation request (`elicitation/create`) or sampling request (`sampling/createMessage`) to the client
  3. Includes `related-task` metadata (`io.modelcontextprotocol/related-task: { taskId }`) in the request
- When the client responds to the elicitation/sampling request, the server:
  1. Receives the response
  2. Updates task status back to `working`
  3. Continues task execution

**Implementation**:

- When task status becomes `input_required`, check for related elicitation or sampling request via `related-task` metadata
- Link elicitation/sampling to task in `ElicitationCreateMessage`/`SamplingCreateMessage`
- When elicitation/sampling is responded to, task automatically resumes (handled by server)
- Track relationship: `taskId -> elicitationId` or `taskId -> samplingId` mapping

#### 1.7 Capability Detection

**Goal**: Detect task support capabilities.

**Implementation**:

- Check `serverCapabilities.tasks` for `{ list: true, cancel: true }` to determine if server supports tasks
- Tool definitions already include `execution.taskSupport` hint (`required`, `optional`, `forbidden`) - no separate lookup method needed
- Users can check `tool.execution?.taskSupport` directly from tool definitions returned by `listTools()` or `listAllTools()`

### Phase 2: TUI Support

#### 2.1 Task Display

**Goal**: Show active tasks in TUI.

**Tasks**:

- Add "Tasks" tab or section to TUI
- Display task list with:
  - Task ID
  - Status (with visual indicators)
  - Created/updated timestamps
  - Related tool call (if available)
- Show task details in modal or expandable view
- Display task results when completed
- Show error messages when failed

#### 2.2 Task Actions

**Goal**: Allow users to interact with tasks in TUI.

**Tasks**:

- Cancel task action (calls `cancelTask()`)
- View task result (calls `getTaskResult()`)
- Handle `input_required` state (link to elicitation UI)
- Auto-refresh task status (poll via `getTask()` or listen to events)

#### 2.3 Tool Call Integration

**Goal**: Update TUI tool call flow to support tasks.

**Tasks**:

- Detect task-supporting tools (via `execution.taskSupport` hint)
- Show option to "Call as Task" for supported tools
- When tool call returns a task (via `callToolStream`), show task status instead of immediate result
- Link tool calls to tasks in history

## Design Decisions

### 1. SDK-First Approach

**Decision**: Use SDK's `experimental.tasks` API directly, wrap with InspectorClient events.

**Rationale**:

- SDK handles all protocol details (JSON-RPC, polling, state management)
- No need to reimplement low-level functionality
- Ensures compatibility with SDK updates
- Reduces maintenance burden

**Implementation**:

- All task operations go through `client.experimental.tasks`
- InspectorClient wraps SDK calls and dispatches events
- No custom TaskHandle class needed - SDK's streaming API is sufficient

### 2. Event-Based API

**Decision**: Use event-based API (consistent with existing InspectorClient patterns).

**Rationale**:

- InspectorClient already uses EventTarget pattern
- Events work well for TUI state management
- Allows multiple listeners for the same task
- Consistent with existing patterns (sampling, elicitation)

**Implementation**:

- Dispatch events for all task lifecycle changes
- TUI listens to events to update UI
- No callback-based API needed

### 3. Task State Tracking

**Decision**: Track tasks created through InspectorClient's API, but rely on SDK/server for authoritative state.

**Rationale**:

- SDK does not maintain an in-memory cache of tasks - you must call `getTask()` or `listTasks()` to get task state
- We receive task status updates through `callToolStream()` messages - we should cache these for event dispatching
- UI needs to display tasks without constantly calling `listTasks()`
- Tasks created through our API should be tracked to link them to tool calls and dispatch events
- For tasks created outside our API (e.g., by other clients), we can use `listTasks()` when needed

**Implementation**:

- Use `Map<taskId, Task>` in InspectorClient to track tasks we've seen
- Update map when:
  - Task created (from `callToolStream` `taskCreated` message)
  - Task status changes (from `callToolStream` `taskStatus` messages)
  - Task completed/failed (from `callToolStream` `result`/`error` messages)
  - Task status fetched via `getTask()` (update cache)
- Clear tasks on disconnect
- Use `listTasks()` to discover tasks created outside our API (e.g., on reconnect)
- Cache is for convenience/performance - authoritative state is always from server via SDK

### 4. Streaming vs. Polling

**Decision**: Use SDK's streaming API (`callToolStream`) as primary method, with polling methods as fallback.

**Rationale**:

- Streaming API provides real-time updates via async generator
- More efficient than manual polling
- SDK handles all the complexity
- Polling methods (`getTask`) available for manual refresh

**Implementation**:

- `callToolStream()` is the primary method for task-based tool calls
- `getTask()` available for manual status checks
- TUI can use either approach (streaming for new calls, polling for refresh)

### 5. Elicitation and Sampling Integration

**Decision**: Link elicitations and sampling requests to tasks via `related-task` metadata when task is `input_required`.

**Rationale**:

- Provides seamless UX for task input requirements
- Maintains relationship between task and elicitation/sampling requests
- Server handles task resumption after input provided
- Both elicitation and sampling work the same way: server sets task to `input_required`, sends request with `related-task` metadata, then resumes when client responds

**Implementation**:

- When task status becomes `input_required`, check for related elicitation or sampling request via `related-task` metadata
- Link elicitation/sampling to task in `ElicitationCreateMessage`/`SamplingCreateMessage`
- Track relationship for UI display (`taskId -> elicitationId` or `taskId -> samplingId`)

## Testing Strategy

### Unit Tests

- [ ] Test `callToolStream()` with task creation
- [ ] Test event dispatching for task lifecycle
- [ ] Test `getTask()`, `getTaskResult()`, `cancelTask()`, `listTasks()`
- [ ] Test elicitation integration
- [ ] Test capability detection

### Integration Tests

- [ ] Test with mock MCP server that supports tasks
- [ ] Test task creation from tool calls
- [ ] Test streaming updates
- [ ] Test cancellation
- [ ] Test `input_required` → elicitation → resume flow

### TUI Tests

- [ ] Test task display in TUI
- [ ] Test task actions (cancel, view result)
- [ ] Test tool call integration
- [ ] Test elicitation integration

## References

- MCP Specification: [Tasks (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)
- MCP SDK TypeScript: `@modelcontextprotocol/sdk/experimental/tasks`
- SDK Client API: `client.experimental.tasks`
- ResponseMessage Types: `@modelcontextprotocol/sdk/shared/responseMessage`

## Next Steps

1. **Implement Phase 1.1-1.4**: SDK integration and basic task methods
2. **Test**: Verify with mock task-supporting server
3. **Implement Phase 1.5-1.7**: State tracking, elicitation, capabilities
4. **Implement Phase 2**: TUI support
5. **Documentation**: Update user documentation and examples
