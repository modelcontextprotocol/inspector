import type {
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/client";
import { RELATED_TASK_META_KEY } from "@modelcontextprotocol/client";
import type { PendingRequestOrigin } from "./types.js";

export type { CreateMessageRequest, CreateMessageResult };

/**
 * Data shape of a pending sampling request tracked by the InspectorClient.
 * v2's state/screen layer consumes this interface; the runtime class below
 * (SamplingCreateMessage) implements it.
 */
export interface InspectorPendingSampling {
  id: string;
  timestamp: Date;
  request: CreateMessageRequest;
  taskId?: string;
  origin: PendingRequestOrigin;
}

/**
 * Represents a pending sampling request from the server
 */
export class SamplingCreateMessage {
  public readonly id: string;
  public readonly timestamp: Date;
  public readonly request: CreateMessageRequest;
  public readonly taskId?: string;
  /**
   * How this request reached the Inspector — a legacy server→client request or
   * a modern MRTR `input_required` round. Drives era-accurate copy in the
   * pending-request UI. Defaults to `"server-request"` so existing call sites
   * (and stories) keep the legacy semantics unchanged.
   */
  public readonly origin: PendingRequestOrigin;
  private resolvePromise?: (result: CreateMessageResult) => void;
  private rejectPromise?: (error: Error) => void;
  private onRemove: (id: string) => void;

  constructor(
    request: CreateMessageRequest,
    resolve: (result: CreateMessageResult) => void,
    reject: (error: Error) => void,
    onRemove: (id: string) => void,
    origin: PendingRequestOrigin = "server-request",
  ) {
    this.onRemove = onRemove;
    this.id = `sampling-${crypto.randomUUID()}`;
    this.timestamp = new Date();
    this.request = request;
    // Extract taskId from request params metadata if present
    const relatedTask = request.params?._meta?.[RELATED_TASK_META_KEY];
    this.taskId = relatedTask?.taskId;
    this.origin = origin;
    this.resolvePromise = resolve;
    this.rejectPromise = reject;
  }

  /**
   * Respond to the sampling request with a result
   */
  async respond(result: CreateMessageResult): Promise<void> {
    if (!this.resolvePromise) {
      throw new Error("Request already resolved or rejected");
    }
    this.resolvePromise(result);
    this.resolvePromise = undefined;
    this.rejectPromise = undefined;
    // Remove from pending list after responding
    this.remove();
  }

  /**
   * Reject the sampling request with an error
   */
  async reject(error: Error): Promise<void> {
    if (!this.rejectPromise) {
      throw new Error("Request already resolved or rejected");
    }
    this.rejectPromise(error);
    this.resolvePromise = undefined;
    this.rejectPromise = undefined;
    // Remove from pending list after rejecting
    this.remove();
  }

  /**
   * Settle a still-pending sample as cancelled, without removing it from the
   * queue. Called from `InspectorClient`'s `clearPendingPeerRequests()`, which
   * serves all three teardown paths — an explicit `disconnect()`, a failed
   * `connect()`, and a mid-session transport close.
   *
   * Unlike an elicitation there is no internal awaiter to unblock, but on the
   * plain server-request shape the *server* is one: we accepted its
   * `sampling/createMessage`, so dropping the request without settling means no
   * response frame is ever written and it waits forever. That is reachable when
   * the transport outlives the failed attempt — `connect()` keeps it when an
   * auth provider holds it open — so settle rather than discard. Rejecting is
   * the right settle: it is what the UI's decline path sends, and the SDK turns
   * it into a JSON-RPC error response. No-op once already resolved.
   *
   * A *task-augmented* sample sits in the same queue but already answered the
   * wire request synchronously with a `CreateTaskResult`, so nothing is waiting
   * on a frame; settling there is about not leaving the task in
   * `input_required` limbo. Its reject reaches the receiver task's payload
   * promise, which `InspectorClient` marks handled at creation for exactly this
   * reason.
   *
   * Deliberately does not call `onRemove`, for the same reason as
   * `ElicitationCreateMessage.cancel()`: the caller iterates the queue and
   * clears it itself, so removing here would splice mid-iteration — skipping
   * every other entry and leaving those requests unanswered.
   */
  cancel(): void {
    if (this.rejectPromise) {
      this.rejectPromise(new Error("Connection torn down"));
    }
    this.resolvePromise = undefined;
    this.rejectPromise = undefined;
  }

  /**
   * Remove this pending sample from the list
   */
  remove(): void {
    this.onRemove(this.id);
  }
}
