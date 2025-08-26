import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import {
  LoggingLevelManager,
  loggingLevelManager,
} from "../utils/loggingLevelManager.js";
import { ConnectionManager } from "../services/ConnectionManager.js";
import { TransportFactory } from "../utils/transportFactory.js";
import { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";

// Mock the transport factory
const mockTransportFactory = {
  createTransportForServer: jest.fn(),
} as unknown as TransportFactory;

describe("LoggingLevelManager", () => {
  let manager: LoggingLevelManager;

  beforeEach(() => {
    manager = new LoggingLevelManager();
  });

  afterEach(() => {
    // Clean up any timers
    jest.clearAllTimers();
  });

  describe("setServerLogLevel", () => {
    it("should set and track logging level for a server", () => {
      const serverId = "test-server-1";
      const level: LoggingLevel = "debug";

      manager.setServerLogLevel(serverId, level);

      expect(manager.getExpectedLevel(serverId)).toBe(level);
      expect(manager.hasRecentUpdate(serverId)).toBe(true);
    });

    it("should handle multiple rapid level changes", () => {
      const serverId = "test-server-1";
      const levels: LoggingLevel[] = ["debug", "info", "warning", "error"];

      levels.forEach((level) => {
        manager.setServerLogLevel(serverId, level);
      });

      // Should have the last level set
      expect(manager.getExpectedLevel(serverId)).toBe("error");

      // Should have all levels in the queue
      const pendingLevel = manager.getPendingLevel(serverId);
      expect(pendingLevel).toBe("error");
    });

    it("should limit queue size to prevent memory issues", () => {
      const serverId = "test-server-1";

      // Add more than MAX_QUEUE_SIZE levels
      for (let i = 0; i < 15; i++) {
        const level: LoggingLevel = i % 2 === 0 ? "debug" : "info";
        manager.setServerLogLevel(serverId, level);
      }

      const debugInfo = manager.getDebugInfo();
      const queue = debugInfo.updateQueues[serverId];

      // Queue should be limited to MAX_QUEUE_SIZE (10)
      expect(queue.length).toBeLessThanOrEqual(10);
    });
  });

  describe("shouldCorrectNotificationLevel", () => {
    it("should return true when levels differ and update is recent", () => {
      const serverId = "test-server-1";
      const expectedLevel: LoggingLevel = "debug";
      const notificationLevel: LoggingLevel = "info";

      manager.setServerLogLevel(serverId, expectedLevel);

      expect(
        manager.shouldCorrectNotificationLevel(serverId, notificationLevel),
      ).toBe(true);
    });

    it("should return false when levels match", () => {
      const serverId = "test-server-1";
      const level: LoggingLevel = "debug";

      manager.setServerLogLevel(serverId, level);

      expect(manager.shouldCorrectNotificationLevel(serverId, level)).toBe(
        false,
      );
    });

    it("should return false when no expected level is set", () => {
      const serverId = "test-server-1";
      const notificationLevel: LoggingLevel = "info";

      expect(
        manager.shouldCorrectNotificationLevel(serverId, notificationLevel),
      ).toBe(false);
    });
  });

  describe("consumePendingLevel", () => {
    it("should consume and remove pending levels from queue", () => {
      const serverId = "test-server-1";
      const levels: LoggingLevel[] = ["debug", "info", "warning"];

      levels.forEach((level) => {
        manager.setServerLogLevel(serverId, level);
      });

      // Consume levels one by one
      expect(manager.consumePendingLevel(serverId)).toBe("debug");
      expect(manager.consumePendingLevel(serverId)).toBe("info");
      expect(manager.consumePendingLevel(serverId)).toBe("warning");
      expect(manager.consumePendingLevel(serverId)).toBeUndefined();
    });
  });

  describe("cleanup functionality", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should clean up expired updates", () => {
      const serverId = "test-server-1";
      const level: LoggingLevel = "debug";

      manager.setServerLogLevel(serverId, level);
      expect(manager.hasRecentUpdate(serverId)).toBe(true);

      // Fast-forward time beyond timeout
      jest.advanceTimersByTime(6000); // 6 seconds > 5 second timeout

      expect(manager.hasRecentUpdate(serverId)).toBe(false);
      expect(manager.getExpectedLevel(serverId)).toBeUndefined();
    });

    it("should clean up all expired updates", () => {
      const serverIds = ["server-1", "server-2", "server-3"];
      const level: LoggingLevel = "debug";

      serverIds.forEach((serverId) => {
        manager.setServerLogLevel(serverId, level);
      });

      // Verify all are set
      serverIds.forEach((serverId) => {
        expect(manager.hasRecentUpdate(serverId)).toBe(true);
      });

      // Fast-forward time
      jest.advanceTimersByTime(6000);

      // Clean up all expired
      manager.cleanupAllExpiredUpdates();

      // Verify all are cleaned up
      serverIds.forEach((serverId) => {
        expect(manager.hasRecentUpdate(serverId)).toBe(false);
      });
    });
  });

  describe("removeServer", () => {
    it("should remove all data for a server", () => {
      const serverId = "test-server-1";
      const level: LoggingLevel = "debug";

      manager.setServerLogLevel(serverId, level);
      expect(manager.getExpectedLevel(serverId)).toBe(level);

      manager.removeServer(serverId);

      expect(manager.getExpectedLevel(serverId)).toBeUndefined();
      expect(manager.hasRecentUpdate(serverId)).toBe(false);
    });
  });
});

