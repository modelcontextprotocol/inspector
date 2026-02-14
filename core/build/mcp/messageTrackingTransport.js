// Transport wrapper that intercepts all messages for tracking
export class MessageTrackingTransport {
    baseTransport;
    callbacks;
    constructor(baseTransport, callbacks) {
        this.baseTransport = baseTransport;
        this.callbacks = callbacks;
    }
    async start() {
        return this.baseTransport.start();
    }
    async send(message, options) {
        // Track outgoing requests (only requests have a method and are sent by the client)
        if ("method" in message && "id" in message) {
            this.callbacks.trackRequest?.(message);
        }
        return this.baseTransport.send(message, options);
    }
    async close() {
        return this.baseTransport.close();
    }
    get onclose() {
        return this.baseTransport.onclose;
    }
    set onclose(handler) {
        this.baseTransport.onclose = handler;
    }
    get onerror() {
        return this.baseTransport.onerror;
    }
    set onerror(handler) {
        this.baseTransport.onerror = handler;
    }
    get onmessage() {
        return this.baseTransport.onmessage;
    }
    set onmessage(handler) {
        if (handler) {
            // Wrap the handler to track incoming messages
            this.baseTransport.onmessage = (message, extra) => {
                // Track incoming messages
                if ("id" in message &&
                    message.id !== null &&
                    message.id !== undefined) {
                    // Check if it's a response (has 'result' or 'error' property)
                    if ("result" in message || "error" in message) {
                        this.callbacks.trackResponse?.(message);
                    }
                    else if ("method" in message) {
                        // This is a request coming from the server
                        this.callbacks.trackRequest?.(message);
                    }
                }
                else if ("method" in message) {
                    // Notification (no ID, has method)
                    this.callbacks.trackNotification?.(message);
                }
                // Call the original handler
                handler(message, extra);
            };
        }
        else {
            this.baseTransport.onmessage = undefined;
        }
    }
    get sessionId() {
        return this.baseTransport.sessionId;
    }
    get setProtocolVersion() {
        return this.baseTransport.setProtocolVersion;
    }
}
//# sourceMappingURL=messageTrackingTransport.js.map