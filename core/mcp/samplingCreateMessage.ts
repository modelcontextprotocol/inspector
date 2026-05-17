import type {
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";
import { RELATED_TASK_META_KEY } from "@modelcontextprotocol/sdk/types.js";

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
}

/**
 * Represents a pending sampling request from the server
 */
export class SamplingCreateMessage {
  public readonly id: string;
  public readonly timestamp: Date;
  public readonly request: CreateMessageRequest;
  public readonly taskId?: string;
  private resolvePromise?: (result: CreateMessageResult) => void;
  private rejectPromise?: (error: Error) => void;
  private onRemove: (id: string) => void;

  constructor(
    request: CreateMessageRequest,
    resolve: (result: CreateMessageResult) => void,
    reject: (error: Error) => void,
    onRemove: (id: string) => void,
  ) {
    this.onRemove = onRemove;
    this.id = `sampling-${crypto.randomUUID()}`;
    this.timestamp = new Date();
    this.request = request;
    // Extract taskId from request params metadata if present
    const relatedTask = request.params?._meta?.[RELATED_TASK_META_KEY];
    this.taskId = relatedTask?.taskId;
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
   * Remove this pending sample from the list
   */
  remove(): void {
    this.onRemove(this.id);
  }
}
