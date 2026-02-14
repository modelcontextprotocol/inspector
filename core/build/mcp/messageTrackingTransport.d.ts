import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";
import type { JSONRPCRequest, JSONRPCNotification, JSONRPCResultResponse, JSONRPCErrorResponse } from "@modelcontextprotocol/sdk/types.js";
export interface MessageTrackingCallbacks {
    trackRequest?: (message: JSONRPCRequest) => void;
    trackResponse?: (message: JSONRPCResultResponse | JSONRPCErrorResponse) => void;
    trackNotification?: (message: JSONRPCNotification) => void;
}
export declare class MessageTrackingTransport implements Transport {
    private baseTransport;
    private callbacks;
    constructor(baseTransport: Transport, callbacks: MessageTrackingCallbacks);
    start(): Promise<void>;
    send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void>;
    close(): Promise<void>;
    get onclose(): (() => void) | undefined;
    set onclose(handler: (() => void) | undefined);
    get onerror(): ((error: Error) => void) | undefined;
    set onerror(handler: ((error: Error) => void) | undefined);
    get onmessage(): (<T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void) | undefined;
    set onmessage(handler: (<T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void) | undefined);
    get sessionId(): string | undefined;
    get setProtocolVersion(): ((version: string) => void) | undefined;
}
//# sourceMappingURL=messageTrackingTransport.d.ts.map