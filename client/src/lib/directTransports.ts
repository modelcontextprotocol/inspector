// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface Transport {
  onmessage?: (message: any) => void;
  onerror?: (error: Error) => void;
  start(): Promise<void>;
  send(message: any): Promise<void>;
  close(): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface JSONRPCMessage {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

// this is simplified but should be sufficient while we wait for official SDK
const JSONRPCMessageSchema = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parse: (data: unknown): JSONRPCMessage => {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid JSON-RPC message');
    }
    
    if (data && typeof data === 'object' && 'jsonrpc' in data) {
      return data as JSONRPCMessage;
    }
    
    throw new Error('Invalid JSON-RPC message format');
  }
};

export class DirectTransportError extends Error {
  readonly code: number;
  readonly response?: Response;

  constructor(code: number, message: string, response?: Response) {
    super(`Direct transport error: ${message}`);
    this.code = code;
    this.response = response;
    this.name = "DirectTransportError";
  }
}

interface ClientTransport extends Transport {
  readonly isMCPClientTransport: boolean;
}

abstract class DirectTransport implements Transport {
  protected _url: URL;
  protected _closed: boolean = false;
  protected _headers: HeadersInit;
  protected _abortController?: AbortController;
  protected _useCredentials: boolean;
  protected _sessionId?: string;  // Define sessionId at the base class level

  constructor(url: URL, options?: { headers?: HeadersInit, useCredentials?: boolean }) {
    this._url = url;
    this._headers = options?.headers || {};
    this._useCredentials = options?.useCredentials !== undefined ? options.useCredentials : false;
  }

  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;

  abstract start(): Promise<void>;
  abstract send(message: JSONRPCMessage): Promise<void>;

  async close(): Promise<void> {
    this._closed = true;
    this._abortController?.abort();
  }
}

export class DirectSseTransport extends DirectTransport {
  private _eventSource?: EventSource;
  private _endpoint?: URL;

  async start(): Promise<void> {
    if (this._eventSource) {
      throw new Error("DirectSseTransport already started");
    }

    return new Promise<void>((resolve, reject) => {
      const eventSource = new EventSource(this._url.toString(), {
        withCredentials: this._useCredentials
      });

      eventSource.onopen = () => {
        this._eventSource = eventSource;
        resolve();
      };

      eventSource.onerror = () => {
        const error = new DirectTransportError(
          0,
          "Failed to connect to SSE endpoint",
          undefined
        );
        reject(error);
        this.onerror?.(error);
        eventSource.close();
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const message = JSONRPCMessageSchema.parse(data);
          
          if (message.result?.endpoint) {
            this._endpoint = new URL(message.result.endpoint);
          }
          
          // Extract session ID if it's in the result
          if (message.result?.sessionId) {
            this._sessionId = message.result.sessionId;
          }
          
          this.onmessage?.(message);
        } catch (error) {
          this.onerror?.(error instanceof Error ? error : new Error(String(error)));
        }
      };
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this._closed) {
      throw new Error("Transport is closed");
    }

    if (!this._endpoint) {
      throw new Error("Not connected or endpoint not received");
    }

    const headers = new Headers(this._headers);
    headers.set("Content-Type", "application/json");
    
    if (this._sessionId) {
      headers.set("Mcp-Session-Id", this._sessionId);
    }

    try {
      const response = await fetch(this._endpoint.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        credentials: this._useCredentials ? "include" : "same-origin"
      });

      const sessionId = response.headers.get("Mcp-Session-Id");
      if (sessionId) {
        this._sessionId = sessionId;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "Unknown error");
        throw new DirectTransportError(response.status, text, response);
      }
    } catch (error) {
      if (error instanceof DirectTransportError) {
        this.onerror?.(error);
        throw error;
      }

      const transportError = new DirectTransportError(
        0,
        (error as Error).message || "Unknown error"
      );
      this.onerror?.(transportError);
      throw transportError;
    }
  }

  async close(): Promise<void> {
    this._eventSource?.close();
    this._eventSource = undefined;
    
    if (this._sessionId && this._endpoint) {
      try {
        const headers = new Headers(this._headers);
        headers.set("Mcp-Session-Id", this._sessionId);
        
        await fetch(this._endpoint.toString(), {
          method: "DELETE",
          headers,
          credentials: this._useCredentials ? "include" : "same-origin"
        }).catch(() => {});
      } catch {
      }
    }
    
    await super.close();
  }
}

