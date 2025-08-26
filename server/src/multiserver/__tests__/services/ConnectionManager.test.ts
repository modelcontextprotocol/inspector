import { ConnectionManager } from "../../services/ConnectionManager.js";
import { TransportFactory } from "../../utils/transportFactory.js";
import {
  MultiServerConfig,
  StdioServerConfig,
  HttpServerConfig,
} from "../../models/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

// Mock the dependencies
jest.mock("../../utils/transportFactory.js");

describe("ConnectionManager", () => {
  let connectionManager: ConnectionManager;
  let mockTransportFactory: jest.Mocked<TransportFactory>;
  let mockTransport: jest.Mocked<Transport>;

  beforeEach(() => {
    // Create a proper mock Transport that implements all required methods
    mockTransport = {
      start: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      onclose: jest.fn(),
      onerror: jest.fn(),
      onmessage: jest.fn(),
      setProtocolVersion: jest.fn(),
    } as jest.Mocked<Transport>;

    mockTransportFactory =
      new TransportFactory() as jest.Mocked<TransportFactory>;
    mockTransportFactory.createTransportForServer = jest
      .fn()
      .mockResolvedValue(mockTransport);

    connectionManager = new ConnectionManager(mockTransportFactory);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("connectToServer", () => {
    it("should successfully connect to STDIO server", async () => {
      const config: StdioServerConfig = {
        id: "test-stdio-server",
        name: "Test STDIO Server",
        description: "Test server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await connectionManager.connectToServer(config);

      expect(result).toBeDefined();
      expect(result.id).toBe("test-stdio-server");
      expect(result.status).toBe("connected");
      expect(result.lastConnected).toBeDefined();
      expect(result.sessionId).toBeDefined();
      expect(
        mockTransportFactory.createTransportForServer,
      ).toHaveBeenCalledWith(config);
    });

    it("should successfully connect to HTTP server", async () => {
      const config: HttpServerConfig = {
        id: "test-http-server",
        name: "Test HTTP Server",
        description: "Test server",
        transportType: "streamable-http",
        config: {
          url: "http://localhost:3000/mcp",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await connectionManager.connectToServer(config);

      expect(result).toBeDefined();
      expect(result.id).toBe("test-http-server");
      expect(result.status).toBe("connected");
      expect(result.lastConnected).toBeDefined();
      expect(
        mockTransportFactory.createTransportForServer,
      ).toHaveBeenCalledWith(config);
    });

    it("should handle connection errors", async () => {
      const config: StdioServerConfig = {
        id: "failing-server",
        name: "Failing Server",
        description: "Server that fails to connect",
        transportType: "stdio",
        config: {
          command: "nonexistent-command",
          args: [],
          env: {},
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const error = new Error("Connection failed");
      mockTransportFactory.createTransportForServer.mockRejectedValue(error);

      await expect(connectionManager.connectToServer(config)).rejects.toThrow(
        "Connection failed",
      );

      // Check that status was updated to error
      const status = connectionManager.getServerStatus("failing-server");
      expect(status.status).toBe("error");
      expect(status.lastError).toBe("Connection failed");
    });

    it("should update status to connecting before attempting connection", async () => {
      const config: StdioServerConfig = {
        id: "test-server",
        name: "Test Server",
        description: "Test server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock a slow connection to test intermediate state
      let resolveConnection: (value: Transport) => void;
      const connectionPromise = new Promise<Transport>((resolve) => {
        resolveConnection = resolve;
      });
      mockTransportFactory.createTransportForServer.mockReturnValue(
        connectionPromise,
      );

      const connectPromise = connectionManager.connectToServer(config);

      // Check connecting status
      const connectingStatus = connectionManager.getServerStatus("test-server");
      expect(connectingStatus.status).toBe("connecting");
      expect(connectingStatus.sessionId).toBeDefined();

      // Resolve the connection
      resolveConnection!(mockTransport);
      const result = await connectPromise;

      expect(result.status).toBe("connected");
    });
  });

  describe("disconnectFromServer", () => {
    it("should disconnect from connected server", async () => {
      const config: StdioServerConfig = {
        id: "test-server",
        name: "Test Server",
        description: "Test server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // First connect
      await connectionManager.connectToServer(config);
      expect(connectionManager.isServerConnected("test-server")).toBe(true);

      // Then disconnect
      await connectionManager.disconnectFromServer("test-server");

      expect(mockTransport.close).toHaveBeenCalled();
      expect(connectionManager.isServerConnected("test-server")).toBe(false);

      const status = connectionManager.getServerStatus("test-server");
      expect(status.status).toBe("disconnected");
      expect(status.sessionId).toBeUndefined();
    });

    it("should handle disconnection from non-connected server", async () => {
      // Should not throw error when disconnecting from non-connected server
      await expect(
        connectionManager.disconnectFromServer("non-existent-server"),
      ).resolves.not.toThrow();

      const status = connectionManager.getServerStatus("non-existent-server");
      expect(status.status).toBe("disconnected");
    });

    it("should handle transport close errors gracefully", async () => {
      const config: StdioServerConfig = {
        id: "test-server",
        name: "Test Server",
        description: "Test server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Connect first
      await connectionManager.connectToServer(config);

      // Mock transport close to throw error
      mockTransport.close.mockRejectedValue(new Error("Close failed"));

      // Should not throw error, but handle gracefully
      await expect(
        connectionManager.disconnectFromServer("test-server"),
      ).resolves.not.toThrow();

      // Status should still be updated to disconnected
      const status = connectionManager.getServerStatus("test-server");
      expect(status.status).toBe("disconnected");
    });
  });

  describe("getServerStatus", () => {
    it("should return disconnected status for unknown server", () => {
      const status = connectionManager.getServerStatus("unknown-server");

      expect(status).toBeDefined();
      expect(status.id).toBe("unknown-server");
      expect(status.status).toBe("disconnected");
    });

    it("should return current status for known server", async () => {
      const config: StdioServerConfig = {
        id: "test-server",
        name: "Test Server",
        description: "Test server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await connectionManager.connectToServer(config);

      const status = connectionManager.getServerStatus("test-server");
      expect(status.id).toBe("test-server");
      expect(status.status).toBe("connected");
      expect(status.lastConnected).toBeDefined();
      expect(status.sessionId).toBeDefined();
    });
  });

  describe("getAllServerStatuses", () => {
    it("should return empty array initially", () => {
      const statuses = connectionManager.getAllServerStatuses();
      expect(statuses).toEqual([]);
    });

    it("should return all server statuses", async () => {
      const config1: StdioServerConfig = {
        id: "server-1",
        name: "Server 1",
        description: "First server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server1.js"],
          env: {},
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const config2: HttpServerConfig = {
        id: "server-2",
        name: "Server 2",
        description: "Second server",
        transportType: "streamable-http",
        config: {
          url: "http://localhost:3000/mcp",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await connectionManager.connectToServer(config1);
      await connectionManager.connectToServer(config2);

      const statuses = connectionManager.getAllServerStatuses();
      expect(statuses).toHaveLength(2);
      expect(statuses.map((s) => s.id)).toContain("server-1");
      expect(statuses.map((s) => s.id)).toContain("server-2");
      expect(statuses.every((s) => s.status === "connected")).toBe(true);
    });
  });

  describe("isServerConnected", () => {
    it("should return false for unknown server", () => {
      expect(connectionManager.isServerConnected("unknown-server")).toBe(false);
    });

    it("should return true for connected server", async () => {
      const config: StdioServerConfig = {
        id: "test-server",
        name: "Test Server",
        description: "Test server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await connectionManager.connectToServer(config);
      expect(connectionManager.isServerConnected("test-server")).toBe(true);
    });

    it("should return false for disconnected server", async () => {
      const config: StdioServerConfig = {
        id: "test-server",
        name: "Test Server",
        description: "Test server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await connectionManager.connectToServer(config);
      await connectionManager.disconnectFromServer("test-server");
      expect(connectionManager.isServerConnected("test-server")).toBe(false);
    });
  });

  describe("getActiveConnections", () => {
    it("should return empty map initially", () => {
      const connections = connectionManager.getActiveConnections();
      expect(connections.size).toBe(0);
    });

    it("should return active connections", async () => {
      const config: StdioServerConfig = {
        id: "test-server",
        name: "Test Server",
        description: "Test server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await connectionManager.connectToServer(config);

      const connections = connectionManager.getActiveConnections();
      expect(connections.size).toBe(1);
      expect(connections.has("test-server")).toBe(true);
      expect(connections.get("test-server")).toBe(mockTransport);
    });
  });

  describe("getConnection", () => {
    it("should return undefined for non-existent connection", () => {
      const connection = connectionManager.getConnection("non-existent");
      expect(connection).toBeUndefined();
    });

    it("should return transport for active connection", async () => {
      const config: StdioServerConfig = {
        id: "test-server",
        name: "Test Server",
        description: "Test server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await connectionManager.connectToServer(config);

      const connection = connectionManager.getConnection("test-server");
      expect(connection).toBe(mockTransport);
    });
  });

  describe("disconnectAll", () => {
    it("should disconnect all servers", async () => {
      const config1: StdioServerConfig = {
        id: "server-1",
        name: "Server 1",
        description: "First server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server1.js"],
          env: {},
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const config2: HttpServerConfig = {
        id: "server-2",
        name: "Server 2",
        description: "Second server",
        transportType: "streamable-http",
        config: {
          url: "http://localhost:3000/mcp",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await connectionManager.connectToServer(config1);
      await connectionManager.connectToServer(config2);

      expect(connectionManager.getConnectionCount()).toBe(2);

      await connectionManager.disconnectAll();

      expect(connectionManager.getConnectionCount()).toBe(0);
      expect(connectionManager.isServerConnected("server-1")).toBe(false);
      expect(connectionManager.isServerConnected("server-2")).toBe(false);
    });

    it("should handle errors during disconnectAll gracefully", async () => {
      const config: StdioServerConfig = {
        id: "test-server",
        name: "Test Server",
        description: "Test server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await connectionManager.connectToServer(config);

      // Mock transport close to throw error
      mockTransport.close.mockRejectedValue(new Error("Close failed"));

      // Should not throw error
      await expect(connectionManager.disconnectAll()).resolves.not.toThrow();

      // Connection should still be cleaned up
      expect(connectionManager.getConnectionCount()).toBe(0);
    });
  });

  describe("utility methods", () => {
    it("should return correct connection count", async () => {
      expect(connectionManager.getConnectionCount()).toBe(0);

      const config: StdioServerConfig = {
        id: "test-server",
        name: "Test Server",
        description: "Test server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await connectionManager.connectToServer(config);
      expect(connectionManager.getConnectionCount()).toBe(1);

      await connectionManager.disconnectFromServer("test-server");
      expect(connectionManager.getConnectionCount()).toBe(0);
    });

    it("should return correct status count", async () => {
      expect(connectionManager.getStatusCount()).toBe(0);

      const config: StdioServerConfig = {
        id: "test-server",
        name: "Test Server",
        description: "Test server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await connectionManager.connectToServer(config);
      expect(connectionManager.getStatusCount()).toBe(1);

      // Status should remain even after disconnection
      await connectionManager.disconnectFromServer("test-server");
      expect(connectionManager.getStatusCount()).toBe(1);
    });
  });
});
