import type { ElicitRequest, ElicitResult } from "@modelcontextprotocol/sdk/types.js";
/**
 * Represents a pending elicitation request from the server
 */
export declare class ElicitationCreateMessage {
    private onRemove;
    readonly id: string;
    readonly timestamp: Date;
    readonly request: ElicitRequest;
    readonly taskId?: string;
    private resolvePromise?;
    constructor(request: ElicitRequest, resolve: (result: ElicitResult) => void, onRemove: (id: string) => void);
    /**
     * Respond to the elicitation request with a result
     */
    respond(result: ElicitResult): Promise<void>;
    /**
     * Remove this pending elicitation from the list
     */
    remove(): void;
}
//# sourceMappingURL=elicitationCreateMessage.d.ts.map