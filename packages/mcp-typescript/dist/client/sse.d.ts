import { Transport } from "../shared/transport.js";
import { JSONRPCMessage } from "../types.js";
/**
 * Client transport for SSE: this will connect to a server using Server-Sent Events for receiving
 * messages and make separate POST requests for sending messages.
 *
 * This uses the EventSource API in browsers. You can install the `eventsource` package for Node.js.
 */
export declare class SSEClientTransport implements Transport {
    private _eventSource?;
    private _endpoint?;
    private _abortController?;
    private _url;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;
    constructor(url: URL);
    start(): Promise<void>;
    close(): Promise<void>;
    send(message: JSONRPCMessage): Promise<void>;
}
//# sourceMappingURL=sse.d.ts.map