describe("ConnectionManager logging level integration", () => {
  let connectionManager: ConnectionManager;

  beforeEach(() => {
    connectionManager = new ConnectionManager(mockTransportFactory);
  });

  describe("updateServerLogLevel", () => {
    it("should update both connection and logging level manager", () => {
      const serverId = "test-server-1";
      const level: LoggingLevel = "debug";

      // Mock a connection
      const mockConnection = {
        id: serverId,
        client: null,
        transport: null,
        capabilities: { logging: {} },
        serverInfo: null,
        instructions: null,
        resources: [],
        tools: [],
        prompts: [],
        logLevel: "info",
        loggingSupported: true,
      };

      // Manually set up the connection for testing
      (connectionManager as any).connections.set(serverId, mockConnection);

      connectionManager.updateServerLogLevel(serverId, level);

      expect(connectionManager.getServerLogLevel(serverId)).toBe(level);
      expect(loggingLevelManager.getExpectedLevel(serverId)).toBe(level);
    });
  });

  describe("correctNotificationLevel", () => {
    it("should correct notification level when needed", () => {
      const serverId = "test-server-1";
      const expectedLevel: LoggingLevel = "debug";
      const originalLevel: LoggingLevel = "info";

      // Set up expected level
      connectionManager.updateServerLogLevel(serverId, expectedLevel);

      const notification = {
        jsonrpc: "2.0" as const,
        method: "notifications/message" as const,
        params: {
          level: originalLevel,
          data: "Test message",
        },
      };

      const correctedNotification = connectionManager.correctNotificationLevel(
        serverId,
        notification,
      );

      expect(correctedNotification.params).toEqual(
        expect.objectContaining({
          level: expectedLevel,
          data: "Test message",
          _meta: expect.objectContaining({
            originalLevel,
            correctedLevel: expectedLevel,
            serverId,
          }),
        }),
      );
    });

    it("should not correct non-logging notifications", () => {
      const serverId = "test-server-1";
      const notification = {
        jsonrpc: "2.0" as const,
        method: "notifications/resources/updated" as const,
        params: {
          uri: "test://resource",
        },
      };

      const result = connectionManager.correctNotificationLevel(
        serverId,
        notification,
      );

      expect(result).toBe(notification); // Should be unchanged
    });

    it("should not correct when levels match", () => {
      const serverId = "test-server-1";
      const level: LoggingLevel = "debug";

      connectionManager.updateServerLogLevel(serverId, level);

      const notification = {
        jsonrpc: "2.0" as const,
        method: "notifications/message" as const,
        params: {
          level,
          data: "Test message",
        },
      };

      const result = connectionManager.correctNotificationLevel(
        serverId,
        notification,
      );

      expect(result).toBe(notification); // Should be unchanged
    });
  });

  describe("getLoggingDebugInfo", () => {
    it("should return debug information", () => {
      const serverId = "test-server-1";
      const level: LoggingLevel = "debug";

      // Mock a connection
      const mockConnection = {
        id: serverId,
        client: null,
        transport: null,
        capabilities: { logging: {} },
        serverInfo: null,
        instructions: null,
        resources: [],
        tools: [],
        prompts: [],
        logLevel: level,
        loggingSupported: true,
      };

      (connectionManager as any).connections.set(serverId, mockConnection);
      connectionManager.updateServerLogLevel(serverId, level);

      const debugInfo = connectionManager.getLoggingDebugInfo();

      expect(debugInfo.connections[serverId]).toEqual({
        logLevel: level,
        loggingSupported: true,
        pendingLogLevel: level,
      });

      expect(debugInfo.loggingLevelManager.serverLevels[serverId]).toBe(level);
    });
  });
});

