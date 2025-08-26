// Event stream service for real-time notifications
import type { Response } from "express";
import type { ServerNotification } from "@modelcontextprotocol/sdk/types.js";

export interface MultiServerEvent {
  type:
    | "status_change"
    | "connection_change"
    | "notification"
    | "stderr_notification";
  serverId: string;
  serverName?: string;
  status?: any;
  connection?: any;
  notification?: ServerNotification;
  timestamp: string;
}

class EventStreamService {
  private clients: Set<Response> = new Set();

  /**
   * Add a new SSE client
   */
  addClient(res: Response): void {
    // Set up SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
    });

    // Send initial connection message
    res.write(
      'data: {"type":"connected","timestamp":"' +
        new Date().toISOString() +
        '"}\n\n',
    );

    // Add to clients set
    this.clients.add(res);

    // Handle client disconnect
    res.on("close", () => {
      this.clients.delete(res);
    });

    res.on("error", () => {
      this.clients.delete(res);
    });
  }

  /**
   * Broadcast an event to all connected clients
   */
  broadcast(event: MultiServerEvent): void {
    const data = JSON.stringify(event);
    const message = `data: ${data}\n\n`;

    // Send to all connected clients
    for (const client of this.clients) {
      try {
        client.write(message);
      } catch (error) {
        // Remove client if write fails
        this.clients.delete(client);
      }
    }
  }

  /**
   * Send a notification event
   */
  sendNotification(
    serverId: string,
    serverName: string,
    notification: ServerNotification,
  ): void {
    const event: MultiServerEvent = {
      type: "notification",
      serverId,
      serverName,
      notification,
      timestamp: new Date().toISOString(),
    };

    this.broadcast(event);
  }

  /**
   * Send a status change event
   */
  sendStatusChange(serverId: string, serverName: string, status: any): void {
    const event: MultiServerEvent = {
      type: "status_change",
      serverId,
      serverName,
      status,
      timestamp: new Date().toISOString(),
    };

    this.broadcast(event);
  }

  /**
   * Send a connection change event
   */
  sendConnectionChange(
    serverId: string,
    serverName: string,
    connection: any,
  ): void {
    const event: MultiServerEvent = {
      type: "connection_change",
      serverId,
      serverName,
      connection,
      timestamp: new Date().toISOString(),
    };

    this.broadcast(event);
  }

  /**
   * Send a stderr notification event
   */
  sendStdErrNotification(
    serverId: string,
    notification: ServerNotification,
  ): void {
    const event: MultiServerEvent = {
      type: "stderr_notification",
      serverId,
      notification,
      timestamp: new Date().toISOString(),
    };

    this.broadcast(event);
  }

  /**
   * Send an initialization notification event as a logging message
   */
  sendInitializationNotification(
    serverId: string,
    serverName: string,
    logLevel: string = "info",
  ): void {
    // Create an initialization notification as a logging message (like single-server mode)
    const initializationNotification: ServerNotification = {
      method: "notifications/message",
      params: {
        level: logLevel as any, // Cast to avoid strict type checking
        logger: serverName,
        data: `Logging level set to: ${logLevel}`,
      },
    };

    const event: MultiServerEvent = {
      type: "notification",
      serverId,
      serverName,
      notification: initializationNotification,
      timestamp: new Date().toISOString(),
    };

    this.broadcast(event);
  }

  /**
   * Get the number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Close all connections
   */
  closeAll(): void {
    for (const client of this.clients) {
      try {
        client.end();
      } catch (error) {
        // Ignore errors when closing
      }
    }
    this.clients.clear();
  }
}

// Create singleton instance
export const eventStreamService = new EventStreamService();
