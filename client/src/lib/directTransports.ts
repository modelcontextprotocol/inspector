// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;
  start(): Promise<void>;
  send(message: JSONRPCMessage): Promise<void>;
  close(): Promise<void>;
}

interface JSONRPCMessage {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any;
  error?: {
    code: number;
    message: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: any;
  };
}

const JSONRPCMessageSchema = {
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
  protected _sessionId?: string; 

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

// Define a structured log entry interface
interface TransportLogEntry {
  type: 'request' | 'response' | 'error' | 'sseOpen' | 'sseClose' | 'sseMessage' | 'transport';
  timestamp: number;
  streamId?: string;
  message?: string;
  body?: unknown;
  data?: unknown;
  id?: string;
  isSSE?: boolean;
  isRequest?: boolean;
  reason?: string;
  error?: boolean;
  event?: string;
  [key: string]: unknown;
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
        }).catch(() => {
        });
      } catch {
        // Ignore errors when terminating 
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
  private _hasEstablishedSession: boolean = false;
  private _keepAliveInterval?: NodeJS.Timeout;
  private _reconnectAttempts: number = 0;
  private _reconnectTimeout?: NodeJS.Timeout;
  private _logCallbacks: Array<(log: TransportLogEntry) => void> = [];
  private _transportStats = {
    sessionId: undefined as string | undefined,
    lastRequestTime: 0,
    lastResponseTime: 0,
    requestCount: 0,
    responseCount: 0,
    sseConnectionCount: 0,
    activeSSEConnections: 0,
    receivedMessages: 0
  };

  // Get the list of active stream IDs for UI display
  getActiveStreams(): string[] {
    return Array.from(this._activeStreams.keys());
  }

  // Register a callback to receive transport logs
  registerLogCallback(callback: (log: TransportLogEntry) => void): void {
    if (typeof callback === 'function') {
      this._logCallbacks.push(callback);
    }
  }

  // Internal method to emit logs to all registered callbacks
  private _emitLog(log: TransportLogEntry): void {
    for (const callback of this._logCallbacks) {
      try {
        callback(log);
      } catch (e) {
        console.error("Error in log callback", e);
      }
    }
  }

  private log(message: string, data?: unknown) {
    const timestamp = new Date().toISOString();
    const prefix = `[StreamableHttp ${timestamp}]`;
    if (data) {
      console.log(`${prefix} ${message}`, data);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }

  private logInit(step: number, message: string, data?: unknown) {
    const timestamp = new Date().toISOString();
    const prefix = `[StreamableHttp INIT:${step} ${timestamp}]`;
    console.group(prefix);
    console.log(message);
    if (data) {
      console.log('Details:', data);
    }
    console.groupEnd();
  }

  getTransportStats() {
    return {
      ...this._transportStats,
      activeSSEConnections: this._activeStreams.size,
      pendingRequests: this._pendingRequests.size,
      connectionEstablished: this._hasEstablishedSession
    };
  }

  async start(): Promise<void> {
    this.log("Transport starting");
    this._startKeepAlive();
    return Promise.resolve();
  }

  private _startKeepAlive(): void {
    if (this._keepAliveInterval) {
      clearInterval(this._keepAliveInterval);
    }
    
    // Send a ping every 30 seconds to keep the connection alive
    this._keepAliveInterval = setInterval(() => {
      if (this._hasEstablishedSession && this._sessionId) {
        this.log("Sending keep-alive ping");
        // Send a ping notification
        const pingMessage: JSONRPCMessage = {
          jsonrpc: "2.0",
          method: "ping"
        };
        
        this.send(pingMessage).catch(error => {
          this.log("Keep-alive ping failed", error);
          // If ping fails, try to re-establish SSE connection
          if (this._activeStreams.size === 0) {
            this.log("Attempting to reconnect SSE after failed ping");
            this.listenForServerMessages().catch(() => {
              this.log("Failed to reconnect SSE after ping failure");
            });
          }
        });
      }
    }, 30000); // 30 second interval
  }

  private _debugMessage(message: JSONRPCMessage): void {
    if ('result' in message && 'id' in message) {
      if (message.result && typeof message.result === 'object' && 'protocolVersion' in message.result) {
        console.log(`[DirectStreamableHttp] Received initialize response:`, message);
        console.log(`[DirectStreamableHttp] Protocol version: ${message.result.protocolVersion}`);
        console.log(`[DirectStreamableHttp] Server capabilities: ${JSON.stringify(message.result.capabilities, null, 2)}`);
        
        // Force update in debug console to help developers see the exact structure
        console.table({
          'protocol': message.result.protocolVersion,
          'hasPrompts': !!message.result.capabilities?.prompts,
          'hasResources': !!message.result.capabilities?.resources,
          'hasTools': !!message.result.capabilities?.tools,
          'hasLogging': !!message.result.capabilities?.logging
        });
      } else {
        console.log(`[DirectStreamableHttp] Received result for request ${message.id}`);
      }
    } else if ('method' in message) {
      console.log(`[DirectStreamableHttp] Received method call/notification: ${message.method}`);
    } else if ('error' in message) {
      console.error(`[DirectStreamableHttp] Received error:`, message.error);
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this._closed) {
      this.log("Cannot send message: transport is closed");
      throw new Error("Transport is closed");
    }

    const messages = Array.isArray(message) ? message : [message];
    const hasRequests = messages.some(msg => 'method' in msg && 'id' in msg);
    const isInitializeRequest = messages.some(msg => 'method' in msg && msg.method === 'initialize');
    const isInitializedNotification = messages.some(msg => 'method' in msg && msg.method === 'notifications/initialized');
    
    this._transportStats.requestCount++;
    this._transportStats.lastRequestTime = Date.now();
    
    // Emit request log for UI
    this._emitLog({
      type: 'request',
      body: message,
      timestamp: Date.now()
    });
    
    if (isInitializeRequest) {
      this.logInit(1, "Step 1: Sending initialize request via HTTP POST", {
        url: this._url.toString(),
        method: "POST",
        protocolVersion: messages.find(msg => 'method' in msg && msg.method === 'initialize')?.params?.protocolVersion || "unknown"
      });
      this._sessionId = undefined;
      this._hasEstablishedSession = false;
    } else if (isInitializedNotification) {
      this.logInit(3, "Step 3: Sending initialized notification with session ID", {
        sessionId: this._sessionId
      });
    } else if (this._hasEstablishedSession) {
      // This is a normal request/response after initialization
      this._logNormalRequest(message);
    }
    
    for (const msg of messages) {
      if ('id' in msg && 'method' in msg) {
        this._pendingRequests.set(msg.id, {
          resolve: () => {}, 
          timestamp: Date.now()
        });
      }
    }
    
    // Only abort previous requests if this isn't part of the initialization sequence
    // This prevents aborting critical connection sequence messages
    if (!isInitializeRequest && !isInitializedNotification) {
      this._abortController?.abort();
    }
    this._abortController = new AbortController();
    
    const headers = new Headers(this._headers);
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json, text/event-stream");
    
    if (this._sessionId && !isInitializeRequest) {
      headers.set("Mcp-Session-Id", this._sessionId);
      this.log("Including session ID in request header", this._sessionId);
    } else if (!isInitializeRequest) {
      this.log("No session ID available for request");
    }
    
    try {
      this.log("Sending fetch request", {
        url: this._url.toString(),
        method: "POST",
        headers: Object.fromEntries(headers.entries()),
        bodyPreview: JSON.stringify(message).substring(0, 100) + (JSON.stringify(message).length > 100 ? '...' : '')
      });
      
      const response = await fetch(this._url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal: this._abortController.signal,
        credentials: this._useCredentials ? "include" : "same-origin"
      });
      
      this._transportStats.responseCount++;
      this._transportStats.lastResponseTime = Date.now();
      
      const sessionId = response.headers.get("Mcp-Session-Id");
      if (sessionId) {
        this.log("Received session ID in response header", sessionId);
        this._transportStats.sessionId = sessionId;
        
        const hadNoSessionBefore = !this._sessionId;
        this._sessionId = sessionId;
        
        if (isInitializeRequest && hadNoSessionBefore) {
          this.logInit(2, "Step 2: Received initialize response with session ID", {
            sessionId,
            status: response.status,
            contentType: response.headers.get("Content-Type")
          });
          this._hasEstablishedSession = true;
          
          // Let the Client handle sending the initialized notification
          // This will be done by the client.connect() flow after initialize response
        }
      }
      
      if (!response.ok) {
        // Handle 404 per spec: if we get 404 with a session ID, the session has expired
        if (response.status === 404 && this._sessionId) {
          this.log("Session expired (404), retrying without session ID");
          this._sessionId = undefined;
          this._hasEstablishedSession = false;
          this._transportStats.sessionId = undefined;
          // Try again without session ID
          return this.send(message);
        }
        
        const text = await response.text().catch(() => "Unknown error");
        this.log("Error response", { status: response.status, text });
        throw new DirectTransportError(response.status, text, response);
      }
      
      const contentType = response.headers.get("Content-Type");
      this.log("Response received", { 
        status: response.status, 
        contentType,
        responseSize: response.headers.get("Content-Length") || "unknown"
      });
      
      // Handle 202 Accepted per spec (for notifications/responses that don't need responses)
      if (response.status === 202) {
        this.log("202 Accepted response (no body)");
        return;
      } else if (contentType?.includes("text/event-stream")) {
        // Handle SSE response
        this.log("SSE stream response initiated");
        await this.processStream(response, hasRequests);
      } else if (contentType?.includes("application/json")) {
        // Handle JSON response
        const json = await response.json();
        
        // Log the JSON response for UI
        this._emitLog({
          type: 'response',
          isSSE: false,
          body: json,
          timestamp: Date.now()
        });
        
        try {
          // Special handling for initialize response
          if (!Array.isArray(json) && 
              'result' in json && 
              json.result && 
              typeof json.result === 'object' && 
              'protocolVersion' in json.result) {
            this.log("Processing initialization response with protocol version", json.result.protocolVersion);
            
            // Extra debug for init response
            console.log("[DirectStreamableHttp] Full initialization response:", JSON.stringify(json, null, 2));
          }
          
          if (Array.isArray(json)) {
            this.log("Processing JSON array response", { length: json.length });
            for (const item of json) {
              const parsedMessage = JSONRPCMessageSchema.parse(item);
              this._transportStats.receivedMessages++;
              this._debugMessage(parsedMessage);
              this.onmessage?.(parsedMessage);
              
              if ('id' in parsedMessage && parsedMessage.id != null && 
                 ('result' in parsedMessage || 'error' in parsedMessage) && 
                  this._pendingRequests.has(parsedMessage.id)) {
                this.log("Clearing pending request", { id: parsedMessage.id });
                this._pendingRequests.delete(parsedMessage.id);
              }
            }
          } else {
            const parsedMessage = JSONRPCMessageSchema.parse(json);
            this._transportStats.receivedMessages++;
            this._debugMessage(parsedMessage);
            
            if ('result' in parsedMessage && parsedMessage.result && 
                typeof parsedMessage.result === 'object' && 
                'sessionId' in parsedMessage.result) {
              this._sessionId = String(parsedMessage.result.sessionId);
              this._transportStats.sessionId = this._sessionId;
              this.log("Set session ID from JSON result", this._sessionId);
            }
            
            this.onmessage?.(parsedMessage);
            
            if ('id' in parsedMessage && parsedMessage.id != null && 
               ('result' in parsedMessage || 'error' in parsedMessage) && 
                this._pendingRequests.has(parsedMessage.id)) {
              this.log("Clearing pending request", { id: parsedMessage.id });
              this._pendingRequests.delete(parsedMessage.id);
            }
          }
        } catch (error) {
          this.log("Error parsing JSON response", error);
          this.onerror?.(error as Error);
        }
      }
    } catch (error) {
      this.log("Error during request", error);
      
      // Emit error log for UI
      this._emitLog({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      });
      
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
    
    // Start listening for server messages if we've established a session
    if (this._hasEstablishedSession && !this._activeStreams.size) {
      // Don't auto-establish during the initialization sequence
      if (!isInitializeRequest && !isInitializedNotification) {
        this.log("Auto-establishing SSE connection after request completed");
        this.listenForServerMessages().catch(err => {
          this.log("Failed to establish server message listener", err);
        });
      }
    }
  }

  private async processStream(response: Response, hasRequests = false): Promise<void> {
    if (!response.body) {
      this.log("Response body is null");
      throw new Error("Response body is null");
    }
    
    const reader = response.body.getReader();
    const streamId = Math.random().toString(36).substring(2, 15);
    this._activeStreams.set(streamId, reader);
    this._transportStats.sseConnectionCount++;
    this._transportStats.activeSSEConnections = this._activeStreams.size;
    
    this.log("Processing SSE stream", { streamId, activeStreams: this._activeStreams.size });
    
    // Emit stream open log for UI
    this._emitLog({
      type: 'sseOpen',
      streamId,
      timestamp: Date.now(),
      isRequest: hasRequests
    });
    
    const textDecoder = new TextDecoder();
    let buffer = "";
    let messageCount = 0;
    let lastDataTime = Date.now();
    const maxIdleTime = 60000; // 60 seconds max idle time
    
    try {
      while (true) {
        // Check for excessive idle time - helps detect "hanging" connections
        const currentTime = Date.now();
        if (currentTime - lastDataTime > maxIdleTime) {
          this.log("Stream idle timeout exceeded", { streamId, idleTime: currentTime - lastDataTime });
          throw new Error("Stream idle timeout exceeded");
        }
        
        // Use an AbortController to handle potential network stalls
        const readAbortController = new AbortController();
        const readTimeoutId = setTimeout(() => {
          readAbortController.abort();
        }, 30000); // 30 second read timeout
        
        // Wrap the read in a Promise with our own AbortController
        const readPromise = Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            readAbortController.signal.addEventListener('abort', () => {
              reject(new Error("Stream read timed out"));
            });
          })
        ]);
        
        let readResult;
        try {
          readResult = await readPromise;
          clearTimeout(readTimeoutId);
        } catch (error) {
          clearTimeout(readTimeoutId);
          this.log("Read timeout or error", { streamId, error });
          throw error; // Rethrow to be caught by the outer try/catch
        }
        
        const { done, value } = readResult as ReadableStreamReadResult<Uint8Array>;
        
        if (done) {
          this.log("SSE stream completed", { streamId, messagesProcessed: messageCount });
          
          // Emit stream close log for UI
          this._emitLog({
            type: 'sseClose',
            streamId,
            reason: 'Stream completed normally',
            timestamp: Date.now()
          });
          
          break;
        }
        
        // Reset idle timer when we receive data
        lastDataTime = Date.now();
        
        const chunk = textDecoder.decode(value, { stream: true });
        this.log("SSE chunk received", { 
          streamId,
          size: value.length,
          preview: chunk.substring(0, 50).replace(/\n/g, "\\n") + (chunk.length > 50 ? '...' : '')
        });
        
        buffer += chunk;
        
        const events = buffer.split(/\n\n/);
        buffer = events.pop() || "";
        
        if (events.length > 0) {
          this.log("SSE events found in buffer", { count: events.length });
        }
        
        for (const event of events) {
          const lines = event.split(/\r\n|\r|\n/);
          let currentData = "";
          let currentId = "";
          let eventType = "message";
          
          for (const line of lines) {
            if (line.startsWith("data:")) {
              currentData += line.substring(5).trim();
            } else if (line.startsWith("id:")) {
              currentId = line.substring(3).trim();
            } else if (line.startsWith("event:")) {
              eventType = line.substring(6).trim();
            }
          }
          
          if (eventType === "message" && currentData) {
            messageCount++;
            this.log("Processing SSE message", { 
              streamId, 
              eventType, 
              hasId: !!currentId,
              dataPreview: currentData.substring(0, 50) + (currentData.length > 50 ? '...' : '')
            });
            
            try {
              const parsedData = JSON.parse(currentData);
              const message = JSONRPCMessageSchema.parse(parsedData);
              this._transportStats.receivedMessages++;
              this._debugMessage(message);
              
              // Emit SSE message log for UI
              this._emitLog({
                type: 'sseMessage',
                streamId,
                data: message,
                id: currentId,
                timestamp: Date.now()
              });
              
              if (currentId) {
                this._lastEventId = currentId;
                this.log("Set last event ID", currentId);
              }
              
              this.onmessage?.(message);
              
              if ('id' in message && message.id != null && 
                 ('result' in message || 'error' in message) && 
                  this._pendingRequests.has(message.id)) {
                this.log("Clearing pending request from SSE", { id: message.id });
                this._pendingRequests.delete(message.id);
                
                if (hasRequests && this._pendingRequests.size === 0) {
                  this.log("All requests completed, cancelling SSE reader", { streamId });
                  reader.cancel();
                  break;
                }
              }
            } catch (error) {
              this.log("Error parsing SSE message", error);
              this.onerror?.(error instanceof Error ? error : new Error(String(error)));
            }
          } else if (event.trim()) {
            this.log("Received SSE event without data or with non-message type", { 
              eventType, 
              content: event.substring(0, 100)
            });
          }
        }
      }
    } catch (error) {
      this.log("Error in SSE stream processing", { streamId, error });
      
      // Emit stream error log for UI
      this._emitLog({
        type: 'sseClose',
        streamId,
        reason: error instanceof Error ? error.message : String(error),
        error: true,
        timestamp: Date.now()
      });
      
      if (!this._closed) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      this._activeStreams.delete(streamId);
      this._transportStats.activeSSEConnections = this._activeStreams.size;
      this.log("SSE stream cleanup", { streamId, remainingStreams: this._activeStreams.size });
    }
  }

  async listenForServerMessages(): Promise<void> {
    if (this._closed) {
      this.log("Cannot listen for server messages: transport is closed");
      return;
    }
    
    if (!this._sessionId) {
      this.log("Cannot establish server-side listener without a session ID");
      throw new Error("Cannot establish server-side listener without a session ID");
    }
    
    if (this._activeStreams.size > 0) {
      this.log("Server listener already active, skipping");
      return;
    }
    
    const headers = new Headers(this._headers);
    headers.set("Accept", "text/event-stream");
    headers.set("Mcp-Session-Id", this._sessionId);
    
    if (this._lastEventId) {
      headers.set("Last-Event-ID", this._lastEventId);
      this.log("Including Last-Event-ID in GET request", this._lastEventId);
    }
    
    try {
      this.logInit(4, "Step 4: Establishing SSE connection via HTTP GET", {
        url: this._url.toString(),
        sessionId: this._sessionId,
        hasLastEventId: !!this._lastEventId
      });
      
      const response = await fetch(this._url.toString(), {
        method: "GET",
        headers,
        credentials: this._useCredentials ? "include" : "same-origin"
      });
      
      if (!response.ok) {
        if (response.status === 405) {
          this.log("Server doesn't support GET method for server-initiated messages (405)");
          return;
        } else if (response.status === 404 && this._sessionId) {
          this.log("Session expired during GET request (404)");
          this._sessionId = undefined;
          this._hasEstablishedSession = false;
          this._transportStats.sessionId = undefined;
          throw new Error("Session expired");
        }
        
        const text = await response.text().catch(() => "Unknown error");
        this.log("Error response from GET request", { status: response.status, text });
        throw new DirectTransportError(response.status, text, response);
      }
      
      const contentType = response.headers.get("Content-Type");
      this.log("GET response received", { 
        status: response.status, 
        contentType 
      });
      
      const sessionId = response.headers.get("Mcp-Session-Id");
      if (sessionId) {
        this._sessionId = sessionId;
        this._transportStats.sessionId = sessionId;
        this.log("Updated session ID from GET response", sessionId);
      }
      
      if (!contentType?.includes("text/event-stream")) {
        this.log("WARNING: GET response is not SSE stream", { contentType });
      }
      
      this.log("Processing SSE stream from GET request");
      await this.processStream(response);
      
      // Connection closed successfully - reset reconnect attempts
      this._reconnectAttempts = 0;
      
      if (!this._closed && this._sessionId) {
        this.log("SSE stream closed normally, reconnecting immediately");
        this.listenForServerMessages().catch(() => {
          this.log("Failed to reconnect to server messages");
          this._scheduleReconnect();
        });
      }
    } catch (error) {
      this.log("Error in listenForServerMessages", error);
      
      // Emit error log for UI
      this._emitLog({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      });
      
      if (!this._closed) {
        this._scheduleReconnect();
      }
      
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
  
  private _scheduleReconnect(): void {
    if (this._reconnectTimeout) {
      clearTimeout(this._reconnectTimeout);
    }
    
    // Exponential backoff with jitter
    // Start with 1 second, max out at ~30 seconds
    const maxRetryDelayMs = 30000;
    const baseDelayMs = 1000;
    this._reconnectAttempts++;
    
    // Calculate delay with exponential backoff and some jitter
    const exponentialDelay = Math.min(
      maxRetryDelayMs,
      baseDelayMs * Math.pow(1.5, Math.min(this._reconnectAttempts, 10))
    );
    const jitter = Math.random() * 0.3 * exponentialDelay;
    const delayMs = exponentialDelay + jitter;
    
    this.log(`Scheduling reconnect attempt ${this._reconnectAttempts} in ${Math.round(delayMs)}ms`);
    
    this._reconnectTimeout = setTimeout(() => {
      if (!this._closed && this._sessionId) {
        this.log(`Reconnect attempt ${this._reconnectAttempts}`);
        this.listenForServerMessages().catch(() => {
          this.log(`Reconnect attempt ${this._reconnectAttempts} failed`);
          this._scheduleReconnect();
        });
      }
    }, delayMs);
  }

  async close(): Promise<void> {
    this.log("Closing transport");
    this._closed = true;
    
    // Emit close notification
    this._emitLog({
      type: 'transport',
      event: 'closed',
      timestamp: Date.now()
    });
    
    if (this._keepAliveInterval) {
      clearInterval(this._keepAliveInterval);
      this._keepAliveInterval = undefined;
    }
    
    if (this._reconnectTimeout) {
      clearTimeout(this._reconnectTimeout);
      this._reconnectTimeout = undefined;
    }
    
    for (const reader of this._activeStreams.values()) {
      try {
        this.log("Cancelling active stream reader");
        await reader.cancel();
      } catch {
        // Ignore
      }
    }
    this._activeStreams.clear();
    this._transportStats.activeSSEConnections = 0;
    
    if (this._sessionId) {
      try {
        const headers = new Headers(this._headers);
        headers.set("Mcp-Session-Id", this._sessionId);
        
        this.log("Sending DELETE to terminate session", { sessionId: this._sessionId });
        await fetch(this._url.toString(), {
          method: "DELETE",
          headers,
          credentials: this._useCredentials ? "include" : "same-origin"
        }).catch(() => {
          // Ignore errors when terminating session
        });
      } catch {
        // Ignore errors when terminating session
      }
    }
    
    this._logCallbacks = []; // Clear all log callbacks
    
    await super.close();
    this.log("Transport closed");
  }

  private _logNormalRequest(message: JSONRPCMessage) {
    if (!this._hasEstablishedSession) return;
    
    // Only log the first few normal flow requests to avoid spam
    const allRequests = this._transportStats.requestCount;
    if (allRequests <= 10 || allRequests % 10 === 0) {
      this.logInit(5, "Step 5: Normal request/response flow", {
        method: 'method' in message ? message.method : 'response',
        hasId: 'id' in message,
        timestamp: new Date().toISOString()
      });
    }
  }
} 