export class DirectStreamableHttpTransport extends DirectTransport implements ClientTransport {
  readonly isMCPClientTransport: boolean = true;
  private _lastEventId?: string;
  private _activeStreams: Map<string, ReadableStreamDefaultReader<Uint8Array>> = new Map();
  private _pendingRequests: Map<string | number, { resolve: () => void, timestamp: number }> = new Map();

  async start(): Promise<void> {
    return Promise.resolve();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this._closed) {
      throw new Error("Transport is closed");
    }

    const messages = Array.isArray(message) ? message : [message];
    const hasRequests = messages.some(msg => 'method' in msg && 'id' in msg);
    const isInitializeRequest = messages.some(msg => 'method' in msg && msg.method === 'initialize');
    
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
    
    if (this._sessionId && !isInitializeRequest) {
      headers.set("Mcp-Session-Id", this._sessionId);
      console.log("Including session ID in request:", this._sessionId);
    } else {
      console.log("No session ID available for request");
    }
    
    try {
      console.log("Sending request to:", this._url.toString());
      console.log("With headers:", Object.fromEntries(headers.entries()));
      console.log("Request body:", JSON.stringify(message, null, 2));
      
      const response = await fetch(this._url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal: this._abortController.signal,
        credentials: this._useCredentials ? "include" : "same-origin"
      });
      
      const sessionId = response.headers.get("Mcp-Session-Id");
      if (sessionId) {
        console.log("Received session ID:", sessionId);
        this._sessionId = sessionId;
      }
      
      if (!response.ok) {
        if (response.status === 404 && this._sessionId) {
          this._sessionId = undefined;
          return this.send(message);
        }
        
        const text = await response.text().catch(() => "Unknown error");
        console.error("Error response:", response.status, text);
        throw new DirectTransportError(response.status, text, response);
      }
      
      const contentType = response.headers.get("Content-Type");
      console.log("Response content type:", contentType);
      
