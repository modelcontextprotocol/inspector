import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage, JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";

export class StreamableHttpError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly response?: Response
  ) {
    super(`Streamable HTTP error: ${message}`);
  }
}

/**
 * Client transport for Streamable HTTP: this connects to an MCP server 
 * that implements the Streamable HTTP protocol.
 */
export class StreamableHttpClientTransport implements Transport {
  private _url: URL;
  private _sessionId?: string;
  private _headers: HeadersInit;
  private _abortController?: AbortController;
  private _sseConnections: Map<string, ReadableStreamDefaultReader<Uint8Array>> = new Map();
  private _lastEventId?: string;
  private _closed: boolean = false;
  private _pendingRequests: Map<string | number, { resolve: () => void, timestamp: number }> = new Map();
  private _connectionId: string = crypto.randomUUID();
  private _hasEstablishedSession: boolean = false;
  
  constructor(url: URL, options?: { headers?: HeadersInit }) {
    this._url = url;
    this._headers = options?.headers || {};
  }

  async start(): Promise<void> {
    if (this._closed) {
      throw new Error("Transport was closed and cannot be restarted");
    }
    
    if (this._sseConnections.size > 0) {
      throw new Error("StreamableHttpClientTransport already started!");
    }
    
    // Per Streamable HTTP spec: we don't establish SSE at beginning
    // We'll wait for initialize request to get a session ID first
    return Promise.resolve();
  }

  private async _startServerListening(): Promise<void> {
    if (this._closed || !this._sessionId) {
      return;
    }
    
    try {
      const connectionId = crypto.randomUUID();
      await this.openServerSentEventsListener(connectionId);
    } catch (error) {
      if (error instanceof StreamableHttpError && error.code === 405) {
        // Server doesn't support GET for server-initiated messages (allowed by spec)
        return;
      }
    }
  }

  async send(message: JSONRPCMessage | JSONRPCMessage[]): Promise<void> {
    if (this._closed) {
      throw new Error("Transport is closed");
    }
    
    const messages = Array.isArray(message) ? message : [message];
    const hasRequests = messages.some(msg => 'method' in msg && 'id' in msg);
    
    // Check if this is an initialization request
    const isInitialize = messages.some(msg => 
      'method' in msg && msg.method === 'initialize'
    );
    
    for (const msg of messages) {
      if ('id' in msg && 'method' in msg) {
        this._pendingRequests.set(msg.id, {
          resolve: () => {}, 
          timestamp: Date.now()
        });
      }
    }
    
    this._abortController?.abort();
    this._abortController = new AbortController();
    
    const headers = new Headers(this._headers);
    // Per spec: client MUST include Accept header with these values
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json, text/event-stream");
    
    if (this._sessionId) {
      headers.set("Mcp-Session-Id", this._sessionId);
    }
    
    try {
      const response = await fetch(this._url.toString(), {
        method: "POST", // Per spec: client MUST use HTTP POST
        headers,
        body: JSON.stringify(message),
        signal: this._abortController.signal,
      });
      
      // Per spec: Server MAY assign session ID during initialization
      const sessionId = response.headers.get("Mcp-Session-Id");
      if (sessionId) {
        const hadNoSessionBefore = !this._sessionId;
        this._sessionId = sessionId;
        
        // If this is the first time we've gotten a session ID and it's an initialize request
        // then try to establish a server-side listener
        if (hadNoSessionBefore && isInitialize) {
          this._hasEstablishedSession = true;
          // Start server listening after a short delay to ensure server has registered the session
          setTimeout(() => {
            this._startServerListening();
          }, 100);
        }
      }
      
      // Handle response status
      if (!response.ok) {
        // Per spec: if we get 404 with a session ID, the session has expired
        if (response.status === 404 && this._sessionId) {
          this._sessionId = undefined;
          this._hasEstablishedSession = false;
          // Try again without session ID (per spec: client MUST start a new session)
          return this.send(message);
        }
        
        const text = await response.text().catch(() => "Unknown error");
        throw new StreamableHttpError(response.status, text, response);
      }
      
      // Handle different response types based on content type
      const contentType = response.headers.get("Content-Type");
      
      // Per spec: 202 Accepted for responses/notifications that don't need responses
      if (response.status === 202) {
        return;
      } else if (contentType?.includes("text/event-stream")) {
        // Per spec: server MAY return SSE stream for requests
        const connectionId = crypto.randomUUID();
        await this.processSSEStream(connectionId, response, hasRequests);
      } else if (contentType?.includes("application/json")) {
        // Per spec: server MAY return JSON for requests
        const json = await response.json();
        
        try {
          if (Array.isArray(json)) {
            // Handle batched responses
            for (const item of json) {
              const parsedMessage = JSONRPCMessageSchema.parse(item);
              this.onmessage?.(parsedMessage);
              
              // Clear corresponding request from pending list
              if ('id' in parsedMessage && 
                 ('result' in parsedMessage || 'error' in parsedMessage) && 
                  this._pendingRequests.has(parsedMessage.id)) {
                this._pendingRequests.delete(parsedMessage.id);
              }
            }
          } else {
            // Handle single response
            const parsedMessage = JSONRPCMessageSchema.parse(json);
            this.onmessage?.(parsedMessage);
            
            // Clear corresponding request from pending list
            if ('id' in parsedMessage && 
               ('result' in parsedMessage || 'error' in parsedMessage) && 
                this._pendingRequests.has(parsedMessage.id)) {
              this._pendingRequests.delete(parsedMessage.id);
            }
          }
        } catch (error) {
          this.onerror?.(error as Error);
        }
      }
    } catch (error) {
      if (error instanceof StreamableHttpError) {
        this.onerror?.(error);
        throw error;
      }
      
      const streamError = new StreamableHttpError(
        0,
        (error as Error).message || "Unknown error"
      );
      this.onerror?.(streamError);
      throw streamError;
    }
  }
  
