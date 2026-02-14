import { RELATED_TASK_META_KEY } from "@modelcontextprotocol/sdk/types.js";
/**
 * Represents a pending elicitation request from the server
 */
export class ElicitationCreateMessage {
    onRemove;
    id;
    timestamp;
    request;
    taskId;
    resolvePromise;
    constructor(request, resolve, onRemove) {
        this.onRemove = onRemove;
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
    async respond(result) {
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
    remove() {
        this.onRemove(this.id);
    }
}
//# sourceMappingURL=elicitationCreateMessage.js.map