      if (response.status === 202) {
        return;
      } else if (contentType?.includes("text/event-stream")) {
        await this.processStream(response, hasRequests);
      } else if (contentType?.includes("application/json")) {
        const json = await response.json();
        console.log("JSON response:", JSON.stringify(json, null, 2));
        
        try {
          if (Array.isArray(json)) {
            for (const item of json) {
              const parsedMessage = JSONRPCMessageSchema.parse(item);
              this.onmessage?.(parsedMessage);
              
              if ('id' in parsedMessage && parsedMessage.id != null && 
                 ('result' in parsedMessage || 'error' in parsedMessage) && 
                  this._pendingRequests.has(parsedMessage.id)) {
                this._pendingRequests.delete(parsedMessage.id);
              }
            }
          } else {
            const parsedMessage = JSONRPCMessageSchema.parse(json);
            
            if ('result' in parsedMessage && parsedMessage.result && 
                typeof parsedMessage.result === 'object' && 
                'sessionId' in parsedMessage.result) {
              this._sessionId = String(parsedMessage.result.sessionId);
              console.log("Set session ID from JSON result:", this._sessionId);
            }
            
            this.onmessage?.(parsedMessage);
            
            if ('id' in parsedMessage && parsedMessage.id != null && 
               ('result' in parsedMessage || 'error' in parsedMessage) && 
                this._pendingRequests.has(parsedMessage.id)) {
              this._pendingRequests.delete(parsedMessage.id);
            }
          }
        } catch (error) {
          console.error("Error parsing JSON response:", error);
          this.onerror?.(error as Error);
        }
      }
    } catch (error) {
      console.error("Error during request:", error);
      if (error instanceof DirectTransportError) {
        this.onerror?.(error);
        throw error;
      }
      
      const transportError = new DirectTransportError(
        0,
        (error as Error).message || "Unknown error"
      );
      this.onerror?.(transportError);
      throw transportError;
    }
    
    if (this._sessionId && messages.some(msg => 'method' in msg && msg.method === 'initialize')) {
      this.listenForServerMessages().catch(() => {
      });
    }
  }

  private async processStream(response: Response, hasRequests = false): Promise<void> {
    if (!response.body) {
      throw new Error("Response body is null");
    }
    
    const reader = response.body.getReader();
    const streamId = Math.random().toString(36).substring(2, 15);
    this._activeStreams.set(streamId, reader);
    
    const textDecoder = new TextDecoder();
    let buffer = "";
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }
        
        buffer += textDecoder.decode(value, { stream: true });
        
        const lines = buffer.split(/\r\n|\r|\n/);
        buffer = lines.pop() || "";
        
        let currentData = "";
        let currentId = "";
        
        for (const line of lines) {
          if (line.startsWith("data:")) {
            currentData += line.substring(5).trim();
          } else if (line.startsWith("id:")) {
            currentId = line.substring(3).trim();
          } else if (line === "") {
            if (currentData) {
              try {
                const parsedData = JSON.parse(currentData);
                const message = JSONRPCMessageSchema.parse(parsedData);
                
                this._lastEventId = currentId;
                this.onmessage?.(message);
                
                currentData = "";
                currentId = "";
                
                if ('id' in message && message.id != null && 
                   ('result' in message || 'error' in message) && 
                    this._pendingRequests.has(message.id)) {
                  this._pendingRequests.delete(message.id);
                  
                  if (hasRequests && this._pendingRequests.size === 0) {
                    reader.cancel();
                    break;
                  }
                }
              } catch (error) {
                this.onerror?.(error instanceof Error ? error : new Error(String(error)));
              }
            }
          }
        }
      }
    } catch (error) {
      if (!this._closed) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      this._activeStreams.delete(streamId);
    }
  }

  async listenForServerMessages(): Promise<void> {
    if (this._closed) {
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
        credentials: this._useCredentials ? "include" : "same-origin"
      });
      
      if (!response.ok) {
        if (response.status === 405) {
          return;
        } else if (response.status === 404 && this._sessionId) {
          this._sessionId = undefined;
          throw new Error("Session expired");
        }
        
        const text = await response.text().catch(() => "Unknown error");
        throw new DirectTransportError(response.status, text, response);
      }
      
      const sessionId = response.headers.get("Mcp-Session-Id");
      if (sessionId) {
        this._sessionId = sessionId;
      }
      
      await this.processStream(response);
      
      if (!this._closed) {
        this.listenForServerMessages().catch(() => {
        });
      }
    } catch (error) {
      if (error instanceof DirectTransportError) {
        this.onerror?.(error);
        throw error;
      }
      
      const transportError = new DirectTransportError(
        0,
        (error instanceof Error ? error.message : String(error)) || "Unknown error"
      );
      this.onerror?.(transportError);
      throw transportError;
    }
  }

  async close(): Promise<void> {
    for (const reader of this._activeStreams.values()) {
      try {
        await reader.cancel();
      } catch {
        // Ignore
      }
    }
    this._activeStreams.clear();
    
    if (this._sessionId) {
      try {
        const headers = new Headers(this._headers);
        headers.set("Mcp-Session-Id", this._sessionId);
        
        await fetch(this._url.toString(), {
          method: "DELETE",
          headers,
          credentials: this._useCredentials ? "include" : "same-origin"
        }).catch(() => {});
      } catch {
        // Ignore 
      }
    }
    
    await super.close();
  }
} 