  private async processSSEStream(connectionId: string, response: Response, isRequestResponse: boolean = false): Promise<void> {
    if (!response.body) {
      throw new Error("No response body available");
    }
    
    const reader = response.body.getReader();
    this._sseConnections.set(connectionId, reader);
    
    const decoder = new TextDecoder();
    let buffer = "";
    let responseIds = new Set<string | number>();
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          this._sseConnections.delete(connectionId);
          break;
        }
        
        buffer += decoder.decode(value, { stream: true });
        
        // Process complete events in buffer
        const events = buffer.split("\n\n");
        buffer = events.pop() || ""; // Keep the last incomplete event
        
        for (const event of events) {
          const lines = event.split("\n");
          let eventType = "message";
          let data = "";
          let id = undefined;
          
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data:")) {
              data = line.slice(5).trim();
            } else if (line.startsWith("id:")) {
              // Per spec: Save ID for resuming broken connections
              id = line.slice(3).trim();
              this._lastEventId = id;
            }
          }
          
          if (eventType === "message" && data) {
            try {
              const jsonData = JSON.parse(data);
              
              if (Array.isArray(jsonData)) {
                // Handle batched messages
                for (const item of jsonData) {
                  const message = JSONRPCMessageSchema.parse(item);
                  this.onmessage?.(message);
                  
                  // Clear pending request if this is a response
                  if ('id' in message && 
                     ('result' in message || 'error' in message) && 
                     this._pendingRequests.has(message.id)) {
                    responseIds.add(message.id);
                    this._pendingRequests.delete(message.id);
                  }
                }
              } else {
                // Handle single message
                const message = JSONRPCMessageSchema.parse(jsonData);
                this.onmessage?.(message);
                
                // Clear pending request if this is a response
                if ('id' in message && 
                   ('result' in message || 'error' in message) && 
                    this._pendingRequests.has(message.id)) {
                  responseIds.add(message.id);
                  this._pendingRequests.delete(message.id);
                }
              }
            } catch (error) {
              this.onerror?.(error as Error);
            }
          }
        }
        
        // If this is a response stream and all requests have been responded to,
        // we can close the connection
        if (isRequestResponse && this._pendingRequests.size === 0) {
          break;
        }
      }
    } catch (error) {
      this._sseConnections.delete(connectionId);
      throw error;
    } finally {
      if (this._sseConnections.has(connectionId)) {
        this._sseConnections.delete(connectionId);
      }
    }
  }
  
  async openServerSentEventsListener(connectionId: string = crypto.randomUUID()): Promise<void> {
    if (this._closed) {
      throw new Error("Transport is closed");
    }
    
    if (this._sseConnections.has(connectionId)) {
      return;
    }
    
    // Per spec: Can't establish listener without session ID
    if (!this._sessionId) {
      throw new Error("Cannot establish server-side listener without a session ID");
    }
    
    const headers = new Headers(this._headers);
    // Per spec: Must include Accept: text/event-stream
    headers.set("Accept", "text/event-stream");
    // Per spec: Must include session ID if available
    headers.set("Mcp-Session-Id", this._sessionId);
    
    // Per spec: Include Last-Event-ID for resuming broken connections
    if (this._lastEventId) {
      headers.set("Last-Event-ID", this._lastEventId);
    }
    
    try {
      // Per spec: GET request to open an SSE stream
      const response = await fetch(this._url.toString(), {
        method: "GET",
        headers,
      });
      
      if (!response.ok) {
        if (response.status === 405) {
          // Per spec: Server MAY NOT support GET
          throw new StreamableHttpError(405, "Method Not Allowed", response);
        } else if (response.status === 404 && this._sessionId) {
          // Per spec: 404 means session expired
          this._sessionId = undefined;
          this._hasEstablishedSession = false;
          throw new Error("Session expired");
        }
        
        const text = await response.text().catch(() => "Unknown error");
        throw new StreamableHttpError(response.status, text, response);
      }
      
      // Per spec: Check for updated session ID
      const sessionId = response.headers.get("Mcp-Session-Id");
      if (sessionId) {
        this._sessionId = sessionId;
      }
      
      // Process the SSE stream
      await this.processSSEStream(connectionId, response);
      
      // Automatically reconnect if the connection is closed but transport is still active
      if (!this._closed) {
        this.openServerSentEventsListener().catch(() => {
          // Error already logged by inner function - no need to handle again
        });
      }
    } catch (error) {
      if (error instanceof StreamableHttpError) {
        this.onerror?.(error);
        throw error;
      }
      
      const streamError = new StreamableHttpError(
        0,
        (error as Error).message || "Unknown error"
      );
      this.onerror?.(streamError);
      throw streamError;
    }
  }

  async close(): Promise<void> {
    this._closed = true;
    
    // Cancel all active SSE connections
    for (const [id, reader] of this._sseConnections.entries()) {
      try {
        await reader.cancel();
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
    this._sseConnections.clear();
    
    // Cancel any in-flight requests
    this._abortController?.abort();
    
    // Per spec: Clients SHOULD send DELETE to terminate session
    if (this._sessionId) {
      try {
        const headers = new Headers(this._headers);
        headers.set("Mcp-Session-Id", this._sessionId);
        
        await fetch(this._url.toString(), {
          method: "DELETE",
          headers,
        }).catch(() => {});
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
    
    this.onclose?.();
  }

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
} 
