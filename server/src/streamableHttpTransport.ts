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
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json, text/event-stream");
    
    if (this._sessionId) {
      headers.set("Mcp-Session-Id", this._sessionId);
    }
    
    try {
      const response = await fetch(this._url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal: this._abortController.signal,
      });
      
      const sessionId = response.headers.get("Mcp-Session-Id");
      if (sessionId) {
        const hadNoSessionBefore = !this._sessionId;
        this._sessionId = sessionId;
        
        if (hadNoSessionBefore && isInitialize) {
          this._hasEstablishedSession = true;
          
          const initializedNotification: JSONRPCMessage = {
            jsonrpc: "2.0",
            method: "notifications/initialized"
          };
          
          this.send(initializedNotification).then(() => {
            setTimeout(() => {
              this._startServerListening();
            }, 100);
          }).catch(error => {
            this.onerror?.(error instanceof Error ? error : new Error(String(error)));
          });
          
        }
      }
      
      if (!response.ok) {
        if (response.status === 404 && this._sessionId) {
          this._sessionId = undefined;
          this._hasEstablishedSession = false;
          return this.send(message);
        }
        
        const text = await response.text().catch(() => "Unknown error");
        throw new StreamableHttpError(response.status, text, response);
      }
      
      const contentType = response.headers.get("Content-Type");
      
      if (response.status === 202) {
        return;
      } else if (contentType?.includes("text/event-stream")) {
        const connectionId = crypto.randomUUID();
        await this.processSSEStream(connectionId, response, hasRequests);
      } else if (contentType?.includes("application/json")) {
        const json = await response.json();
        
        try {
          if (Array.isArray(json)) {
            for (const item of json) {
              const parsedMessage = JSONRPCMessageSchema.parse(item);
              this.onmessage?.(parsedMessage);
              
              if ('id' in parsedMessage && 
                 ('result' in parsedMessage || 'error' in parsedMessage) && 
                  this._pendingRequests.has(parsedMessage.id)) {
                this._pendingRequests.delete(parsedMessage.id);
              }
            }
          } else {
            const parsedMessage = JSONRPCMessageSchema.parse(json);
            this.onmessage?.(parsedMessage);
            
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
        
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        
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
              id = line.slice(3).trim();
              this._lastEventId = id;
            }
          }
          
          if (eventType === "message" && data) {
            try {
              const jsonData = JSON.parse(data);
              
              if (Array.isArray(jsonData)) {
                for (const item of jsonData) {
                  const message = JSONRPCMessageSchema.parse(item);
                  this.onmessage?.(message);
                  
                  if ('id' in message && 
                     ('result' in message || 'error' in message) && 
                     this._pendingRequests.has(message.id)) {
                    responseIds.add(message.id);
                    this._pendingRequests.delete(message.id);
                  }
                }
              } else {
                const message = JSONRPCMessageSchema.parse(jsonData);
                this.onmessage?.(message);
                
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
    
    if (!this._sessionId) {
      throw new Error("Cannot establish server-side listener without a session ID");
    }
    
    const headers = new Headers(this._headers);
    headers.set("Accept", "text/event-stream");
    headers.set("Mcp-Session-Id", this._sessionId);
    
    if (this._lastEventId) {
      headers.set("Last-Event-ID", this._lastEventId);
    }
    
    try {
      const response = await fetch(this._url.toString(), {
        method: "GET",
        headers,
      });
      
      if (!response.ok) {
        if (response.status === 405) {
          throw new StreamableHttpError(405, "Method Not Allowed", response);
        } else if (response.status === 404 && this._sessionId) {
          this._sessionId = undefined;
          this._hasEstablishedSession = false;
          throw new Error("Session expired");
        }
        
        const text = await response.text().catch(() => "Unknown error");
        throw new StreamableHttpError(response.status, text, response);
      }
      
      const sessionId = response.headers.get("Mcp-Session-Id");
      if (sessionId) {
        this._sessionId = sessionId;
      }
      
      await this.processSSEStream(connectionId, response);
      
      if (!this._closed) {
        this.openServerSentEventsListener().catch(() => {
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
    
    for (const [id, reader] of this._sseConnections.entries()) {
      try {
        await reader.cancel();
      } catch (error) {
      }
    }
    this._sseConnections.clear();
    
    this._abortController?.abort();
    
    if (this._sessionId) {
      try {
        const headers = new Headers(this._headers);
        headers.set("Mcp-Session-Id", this._sessionId);
        
        await fetch(this._url.toString(), {
          method: "DELETE",
          headers,
        }).catch(() => {});
      } catch (error) {
      }
    }
    
    this.onclose?.();
  }

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
} 
