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

  clearEventConsumer(): void {
    this.eventConsumer = null;
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
