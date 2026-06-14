/**
 * Thrown by `InspectorClient.callTool` when the in-flight ordinary (non-task)
 * tool call is cancelled via `cancelToolCall()`. By the time this is thrown the
 * SDK has already sent the `notifications/cancelled` to the server (the MCP
 * cancellation flow) and rejected the underlying request; `callTool` converts
 * that rejection into this error so the web layer can clear the executing state
 * as a clean cancellation instead of surfacing a generic failure — and so the
 * cancelled call is *not* recorded as a failed call in request history.
 *
 * Task-augmented calls have a server-side task and are cancelled via
 * `cancelRequestorTask()` instead, so they never produce this error.
 */
export class ToolCallCancelledError extends Error {
  /** The name of the tool whose call was cancelled, when known. */
  readonly toolName?: string;

  constructor(toolName?: string) {
    super(
      toolName
        ? `Tool call "${toolName}" was cancelled.`
        : "Tool call was cancelled.",
    );
    this.name = "ToolCallCancelledError";
    this.toolName = toolName;
  }
}
