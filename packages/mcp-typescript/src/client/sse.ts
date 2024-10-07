import { Transport } from "../shared/transport.js";
import { JSONRPCMessage, JSONRPCMessageSchema } from "../types.js";

/**
 * Client transport for SSE: this will connect to a server using Server-Sent Events for receiving
 * messages and make separate POST requests for sending messages.
 *
 * This uses the EventSource API in browsers. You can install the `eventsource` package for Node.js.
 */
export class SSEClientTransport implements Transport {
  private _eventSource?: EventSource;
  private _endpoint?: URL;
  private _abortController?: AbortController;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  connect(url: URL): Promise<void> {
    return new Promise((resolve, reject) => {
      this._eventSource = new EventSource(url.href);
      this._abortController = new AbortController();

      this._eventSource.onerror = (event) => {
        const error = new Error(`SSE error: ${JSON.stringify(event)}`);
        reject(error);
        this.onerror?.(error);
      };

      this._eventSource.onopen = () => {
        // The connection is open, but we need to wait for the endpoint to be received.
      };

      this._eventSource.addEventListener("endpoint", (event: Event) => {
        const messageEvent = event as MessageEvent;

        try {
          this._endpoint = new URL(messageEvent.data, url);
          if (this._endpoint.origin !== url.origin) {
            throw new Error(
              `Endpoint origin does not match connection origin: ${this._endpoint.origin}`,
            );
          }
        } catch (error) {
          reject(error);
          this.onerror?.(error as Error);

          void this.close();
          return;
        }

        resolve();
      });

      this._eventSource.onmessage = (event: Event) => {
        const messageEvent = event as MessageEvent;
        let message: JSONRPCMessage;
        try {
          message = JSONRPCMessageSchema.parse(JSON.parse(messageEvent.data));
        } catch (error) {
          this.onerror?.(error as Error);
          return;
        }

        this.onmessage?.(message);
      };
    });
  }

  async close(): Promise<void> {
    this._abortController?.abort();
    this._eventSource?.close();
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
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
        signal: this._abortController?.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => null);
        throw new Error(
          `Error POSTing to endpoint (HTTP ${response.status}): ${text}`,
        );
      }
    } catch (error) {
      this.onerror?.(error as Error);
      throw error;
    }
  }
}
