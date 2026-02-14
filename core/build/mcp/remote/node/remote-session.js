/**
 * Remote session - holds a transport and event queue for a remote client.
 */
export class RemoteSession {
    sessionId;
    transport;
    eventQueue = [];
    eventConsumer = null;
    transportDead = false;
    transportError = null;
    constructor(sessionId) {
        this.sessionId = sessionId;
    }
    setTransport(transport) {
        this.transport = transport;
    }
    setEventConsumer(consumer) {
        this.eventConsumer = consumer;
        // Flush queued events
        while (this.eventQueue.length > 0) {
            const ev = this.eventQueue.shift();
            consumer(ev);
        }
    }
    clearEventConsumer() {
        this.eventConsumer = null;
        // If transport is dead and no client connected, signal to cleanup
        return this.transportDead;
    }
    markTransportDead(error) {
        this.transportDead = true;
        this.transportError = error;
        // Send error event if client is connected
        if (this.eventConsumer) {
            this.pushEvent({
                type: "transport_error",
                data: {
                    error,
                    code: -32000, // MCP error code for connection closed
                },
            });
        }
    }
    isTransportDead() {
        return this.transportDead;
    }
    getTransportError() {
        return this.transportError;
    }
    hasEventConsumer() {
        return this.eventConsumer !== null;
    }
    pushEvent(event) {
        if (this.eventConsumer) {
            this.eventConsumer(event);
        }
        else {
            this.eventQueue.push(event);
        }
    }
    onMessage(message) {
        this.pushEvent({ type: "message", data: message });
    }
    onFetchRequest(entry) {
        this.pushEvent({
            type: "fetch_request",
            data: {
                ...entry,
                timestamp: entry.timestamp instanceof Date
                    ? entry.timestamp.toISOString()
                    : entry.timestamp,
            },
        });
    }
    onStderr(entry) {
        this.pushEvent({
            type: "stdio_log",
            data: {
                timestamp: entry.timestamp.toISOString(),
                message: entry.message,
            },
        });
    }
}
//# sourceMappingURL=remote-session.js.map