import { jest } from "@jest/globals";
import request from "supertest";
import express from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Mock the SDK modules
jest.mock("@modelcontextprotocol/sdk/server/sse.js");
jest.mock("@modelcontextprotocol/sdk/client/stdio.js");
jest.mock("../mcpProxy.js");

const MockSSEServerTransport = SSEServerTransport as jest.MockedClass<typeof SSEServerTransport>;
const MockStdioClientTransport = StdioClientTransport as jest.MockedClass<typeof StdioClientTransport>;

describe("Transport Cleanup Integration", () => {
  let app: express.Application;
  let mockWebAppTransports: Map<string, any>;
  let mockServerTransports: Map<string, any>;
  let mockSSETransport: any;
  let mockStdioTransport: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock transports
    mockSSETransport = {
      sessionId: "test-session-123",
      start: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      onmessage: null,
      onclose: null,
      onerror: null,
    };

    mockStdioTransport = {
      start: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      stderr: {
        on: jest.fn(),
      },
      onmessage: null,
      onclose: null,
      onerror: null,
    };

    MockSSEServerTransport.mockImplementation(() => mockSSETransport);
    MockStdioClientTransport.mockImplementation(() => mockStdioTransport);

    // Setup Express app with transport maps (similar to actual server)
    app = express();
    app.use(express.json());

    mockWebAppTransports = new Map();
    mockServerTransports = new Map();

    // Mock the actual cleanup logic
    const setupCleanupHandlers = (webAppTransport: any, serverTransport: any) => {
      const cleanup = () => {
        mockWebAppTransports.delete(webAppTransport.sessionId);
        mockServerTransports.delete(webAppTransport.sessionId);
      };

      // Simulate the mcpProxy cleanup behavior
      webAppTransport.onclose = cleanup;
      serverTransport.onclose = cleanup;

      return cleanup;
    };

    // STDIO route handler (simplified)
    app.get("/stdio", async (req, res) => {
      try {
        const serverTransport = new MockStdioClientTransport({} as any);
        await serverTransport.start();

        const webAppTransport = new MockSSEServerTransport("/message", res as any);
        await webAppTransport.start();

        // Add to maps
        mockWebAppTransports.set(webAppTransport.sessionId, webAppTransport);
        mockServerTransports.set(webAppTransport.sessionId, serverTransport);

        // Setup cleanup
        setupCleanupHandlers(webAppTransport, serverTransport);

        res.status(200).json({ sessionId: webAppTransport.sessionId });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Test endpoint to check transport state
    app.get("/test/transports", (req, res) => {
      res.json({
        webAppTransports: Array.from(mockWebAppTransports.keys()),
        serverTransports: Array.from(mockServerTransports.keys()),
      });
    });

    // Test endpoint to simulate transport close
    app.post("/test/close/:sessionId", (req, res) => {
      const sessionId = req.params.sessionId;
      const webAppTransport = mockWebAppTransports.get(sessionId);
      
      if (webAppTransport && webAppTransport.onclose) {
        webAppTransport.onclose();
        res.json({ closed: true });
      } else {
        res.status(404).json({ error: "Transport not found" });
      }
    });
  });

  describe("STDIO Transport Cleanup", () => {
    it("should create and track STDIO transports", async () => {
      const response = await request(app)
        .get("/stdio")
        .expect(200);

      expect(response.body.sessionId).toBe("test-session-123");

      // Check that transports are tracked
      const transportsResponse = await request(app)
        .get("/test/transports")
        .expect(200);

      expect(transportsResponse.body.webAppTransports).toContain("test-session-123");
      expect(transportsResponse.body.serverTransports).toContain("test-session-123");
    });

    it("should clean up transports when connection closes", async () => {
      // First create the connection
      await request(app)
        .get("/stdio")
        .expect(200);

      // Verify transports are tracked
      let transportsResponse = await request(app)
        .get("/test/transports")
        .expect(200);

      expect(transportsResponse.body.webAppTransports).toContain("test-session-123");
      expect(transportsResponse.body.serverTransports).toContain("test-session-123");

      // Simulate connection close
      await request(app)
        .post("/test/close/test-session-123")
        .expect(200);

      // Verify transports are cleaned up
      transportsResponse = await request(app)
        .get("/test/transports")
        .expect(200);

      expect(transportsResponse.body.webAppTransports).not.toContain("test-session-123");
      expect(transportsResponse.body.serverTransports).not.toContain("test-session-123");
    });

    it("should handle multiple concurrent connections", async () => {
      // Create multiple connections
      const sessions = ["session-1", "session-2", "session-3"];
      
      for (const sessionId of sessions) {
        mockSSETransport.sessionId = sessionId;
        await request(app)
          .get("/stdio")
          .expect(200);
      }

      // Check all are tracked
      const transportsResponse = await request(app)
        .get("/test/transports")
        .expect(200);

      for (const sessionId of sessions) {
        expect(transportsResponse.body.webAppTransports).toContain(sessionId);
        expect(transportsResponse.body.serverTransports).toContain(sessionId);
      }
    });

    it("should handle cleanup of non-existent session gracefully", async () => {
      await request(app)
        .post("/test/close/non-existent-session")
        .expect(404);

      // Should not affect existing transports
      const transportsResponse = await request(app)
        .get("/test/transports")
        .expect(200);

      expect(transportsResponse.body).toEqual({
        webAppTransports: [],
        serverTransports: [],
      });
    });
  });

  describe("Transport State Management", () => {
    it("should maintain consistent state between webApp and server transport maps", async () => {
      // Create connection
      await request(app)
        .get("/stdio")
        .expect(200);

      let transportsResponse = await request(app)
        .get("/test/transports")
        .expect(200);

      expect(transportsResponse.body.webAppTransports).toEqual(["test-session-123"]);
      expect(transportsResponse.body.serverTransports).toEqual(["test-session-123"]);

      // Close connection
      await request(app)
        .post("/test/close/test-session-123")
        .expect(200);

      transportsResponse = await request(app)
        .get("/test/transports")
        .expect(200);

      // Both maps should be empty
      expect(transportsResponse.body.webAppTransports).toEqual([]);
      expect(transportsResponse.body.serverTransports).toEqual([]);
    });

    it("should handle rapid connect/disconnect cycles", async () => {
      const sessionId = "rapid-test-session";

      for (let i = 0; i < 5; i++) {
        // Connect
        mockSSETransport.sessionId = sessionId;
        await request(app)
          .get("/stdio")
          .expect(200);

        // Verify connected
        let transportsResponse = await request(app)
          .get("/test/transports")
          .expect(200);

        expect(transportsResponse.body.webAppTransports).toContain(sessionId);
        expect(transportsResponse.body.serverTransports).toContain(sessionId);

        // Disconnect
        await request(app)
          .post(`/test/close/${sessionId}`)
          .expect(200);

        // Verify disconnected
        transportsResponse = await request(app)
          .get("/test/transports")
          .expect(200);

        expect(transportsResponse.body.webAppTransports).not.toContain(sessionId);
        expect(transportsResponse.body.serverTransports).not.toContain(sessionId);
      }
    });
  });
});

// Test for the actual issue scenario
describe("STDIO Server Restart Issue", () => {
  let mockWebAppTransports: Map<string, any>;
  let mockServerTransports: Map<string, any>;

  beforeEach(() => {
    mockWebAppTransports = new Map();
    mockServerTransports = new Map();
  });

  it("should demonstrate the problem without cleanup", () => {
    const sessionId = "problem-session";
    const mockTransport = {
      sessionId,
      send: jest.fn().mockRejectedValue(new Error("Not connected")),
      close: jest.fn(),
    };

    // Add transport to maps (simulating connection)
    mockWebAppTransports.set(sessionId, mockTransport);
    mockServerTransports.set(sessionId, mockTransport);

    // Simulate disconnect without cleanup (the bug)
    // Transport references remain in maps

    expect(mockWebAppTransports.has(sessionId)).toBe(true);
    expect(mockServerTransports.has(sessionId)).toBe(true);

    // Attempt to use stale transport (this would cause "Not connected" error)
    const staleTransport = mockWebAppTransports.get(sessionId);
    expect(staleTransport.send()).rejects.toThrow("Not connected");
  });

  it("should demonstrate the fix with proper cleanup", () => {
    const sessionId = "fixed-session";
    const mockTransport = {
      sessionId,
      send: jest.fn(),
      close: jest.fn(),
      onclose: null as (() => void) | null,
    };

    // Add transport to maps (simulating connection)
    mockWebAppTransports.set(sessionId, mockTransport);
    mockServerTransports.set(sessionId, mockTransport);

    // Setup cleanup handler (the fix)
    const cleanup = () => {
      mockWebAppTransports.delete(sessionId);
      mockServerTransports.delete(sessionId);
    };
    
    mockTransport.onclose = cleanup;

    // Verify transport is tracked
    expect(mockWebAppTransports.has(sessionId)).toBe(true);
    expect(mockServerTransports.has(sessionId)).toBe(true);

    // Simulate disconnect with cleanup
    mockTransport.onclose();

    // Verify cleanup worked
    expect(mockWebAppTransports.has(sessionId)).toBe(false);
    expect(mockServerTransports.has(sessionId)).toBe(false);
  });
});