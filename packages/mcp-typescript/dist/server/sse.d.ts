import { IncomingMessage, ServerResponse } from "node:http";
import { Transport } from "../shared/transport.js";
import { JSONRPCMessage } from "../types.js";
/**
 * Server transport for SSE: this will send messages over an SSE connection and receive messages from HTTP POST requests.
 *
 * This transport is only available in Node.js environments.
 */
export declare class SSEServerTransport implements Transport {
    private _endpoint;
    private res;
    private _sseResponse?;
    private _sessionId;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;
    /**
     * Creates a new SSE server transport, which will direct the client to POST messages to the relative or absolute URL identified by `_endpoint`.
     */
    constructor(_endpoint: string, res: ServerResponse);
    /**
     * Handles the initial SSE connection request.
     *
     * This should be called when a GET request is made to establish the SSE stream.
     */
    start(): Promise<void>;
    /**
     * Handles incoming POST messages.
     *
     * This should be called when a POST request is made to send a message to the server.
     */
    handlePostMessage(req: IncomingMessage, res: ServerResponse): Promise<void>;
    /**
     * Handle a client message, regardless of how it arrived. This can be used to inform the server of messages that arrive via a means different than HTTP POST.
     */
    handleMessage(message: unknown): Promise<void>;
    close(): Promise<void>;
    send(message: JSONRPCMessage): Promise<void>;
    /**
     * Returns the session ID for this transport.
     *
     * This can be used to route incoming POST requests.
     */
    get sessionId(): string;
}
//# sourceMappingURL=sse.d.ts.map