import { RELATED_TASK_META_KEY } from "@modelcontextprotocol/sdk/types.js";
/**
 * Represents a pending sampling request from the server
 */
export class SamplingCreateMessage {
    onRemove;
    id;
    timestamp;
    request;
    taskId;
    resolvePromise;
    rejectPromise;
    constructor(request, resolve, reject, onRemove) {
        this.onRemove = onRemove;
        this.id = `sampling-${Date.now()}-${Math.random()}`;
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
    async respond(result) {
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
    async reject(error) {
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
    remove() {
        this.onRemove(this.id);
    }
}
//# sourceMappingURL=samplingCreateMessage.js.map