describe("End-to-end logging level synchronization", () => {
  let connectionManager: ConnectionManager;

  beforeEach(() => {
    connectionManager = new ConnectionManager(mockTransportFactory);
  });

  it("should handle complete logging level change flow", () => {
    const serverId = "test-server-1";
    const originalLevel: LoggingLevel = "info";
    const newLevel: LoggingLevel = "debug";

    // Mock a connection
    const mockConnection = {
      id: serverId,
      client: null,
      transport: null,
      capabilities: { logging: {} },
      serverInfo: null,
      instructions: null,
      resources: [],
      tools: [],
      prompts: [],
      logLevel: originalLevel,
      loggingSupported: true,
    };

    (connectionManager as any).connections.set(serverId, mockConnection);

    // Step 1: User changes logging level
    connectionManager.updateServerLogLevel(serverId, newLevel);

    // Step 2: Notification arrives with old level
    const notification = {
      jsonrpc: "2.0" as const,
      method: "notifications/message" as const,
      params: {
        level: originalLevel,
        data: "Test message from server",
      },
    };

    // Step 3: Notification should be corrected
    const correctedNotification = connectionManager.correctNotificationLevel(
      serverId,
      notification,
    );

    expect(correctedNotification.params).toBeDefined();
    expect((correctedNotification.params as any).level).toBe(newLevel);
    expect((correctedNotification.params as any)._meta).toEqual({
      originalLevel,
      correctedLevel: newLevel,
      serverId,
    });

    // Step 4: Subsequent notifications should also be corrected (until pending level is consumed)
    const secondNotification = {
      jsonrpc: "2.0" as const,
      method: "notifications/message" as const,
      params: {
        level: originalLevel,
        data: "Second test message",
      },
    };

    const secondCorrectedNotification =
      connectionManager.correctNotificationLevel(serverId, secondNotification);
    expect(secondCorrectedNotification.params).toBeDefined();
    expect((secondCorrectedNotification.params as any).level).toBe(newLevel);
  });

  it("should handle multiple servers independently", () => {
    const server1Id = "test-server-1";
    const server2Id = "test-server-2";
    const level1: LoggingLevel = "debug";
    const level2: LoggingLevel = "warning";

    // Set up connections for both servers
    [server1Id, server2Id].forEach((serverId) => {
      const mockConnection = {
        id: serverId,
        client: null,
        transport: null,
        capabilities: { logging: {} },
        serverInfo: null,
        instructions: null,
        resources: [],
        tools: [],
        prompts: [],
        logLevel: "info",
        loggingSupported: true,
      };
      (connectionManager as any).connections.set(serverId, mockConnection);
    });

    // Set different levels for each server
    connectionManager.updateServerLogLevel(server1Id, level1);
    connectionManager.updateServerLogLevel(server2Id, level2);

    // Create notifications from both servers with original level
    const notification1 = {
      jsonrpc: "2.0" as const,
      method: "notifications/message" as const,
      params: { level: "info" as LoggingLevel, data: "Message from server 1" },
    };

    const notification2 = {
      jsonrpc: "2.0" as const,
      method: "notifications/message" as const,
      params: { level: "info" as LoggingLevel, data: "Message from server 2" },
    };

    // Correct both notifications
    const corrected1 = connectionManager.correctNotificationLevel(
      server1Id,
      notification1,
    );
    const corrected2 = connectionManager.correctNotificationLevel(
      server2Id,
      notification2,
    );

    // Each should be corrected to its respective level
    expect(corrected1.params).toBeDefined();
    expect(corrected2.params).toBeDefined();
    expect((corrected1.params as any).level).toBe(level1);
    expect((corrected2.params as any).level).toBe(level2);
  });
});
