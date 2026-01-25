import type {
  ElicitRequest,
  ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";
import { RELATED_TASK_META_KEY } from "@modelcontextprotocol/sdk/types.js";

/**
 * Represents a pending elicitation request from the server
 */
export class ElicitationCreateMessage {
  public readonly id: string;
  public readonly timestamp: Date;
  public readonly request: ElicitRequest;
  public readonly taskId?: string;
  private resolvePromise?: (result: ElicitResult) => void;

  constructor(
    request: ElicitRequest,
    resolve: (result: ElicitResult) => void,
    private onRemove: (id: string) => void,
  ) {
    this.id = `elicitation-${Date.now()}-${Math.random()}`;
    this.timestamp = new Date();
    this.request = request;
    // Extract taskId from request params metadata if present
    const relatedTask = request.params?._meta?.[RELATED_TASK_META_KEY];
    this.taskId = relatedTask?.taskId;
    this.resolvePromise = resolve;
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
   * Remove this pending elicitation from the list
   */
  remove(): void {
    this.onRemove(this.id);
  }
}
