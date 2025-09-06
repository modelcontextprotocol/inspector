import { jest } from "@jest/globals";
import mcpProxy from "../mcpProxy.js";

// Mock transport interface
interface MockTransport {
  sessionId?: string;
  onmessage: ((message: any) => void) | null;
  onclose: (() => void) | null;
  onerror: ((error: Error) => void) | null;
  send: jest.Mock;
  close: jest.Mock;
}

// Create mock transport
function createMockTransport(sessionId?: string): MockTransport {
  return {
    sessionId,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

describe("mcpProxy", () => {
  let mockClientTransport: MockTransport;
  let mockServerTransport: MockTransport;
  let mockCleanup: jest.Mock;

  beforeEach(() => {
    mockClientTransport = createMockTransport("client-session-123");
    mockServerTransport = createMockTransport("server-session-456");
    mockCleanup = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("message forwarding", () => {
    it("should forward messages from client to server", async () => {
      mcpProxy({
        transportToClient: mockClientTransport as any,
        transportToServer: mockServerTransport as any,
        onCleanup: mockCleanup,
      });

      const testMessage = {
        jsonrpc: "2.0" as const,
        method: "test/method",
        params: { test: "data" },
        id: 1,
      };

      // Simulate client message
      mockClientTransport.onmessage!(testMessage);

      expect(mockServerTransport.send).toHaveBeenCalledWith(testMessage);
    });

    it("should forward messages from server to client", async () => {
      mcpProxy({
        transportToClient: mockClientTransport as any,
        transportToServer: mockServerTransport as any,
        onCleanup: mockCleanup,
      });

      const testMessage = {
        jsonrpc: "2.0" as const,
        result: { test: "response" },
        id: 1,
      };

      // Simulate server message
      mockServerTransport.onmessage!(testMessage);

      expect(mockClientTransport.send).toHaveBeenCalledWith(testMessage);
    });
  });

  describe("error handling", () => {
    it("should send error response when server send fails for request", async () => {
      const serverError = new Error("Server send failed");
      mockServerTransport.send.mockRejectedValue(serverError);

      mcpProxy({
        transportToClient: mockClientTransport as any,
        transportToServer: mockServerTransport as any,
        onCleanup: mockCleanup,
      });

      const testRequest = {
        jsonrpc: "2.0" as const,
        method: "test/method",
        params: { test: "data" },
        id: 1,
      };

      // Simulate client request that fails on server
      mockClientTransport.onmessage!(testRequest);

      // Wait for the async error handling
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockClientTransport.send).toHaveBeenCalledWith({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32001,
          message: "Server send failed",
          data: serverError,
        },
      });
    });

    it("should not send error response when client transport is closed", async () => {
      const serverError = new Error("Server send failed");
      mockServerTransport.send.mockRejectedValue(serverError);

      mcpProxy({
        transportToClient: mockClientTransport as any,
        transportToServer: mockServerTransport as any,
        onCleanup: mockCleanup,
      });

      // Close client transport first
      mockClientTransport.onclose!();

      const testRequest = {
        jsonrpc: "2.0" as const,
        method: "test/method",
        params: { test: "data" },
        id: 1,
      };

      // Now try to send message
      mockClientTransport.onmessage!(testRequest);

      // Wait for the async error handling
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should not send error response since client transport is closed
      expect(mockClientTransport.send).toHaveBeenCalledTimes(0);
    });

    it("should not send error response for notifications (no id)", async () => {
      const serverError = new Error("Server send failed");
      mockServerTransport.send.mockRejectedValue(serverError);

      mcpProxy({
        transportToClient: mockClientTransport as any,
        transportToServer: mockServerTransport as any,
        onCleanup: mockCleanup,
      });

      const testNotification = {
        jsonrpc: "2.0" as const,
        method: "test/notification",
        params: { test: "data" },
      };

      // Simulate client notification that fails on server
      mockClientTransport.onmessage!(testNotification);

      // Wait for the async error handling
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should not send error response for notifications
      expect(mockClientTransport.send).toHaveBeenCalledTimes(0);
    });
  });

  describe("connection cleanup", () => {
    it("should call cleanup when client transport closes", () => {
      mcpProxy({
        transportToClient: mockClientTransport as any,
        transportToServer: mockServerTransport as any,
        onCleanup: mockCleanup,
      });

      // Simulate client transport closing
      mockClientTransport.onclose!();

      expect(mockCleanup).toHaveBeenCalledTimes(1);
      expect(mockServerTransport.close).toHaveBeenCalledTimes(1);
    });

    it("should call cleanup when server transport closes", () => {
      mcpProxy({
        transportToClient: mockClientTransport as any,
        transportToServer: mockServerTransport as any,
        onCleanup: mockCleanup,
      });

      // Simulate server transport closing
      mockServerTransport.onclose!();

      expect(mockCleanup).toHaveBeenCalledTimes(1);
      expect(mockClientTransport.close).toHaveBeenCalledTimes(1);
    });

    it("should not call cleanup twice if both transports close", () => {
      mcpProxy({
        transportToClient: mockClientTransport as any,
        transportToServer: mockServerTransport as any,
        onCleanup: mockCleanup,
      });

      // Simulate both transports closing
      mockClientTransport.onclose!();
      mockServerTransport.onclose!();

      expect(mockCleanup).toHaveBeenCalledTimes(1);
    });

    it("should work without cleanup callback", () => {
      expect(() => {
        mcpProxy({
          transportToClient: mockClientTransport as any,
          transportToServer: mockServerTransport as any,
        });

        // Should not throw when cleanup is not provided
        mockClientTransport.onclose!();
      }).not.toThrow();
    });

    it("should handle cleanup callback errors gracefully", () => {
      const errorCleanup = jest.fn().mockImplementation(() => {
        throw new Error("Cleanup failed");
      });

      expect(() => {
        mcpProxy({
          transportToClient: mockClientTransport as any,
          transportToServer: mockServerTransport as any,
          onCleanup: errorCleanup,
        });

        // Should not throw even if cleanup fails
        mockClientTransport.onclose!();
      }).not.toThrow();

      expect(errorCleanup).toHaveBeenCalledTimes(1);
    });
  });

  describe("transport close synchronization", () => {
    it("should not close server transport if already closed by server", () => {
      mcpProxy({
        transportToClient: mockClientTransport as any,
        transportToServer: mockServerTransport as any,
        onCleanup: mockCleanup,
      });

      // First, server transport closes
      mockServerTransport.onclose!();

      // Reset mock to check if close is called again
      mockServerTransport.close.mockClear();

      // Then client transport tries to close
      mockClientTransport.onclose!();

      // Server transport should not be closed again
      expect(mockServerTransport.close).toHaveBeenCalledTimes(0);
      expect(mockCleanup).toHaveBeenCalledTimes(1);
    });

    it("should not close client transport if already closed by client", () => {
      mcpProxy({
        transportToClient: mockClientTransport as any,
        transportToServer: mockServerTransport as any,
        onCleanup: mockCleanup,
      });

      // First, client transport closes
      mockClientTransport.onclose!();

      // Reset mock to check if close is called again
      mockClientTransport.close.mockClear();

      // Then server transport tries to close
      mockServerTransport.onclose!();

      // Client transport should not be closed again
      expect(mockClientTransport.close).toHaveBeenCalledTimes(0);
      expect(mockCleanup).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handlers", () => {
    it("should set error handlers on both transports", () => {
      mcpProxy({
        transportToClient: mockClientTransport as any,
        transportToServer: mockServerTransport as any,
        onCleanup: mockCleanup,
      });

      expect(mockClientTransport.onerror).toBeTruthy();
      expect(mockServerTransport.onerror).toBeTruthy();
    });

    it("should handle client errors without throwing", () => {
      mcpProxy({
        transportToClient: mockClientTransport as any,
        transportToServer: mockServerTransport as any,
        onCleanup: mockCleanup,
      });

      const testError = new Error("Client error");
      expect(() => {
        mockClientTransport.onerror!(testError);
      }).not.toThrow();
    });

    it("should handle server errors without throwing", () => {
      mcpProxy({
        transportToClient: mockClientTransport as any,
        transportToServer: mockServerTransport as any,
        onCleanup: mockCleanup,
      });

      const testError = new Error("Server error");
      expect(() => {
        mockServerTransport.onerror!(testError);
      }).not.toThrow();
    });
  });
});