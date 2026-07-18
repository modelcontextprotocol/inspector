import type { ElicitRequest, ElicitResult } from "@modelcontextprotocol/client";
import { RELATED_TASK_META_KEY } from "@modelcontextprotocol/client";
import type { PendingRequestOrigin } from "./types.js";

export type { ElicitRequest, ElicitResult };

/**
 * Data shape of a pending elicitation request tracked by the InspectorClient.
 * v2's state/screen layer consumes this interface; the runtime class below
 * (ElicitationCreateMessage) implements it.
 */
export interface InspectorPendingElicitation {
  id: string;
  timestamp: Date;
  request: ElicitRequest;
  taskId?: string;
  origin: PendingRequestOrigin;
}

/**
 * Represents a pending elicitation request from the server
 */
export class ElicitationCreateMessage {
  public readonly id: string;
  public readonly timestamp: Date;
  public readonly request: ElicitRequest;
  public readonly taskId?: string;
  /**
   * How this request reached the Inspector — a legacy server→client request or
   * a modern MRTR `input_required` round. Drives era-accurate copy in the
   * pending-request UI. Defaults to `"server-request"` so existing call sites
   * (and stories) keep the legacy semantics unchanged.
   */
  public readonly origin: PendingRequestOrigin;
  private resolvePromise?: (result: ElicitResult) => void;
  /**
   * Rejects the originating call with an error. Set for task-augmented elicit
   * (so the server's `tasks/result` receives the error on decline) and for
   * MRTR-driven elicitations (so a genuine failure aborts the tool call).
   */
  private rejectCallback?: (error: Error) => void;
  private onRemove: (id: string) => void;

  constructor(
    request: ElicitRequest,
    resolve: (result: ElicitResult) => void,
    onRemove: (id: string) => void,
    reject?: (error: Error) => void,
    origin: PendingRequestOrigin = "server-request",
  ) {
    this.onRemove = onRemove;
    this.id = `elicitation-${crypto.randomUUID()}`;
    this.timestamp = new Date();
    this.request = request;
    // Extract taskId from request params metadata if present
    const relatedTask = request.params?._meta?.[RELATED_TASK_META_KEY];
    this.taskId = relatedTask?.taskId;
    this.origin = origin;
    this.resolvePromise = resolve;
    this.rejectCallback = reject;
  }

  /**
   * Reject the elicitation (e.g. when user declines). Only has effect when this
   * request was task-augmented; then the server's tasks/result will receive the error.
   */
  reject(error: Error): void {
    if (this.rejectCallback) {
      this.rejectCallback(error);
      this.rejectCallback = undefined;
    }
  }

  /**
   * Respond to the elicitation request with a result
   */
  async respond(result: ElicitResult): Promise<void> {
    if (!this.resolvePromise) {
      throw new Error("Request already resolved");
    }
    this.resolvePromise(result);
    this.resolvePromise = undefined;
    // Remove from pending list after responding
    this.remove();
  }

  /**
   * Resolve this elicitation as accepted, but only if it is still pending.
   *
   * Used by the URL-mode `notifications/elicitation/complete` handler to
   * auto-advance an open URL elicitation when the server signals the
   * out-of-band flow finished. It is a no-op once the user has already
   * responded — that guard (plus the modal's own once-guard) keeps `respond()`
   * from throwing its "already resolved" error on a race between the manual
   * "I've completed it" click and the server's completion notification.
   */
  completeIfPending(): void {
    if (this.resolvePromise) {
      void this.respond({ action: "accept" });
    }
  }

  /**
   * Settle a still-pending elicitation as cancelled, without removing it from
   * the queue. Used by `disconnect()` teardown so an awaiting caller — notably
   * the error-path `awaitUrlElicitation` that blocks `callTool` — doesn't hang
   * forever when the pending queue is dropped wholesale. No-op once already
   * resolved; deliberately does not call `onRemove` (the caller clears the
   * queue itself, so we must not splice it mid-iteration).
   */
  cancel(): void {
    if (this.resolvePromise) {
      this.resolvePromise({ action: "cancel" });
      this.resolvePromise = undefined;
    }
    this.rejectCallback = undefined;
  }

  /**
   * Remove this pending elicitation from the list
   */
  remove(): void {
    this.onRemove(this.id);
  }
}
