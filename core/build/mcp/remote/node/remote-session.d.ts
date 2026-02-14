/**
 * Remote session - holds a transport and event queue for a remote client.
 */
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { FetchRequestEntryBase } from "../../types.js";
import type { RemoteEvent } from "../types.js";
export interface SessionEvent {
    type: RemoteEvent["type"];
    data: unknown;
}
export declare class RemoteSession {
    readonly sessionId: string;
    transport: Transport;
    private eventQueue;
    private eventConsumer;
    private transportDead;
    private transportError;
    constructor(sessionId: string);
    setTransport(transport: Transport): void;
    setEventConsumer(consumer: (event: SessionEvent) => void): void;
    clearEventConsumer(): boolean;
    markTransportDead(error: string): void;
    isTransportDead(): boolean;
    getTransportError(): string | null;
    hasEventConsumer(): boolean;
    pushEvent(event: SessionEvent): void;
    onMessage(message: JSONRPCMessage): void;
    onFetchRequest(entry: FetchRequestEntryBase): void;
    onStderr(entry: {
        timestamp: Date;
        message: string;
    }): void;
}
//# sourceMappingURL=remote-session.d.ts.map