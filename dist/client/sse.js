import { JSONRPCMessageSchema } from "../types.js";
/**
 * Client transport for SSE: this will connect to a server using Server-Sent Events for receiving
 * messages and make separate POST requests for sending messages.
 *
 * This uses the EventSource API in browsers. You can install the `eventsource` package for Node.js.
 */
export class SSEClientTransport {
    constructor(url) {
        this._url = url;
    }
    start() {
        if (this._eventSource) {
            throw new Error("SSEClientTransport already started! If using Client class, note that connect() calls start() automatically.");
        }
        return new Promise((resolve, reject) => {
            this._eventSource = new EventSource(this._url.href);
            this._abortController = new AbortController();
            this._eventSource.onerror = (event) => {
                var _a;
                const error = new Error(`SSE error: ${JSON.stringify(event)}`);
                reject(error);
                (_a = this.onerror) === null || _a === void 0 ? void 0 : _a.call(this, error);
            };
            this._eventSource.onopen = () => {
                // The connection is open, but we need to wait for the endpoint to be received.
            };
            this._eventSource.addEventListener("endpoint", (event) => {
                var _a;
                const messageEvent = event;
                try {
                    this._endpoint = new URL(messageEvent.data, this._url);
                    if (this._endpoint.origin !== this._url.origin) {
                        throw new Error(`Endpoint origin does not match connection origin: ${this._endpoint.origin}`);
                    }
                }
                catch (error) {
                    reject(error);
                    (_a = this.onerror) === null || _a === void 0 ? void 0 : _a.call(this, error);
                    void this.close();
                    return;
                }
                resolve();
            });
            this._eventSource.onmessage = (event) => {
                var _a, _b;
                const messageEvent = event;
                let message;
                try {
                    message = JSONRPCMessageSchema.parse(JSON.parse(messageEvent.data));
                }
                catch (error) {
                    (_a = this.onerror) === null || _a === void 0 ? void 0 : _a.call(this, error);
                    return;
                }
                (_b = this.onmessage) === null || _b === void 0 ? void 0 : _b.call(this, message);
            };
        });
    }
    async close() {
        var _a, _b, _c;
        (_a = this._abortController) === null || _a === void 0 ? void 0 : _a.abort();
        (_b = this._eventSource) === null || _b === void 0 ? void 0 : _b.close();
        (_c = this.onclose) === null || _c === void 0 ? void 0 : _c.call(this);
    }
    async send(message) {
        var _a, _b;
        if (!this._endpoint) {
            throw new Error("Not connected");
        }
        try {
            const response = await fetch(this._endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(message),
                signal: (_a = this._abortController) === null || _a === void 0 ? void 0 : _a.signal,
            });
            if (!response.ok) {
                const text = await response.text().catch(() => null);
                throw new Error(`Error POSTing to endpoint (HTTP ${response.status}): ${text}`);
            }
        }
        catch (error) {
            (_b = this.onerror) === null || _b === void 0 ? void 0 : _b.call(this, error);
            throw error;
        }
    }
}
//# sourceMappingURL=sse.js.map