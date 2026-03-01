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

export class RemoteSession {
  public readonly sessionId: string;
  public transport!: Transport;
  private eventQueue: SessionEvent[] = [];
  private eventConsumer: ((event: SessionEvent) => void) | null = null;
  private transportDead: boolean = false;
  private transportError: string | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  setTransport(transport: Transport): void {
    this.transport = transport;
  }

  setEventConsumer(consumer: (event: SessionEvent) => void): void {
    this.eventConsumer = consumer;
    // Flush queued events
    while (this.eventQueue.length > 0) {
      const ev = this.eventQueue.shift()!;
      consumer(ev);
    }
  }

  clearEventConsumer(): boolean {
    this.eventConsumer = null;
    // If transport is dead and no client connected, signal to cleanup
    return this.transportDead;
  }

  markTransportDead(error: string): void {
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

  isTransportDead(): boolean {
    return this.transportDead;
  }

  getTransportError(): string | null {
    return this.transportError;
  }

  hasEventConsumer(): boolean {
    return this.eventConsumer !== null;
  }

  pushEvent(event: SessionEvent): void {
    if (this.eventConsumer) {
      this.eventConsumer(event);
    } else {
      this.eventQueue.push(event);
    }
  }

  onMessage(message: JSONRPCMessage): void {
    this.pushEvent({ type: "message", data: message });
  }

  onFetchRequest(entry: FetchRequestEntryBase): void {
    this.pushEvent({
      type: "fetch_request",
      data: {
        ...entry,
        timestamp:
          entry.timestamp instanceof Date
            ? entry.timestamp.toISOString()
            : entry.timestamp,
      },
    });
  }

  onStderr(entry: { timestamp: Date; message: string }): void {
    this.pushEvent({
      type: "stdio_log",
      data: {
        timestamp: entry.timestamp.toISOString(),
        message: entry.message,
      },
    });
  }
}
