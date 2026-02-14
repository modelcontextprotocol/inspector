/**
 * RemoteClientTransport - Transport that talks to a remote server via HTTP.
 * Pure TypeScript; works in browser, Deno, or Node.
 */
/**
 * Parse SSE stream from a ReadableStream.
 * Yields { event, data } for each SSE message.
 */
async function* parseSSE(reader) {
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        let currentEvent = "message";
        let currentData = [];
        for (const line of lines) {
            if (line.startsWith("event:")) {
                currentEvent = line.slice(6).trim();
            }
            else if (line.startsWith("data:")) {
                currentData.push(line.slice(5).trimStart());
            }
            else if (line === "") {
                if (currentData.length > 0) {
                    yield { event: currentEvent, data: currentData.join("\n") };
                }
                currentEvent = "message";
                currentData = [];
            }
        }
    }
    if (buffer.trim()) {
        const lines = buffer.split("\n");
        let currentEvent = "message";
        const currentData = [];
        for (const line of lines) {
            if (line.startsWith("event:"))
                currentEvent = line.slice(6).trim();
            else if (line.startsWith("data:"))
                currentData.push(line.slice(5).trimStart());
        }
        if (currentData.length > 0) {
            yield { event: currentEvent, data: currentData.join("\n") };
        }
    }
}
/**
 * Transport that forwards JSON-RPC to a remote server and receives responses via SSE.
 */
export class RemoteClientTransport {
    options;
    config;
    _sessionId = undefined;
    eventStreamReader = null;
    eventStreamAbort = null;
    closed = false;
    /**
     * Intentionally returns undefined. The MCP Client checks transport.sessionId to detect
     * reconnects and skip initialize. Our _sessionId is the remote server's session ID, not
     * the MCP protocol's initialization state. Exposing it would cause the MCP Client to
     * skip initialize and send tools/list first, which fails on streamable-http (and any
     * transport requiring initialize before other requests).
     */
    get sessionId() {
        return undefined;
    }
    constructor(options, config) {
        this.options = options;
        this.config = config;
    }
    get fetchFn() {
        return this.options.fetchFn ?? globalThis.fetch;
    }
    get baseUrl() {
        return this.options.baseUrl.replace(/\/$/, "");
    }
    get headers() {
        const h = {
            "Content-Type": "application/json",
        };
        if (this.options.authToken) {
            h["x-mcp-remote-auth"] = `Bearer ${this.options.authToken}`;
        }
        return h;
    }
    async start() {
        if (this.sessionId)
            return;
        if (this.closed)
            throw new Error("Transport is closed");
        // Extract OAuth tokens from authProvider if available
        let oauthTokens;
        if (this.options.authProvider) {
            const tokens = await this.options.authProvider.tokens();
            if (tokens) {
                oauthTokens = {
                    access_token: tokens.access_token,
                    token_type: tokens.token_type,
                    expires_in: tokens.expires_in,
                    refresh_token: tokens.refresh_token,
                };
            }
        }
        const body = {
            config: this.config,
            oauthTokens,
        };
        const res = await this.fetchFn(`${this.baseUrl}/api/mcp/connect`, {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text();
            // Preserve the status code in the error so callers can detect 401
            const error = new Error(`Remote connect failed (${res.status}): ${text}`);
            error.status = res.status;
            throw error;
        }
        const json = (await res.json());
        this._sessionId = json.sessionId;
        if (!this._sessionId) {
            throw new Error("Remote did not return sessionId");
        }
        // Open SSE event stream
        this.eventStreamAbort = new AbortController();
        const eventRes = await this.fetchFn(`${this.baseUrl}/api/mcp/events?sessionId=${encodeURIComponent(this._sessionId)}`, {
            headers: this.options.authToken
                ? { "x-mcp-remote-auth": `Bearer ${this.options.authToken}` }
                : {},
            signal: this.eventStreamAbort.signal,
        });
        if (!eventRes.ok) {
            this._sessionId = undefined;
            throw new Error(`Remote events stream failed (${eventRes.status}): ${await eventRes.text()}`);
        }
        const bodyStream = eventRes.body;
        if (!bodyStream) {
            throw new Error("Remote events stream has no body");
        }
        this.eventStreamReader = bodyStream.getReader();
        this.consumeEventStream();
    }
    async consumeEventStream() {
        if (!this.eventStreamReader)
            return;
        try {
            for await (const { event, data } of parseSSE(this.eventStreamReader)) {
                if (this.closed)
                    break;
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.type === "message") {
                        this.onmessage?.(parsed.data, undefined);
                    }
                    else if (parsed.type === "fetch_request" &&
                        this.options.onFetchRequest) {
                        const entry = parsed.data;
                        this.options.onFetchRequest({
                            ...entry,
                            timestamp: typeof entry.timestamp === "string"
                                ? new Date(entry.timestamp)
                                : entry.timestamp,
                        });
                    }
                    else if (parsed.type === "stdio_log" && this.options.onStderr) {
                        this.options.onStderr({
                            timestamp: new Date(parsed.data.timestamp),
                            message: parsed.data.message,
                        });
                    }
                    else if (parsed.type === "transport_error") {
                        // Transport died - notify client and close (matches local behavior)
                        const error = new Error(parsed.data.error);
                        if (parsed.data.code !== undefined) {
                            error.code = parsed.data.code;
                        }
                        this.onerror?.(error);
                        // Also trigger onclose to match local transport behavior
                        if (!this.closed) {
                            this.closed = true;
                            this.onclose?.();
                        }
                    }
                }
                catch (err) {
                    // JSON parse error or other processing error - report but continue
                    this.onerror?.(err instanceof Error ? err : new Error(String(err)));
                }
            }
        }
        catch (err) {
            // Stream reading error (network issue, abort, etc.)
            if (!this.closed && err instanceof Error && err.name !== "AbortError") {
                this.onerror?.(err);
            }
        }
        finally {
            this.eventStreamReader = null;
            if (!this.closed) {
                this.closed = true;
                this.onclose?.();
            }
        }
    }
    async send(message, options) {
        if (!this._sessionId) {
            throw new Error("Transport not started");
        }
        if (this.closed) {
            throw new Error("Transport is closed");
        }
        const body = {
            sessionId: this._sessionId,
            message,
            ...(options?.relatedRequestId != null && {
                relatedRequestId: options.relatedRequestId,
            }),
        };
        const res = await this.fetchFn(`${this.baseUrl}/api/mcp/send`, {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Remote send failed (${res.status}): ${text}`);
        }
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        this.eventStreamAbort?.abort();
        this.eventStreamReader = null;
        if (this._sessionId) {
            try {
                await this.fetchFn(`${this.baseUrl}/api/mcp/disconnect`, {
                    method: "POST",
                    headers: this.headers,
                    body: JSON.stringify({ sessionId: this._sessionId }),
                });
            }
            catch {
                // Ignore disconnect errors
            }
            this._sessionId = undefined;
        }
        this.onclose?.();
    }
    onclose;
    onerror;
    onmessage;
}
//# sourceMappingURL=remoteClientTransport.js.map