import type { CreateMessageRequest, CreateMessageResult } from "@modelcontextprotocol/sdk/types.js";
/**
 * Represents a pending sampling request from the server
 */
export declare class SamplingCreateMessage {
    private onRemove;
    readonly id: string;
    readonly timestamp: Date;
    readonly request: CreateMessageRequest;
    readonly taskId?: string;
    private resolvePromise?;
    private rejectPromise?;
    constructor(request: CreateMessageRequest, resolve: (result: CreateMessageResult) => void, reject: (error: Error) => void, onRemove: (id: string) => void);
    /**
     * Respond to the sampling request with a result
     */
    respond(result: CreateMessageResult): Promise<void>;
    /**
     * Reject the sampling request with an error
     */
    reject(error: Error): Promise<void>;
    /**
     * Remove this pending sample from the list
     */
    remove(): void;
}
//# sourceMappingURL=samplingCreateMessage.d.ts.map