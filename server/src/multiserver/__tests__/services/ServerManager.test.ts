import { ServerManager } from "../../services/ServerManager.js";
import { ConnectionManager } from "../../services/ConnectionManager.js";
import { TransportFactory } from "../../utils/transportFactory.js";
import {
  CreateServerRequest,
  UpdateServerRequest,
  MultiServerConfig,
} from "../../models/types.js";

// Mock the dependencies
jest.mock("../../services/ConnectionManager.js");
jest.mock("../../utils/transportFactory.js");

describe("ServerManager", () => {
  let serverManager: ServerManager;
  let mockConnectionManager: jest.Mocked<ConnectionManager>;
  let mockTransportFactory: jest.Mocked<TransportFactory>;

  beforeEach(() => {
    mockTransportFactory =
      new TransportFactory() as jest.Mocked<TransportFactory>;
    mockConnectionManager = new ConnectionManager(
      mockTransportFactory,
    ) as jest.Mocked<ConnectionManager>;
    serverManager = new ServerManager(mockConnectionManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("createServer", () => {
    it("should create a valid STDIO server configuration", async () => {
      const request: CreateServerRequest = {
        name: "test-stdio-server",
        description: "Test STDIO server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
      };

      const result = await serverManager.createServer(request);

      expect(result).toBeDefined();
      expect(result.name).toBe("test-stdio-server");
      expect(result.id).toBeDefined();
      expect(result.transportType).toBe("stdio");
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();

      // Verify nested config structure
      expect((result as any).config).toBeDefined();
      expect((result as any).config.command).toBe("node");
      expect((result as any).config.args).toEqual(["server.js"]);
      expect((result as any).config.env).toEqual({});
    });

    it("should create a valid HTTP server configuration", async () => {
      const request: CreateServerRequest = {
        name: "test-http-server",
        description: "Test HTTP server",
        transportType: "streamable-http",
        config: {
          url: "http://localhost:3000/mcp",
          headers: { Authorization: "Bearer token" },
          bearerToken: "test-token",
        },
      };

      const result = await serverManager.createServer(request);

      expect(result).toBeDefined();
      expect(result.name).toBe("test-http-server");
      expect(result.transportType).toBe("streamable-http");

      // Verify nested config structure
      expect((result as any).config).toBeDefined();
      expect((result as any).config.url).toBe("http://localhost:3000/mcp");
      expect((result as any).config.headers).toEqual({
        Authorization: "Bearer token",
      });
      expect((result as any).config.bearerToken).toBe("test-token");
    });

    it("should throw error for invalid server configuration", async () => {
      const invalidRequest = {
        name: "", // Invalid: empty name
        description: "Test server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
      } as CreateServerRequest;

      await expect(serverManager.createServer(invalidRequest)).rejects.toThrow(
        "Invalid server configuration",
      );
    });

    it("should throw error for unsupported transport type", async () => {
      const request = {
        name: "test-server",
        description: "Test server",
        transportType: "unsupported",
        config: {},
      } as unknown as CreateServerRequest;

      await expect(serverManager.createServer(request)).rejects.toThrow(
        "Invalid server configuration",
      );
    });
  });

  describe("getServer", () => {
    it("should return existing server", async () => {
      const request: CreateServerRequest = {
        name: "test-server",
        description: "Test server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
      };

      const createdServer = await serverManager.createServer(request);
      const result = await serverManager.getServer(createdServer.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(createdServer.id);
      expect(result?.name).toBe("test-server");
    });

    it("should return null for non-existent server", async () => {
      const result = await serverManager.getServer("non-existent-id");
      expect(result).toBeNull();
    });
  });

  describe("getAllServers", () => {
    it("should return empty list initially", async () => {
      const result = await serverManager.getAllServers();
      expect(result).toEqual([]);
    });

    it("should return all created servers", async () => {
      const request1: CreateServerRequest = {
        name: "server-1",
        description: "Server 1",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server1.js"],
          env: {},
        },
      };

      const request2: CreateServerRequest = {
        name: "server-2",
        description: "Server 2",
        transportType: "streamable-http",
        config: {
          url: "http://localhost:3000/mcp",
        },
      };

      await serverManager.createServer(request1);
      await serverManager.createServer(request2);

      const result = await serverManager.getAllServers();

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.name)).toContain("server-1");
      expect(result.map((s) => s.name)).toContain("server-2");
    });
  });

  describe("updateServer", () => {
    it("should update existing server configuration", async () => {
      const request: CreateServerRequest = {
        name: "original-server",
        description: "Original description",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
      };

      const createdServer = await serverManager.createServer(request);

      // Add a small delay to ensure updatedAt is different from createdAt
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updates: UpdateServerRequest = {
        name: "updated-server",
        description: "Updated description",
      };

      const result = await serverManager.updateServer(
        createdServer.id,
        updates,
      );

      expect(result.name).toBe("updated-server");
      expect(result.description).toBe("Updated description");
      expect(result.id).toBe(createdServer.id); // ID should not change
      expect(result.updatedAt.getTime()).toBeGreaterThan(
        result.createdAt.getTime(),
      );
    });

    it("should throw error for non-existent server", async () => {
      const updates: UpdateServerRequest = {
        name: "new-name",
      };

      await expect(
        serverManager.updateServer("non-existent-id", updates),
      ).rejects.toThrow("not found");
    });

    it("should update config for STDIO server", async () => {
      const request: CreateServerRequest = {
        name: "stdio-server",
        description: "STDIO server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
      };

      const createdServer = await serverManager.createServer(request);

      const updates: UpdateServerRequest = {
        config: {
          command: "npm",
          args: ["start"],
          env: {},
        },
      };

      const result = await serverManager.updateServer(
        createdServer.id,
        updates,
      );

      expect((result as any).config.command).toBe("npm");
      expect((result as any).config.args).toEqual(["start"]);
    });
  });

  describe("deleteServer", () => {
    it("should delete existing server", async () => {
      const request: CreateServerRequest = {
        name: "server-to-delete",
        description: "Server to be deleted",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
      };

      const createdServer = await serverManager.createServer(request);

      // Mock connection manager methods
      mockConnectionManager.isServerConnected.mockResolvedValue(false);

      await serverManager.deleteServer(createdServer.id);

      // Verify server is deleted
      const result = await serverManager.getServer(createdServer.id);
      expect(result).toBeNull();
    });

    it("should disconnect server before deletion if connected", async () => {
      const request: CreateServerRequest = {
        name: "connected-server",
        description: "Connected server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
      };

      const createdServer = await serverManager.createServer(request);

      // Mock connection manager methods
      mockConnectionManager.isServerConnected.mockResolvedValue(true);
      mockConnectionManager.disconnectFromServer.mockResolvedValue();

      await serverManager.deleteServer(createdServer.id);

      expect(mockConnectionManager.disconnectFromServer).toHaveBeenCalledWith(
        createdServer.id,
      );
    });

    it("should throw error for non-existent server", async () => {
      await expect(
        serverManager.deleteServer("non-existent-id"),
      ).rejects.toThrow("not found");
    });
  });

  describe("validateServerConfig", () => {
    it("should validate valid STDIO configuration", () => {
      const config: CreateServerRequest = {
        name: "valid-server",
        description: "Valid server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
      };

      const result = serverManager.validateServerConfig(config);

      expect(result.isValid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("should reject invalid configuration", () => {
      const config = {
        name: "", // Invalid: empty name
        description: "Test server",
        transportType: "stdio",
        config: {
          command: "node",
          env: {},
        },
      } as CreateServerRequest;

      const result = serverManager.validateServerConfig(config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });
  });

  describe("utility methods", () => {
    it("should return correct server count", async () => {
      expect(serverManager.getServerCount()).toBe(0);

      const request: CreateServerRequest = {
        name: "test-server",
        description: "Test server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
      };

      await serverManager.createServer(request);
      expect(serverManager.getServerCount()).toBe(1);
    });

    it("should check if server exists", async () => {
      const request: CreateServerRequest = {
        name: "test-server",
        description: "Test server",
        transportType: "stdio",
        config: {
          command: "node",
          args: ["server.js"],
          env: {},
        },
      };

      const createdServer = await serverManager.createServer(request);

      expect(serverManager.hasServer(createdServer.id)).toBe(true);
      expect(serverManager.hasServer("non-existent-id")).toBe(false);
    });
  });
});
