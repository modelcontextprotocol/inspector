/**
 * E2E tests for remote transport (stdio, SSE, streamable-http).
 * Verifies connection, tools, fetch tracking, stderr logging, and remote logging over the remote.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import pino from "pino";
import { InspectorClient } from "../mcp/inspectorClient.js";
import { createRemoteTransport } from "../mcp/remote/createRemoteTransport.js";
import { createRemoteLogger } from "../mcp/remote/createRemoteLogger.js";
import { createRemoteApp } from "../mcp/remote/node/server.js";
import { createTestServerHttp } from "../test/test-server-http.js";
import { getTestMcpServerCommand } from "../test/test-server-stdio.js";
import {
  createEchoTool,
  createTestServerInfo,
} from "../test/test-server-fixtures.js";
import type { MCPServerConfig } from "../mcp/types.js";

interface StartRemoteServerOptions {
  logger?: pino.Logger;
}

async function startRemoteServer(
  port: number,
  options: StartRemoteServerOptions = {},
): Promise<{
  baseUrl: string;
  server: Server;
}> {
  const app = createRemoteApp({ logger: options.logger });
  return new Promise((resolve, reject) => {
    const server = serve(
      { fetch: app.fetch, port, hostname: "127.0.0.1" },
      (info) => {
        const actualPort =
          info && typeof info === "object" && "port" in info
            ? (info as { port: number }).port
            : port;
        resolve({
          baseUrl: `http://127.0.0.1:${actualPort}`,
          server: server as unknown as Server,
        });
      },
    ) as unknown as Server;
    server.on("error", reject);
  });
}

describe("Remote transport e2e", () => {
  let remoteServer: Server | null;
  let mcpHttpServer: Awaited<ReturnType<typeof createTestServerHttp>> | null;

  beforeEach(() => {
    remoteServer = null;
    mcpHttpServer = null;
  });

  afterEach(async () => {
    if (remoteServer) {
      await new Promise<void>((resolve, reject) => {
        remoteServer!.close((err) => (err ? reject(err) : resolve()));
      });
      remoteServer = null;
    }
    if (mcpHttpServer) {
      try {
        await mcpHttpServer.stop();
      } catch {
        // Ignore stop errors
      }
      mcpHttpServer = null;
    }
  });

  async function setupRemoteAndConnect(
    config: MCPServerConfig,
  ): Promise<InspectorClient> {
    const { baseUrl, server } = await startRemoteServer(0);
    remoteServer = server;

    const createTransport = createRemoteTransport({ baseUrl });
    const client = new InspectorClient(config, {
      transportClientFactory: createTransport,
      autoFetchServerContents: false,
      maxMessages: 100,
      maxFetchRequests: 100,
      maxStderrLogEvents: 100,
      pipeStderr: true,
    });

    await client.connect();

    return client;
  }

  it("smoke: remote server accepts connect and returns sessionId for SSE", async () => {
    mcpHttpServer = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: [createEchoTool()],
      serverType: "sse",
    });
    await mcpHttpServer.start();

    const { baseUrl, server } = await startRemoteServer(0);
    remoteServer = server;

    const res = await fetch(`${baseUrl}/api/mcp/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: { type: "sse" as const, url: mcpHttpServer!.url },
      }),
    });

    const json = (await res.json()) as { sessionId?: string; error?: string };
    if (!res.ok) {
      throw new Error(
        `Connect failed: ${res.status} ${json.error ?? (await res.text())}`,
      );
    }
    expect(json.sessionId).toBeDefined();
    expect(typeof json.sessionId).toBe("string");
  });

  describe("stdio", () => {
    it("connects, lists tools, and forwards stderr over remote", async () => {
      const serverCommand = getTestMcpServerCommand();
      const config: MCPServerConfig = {
        type: "stdio",
        command: serverCommand.command,
        args: serverCommand.args,
      };

      const client = await setupRemoteAndConnect(config);

      try {
        expect(client.getStatus()).toBe("connected");

        const tools = await client.listTools();
        expect(tools.tools.length).toBeGreaterThan(0);
        expect(tools.tools.some((t) => t.name === "echo")).toBe(true);

        // Stdio server may emit stderr (e.g. from MCP logging). We verify the
        // mechanism works; some servers may not produce stderr.
        const stderrLogs = client.getStderrLogs();
        expect(Array.isArray(stderrLogs)).toBe(true);
      } finally {
        await client.disconnect();
      }
    });

    it("validates stderr content over remote stdio", async () => {
      const serverCommand = getTestMcpServerCommand();
      const config: MCPServerConfig = {
        type: "stdio",
        command: serverCommand.command,
        args: serverCommand.args,
      };

      const client = await setupRemoteAndConnect(config);

      try {
        const testMessage = `stderr-remote-${Date.now()}`;
        await client.callTool("writeToStderr", { message: testMessage });

        const stderrLogs = client.getStderrLogs();
        expect(Array.isArray(stderrLogs)).toBe(true);
        const matching = stderrLogs.filter((l) =>
          l.message.includes(testMessage),
        );
        expect(matching.length).toBeGreaterThan(0);
        expect(matching[0]!.message).toContain(testMessage);
      } finally {
        await client.disconnect();
      }
    });

    it("calls a tool over remote stdio", async () => {
      const serverCommand = getTestMcpServerCommand();
      const config: MCPServerConfig = {
        type: "stdio",
        command: serverCommand.command,
        args: serverCommand.args,
      };

      const client = await setupRemoteAndConnect(config);

      try {
        const invocation = await client.callTool("echo", {
          message: "hello-remote",
        });
        expect(invocation.result?.content).toBeDefined();
        const textContent = invocation.result?.content?.find(
          (c: { type: string }) => c.type === "text",
        );
        expect(textContent).toBeDefined();
        expect((textContent as { type: "text"; text: string }).text).toContain(
          "Echo: hello-remote",
        );
      } finally {
        await client.disconnect();
      }
    });
  });

  describe("SSE", () => {
    it("connects, lists tools, and receives fetch_request events over remote", async () => {
      mcpHttpServer = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
        serverType: "sse",
      });
      await mcpHttpServer.start();

      const config: MCPServerConfig = {
        type: "sse",
        url: mcpHttpServer.url,
      };

      const client = await setupRemoteAndConnect(config);

      try {
        expect(client.getStatus()).toBe("connected");

        await client.listTools();

        // Fetch tracking: remote server applies createFetchTracker when creating
        // the transport; it emits fetch_request events over SSE to the client.
        const fetchRequests = client.getFetchRequests();
        expect(fetchRequests.length).toBeGreaterThan(0);
        const getRequest = fetchRequests.find((r) => r.method === "GET");
        expect(getRequest).toBeDefined();
        if (getRequest) {
          expect(getRequest.url).toContain("/sse");
          expect(getRequest.requestHeaders).toBeDefined();
          expect(getRequest.responseStatus).toBeDefined();
        }
      } finally {
        await client.disconnect();
      }
    });

    it("calls a tool over remote SSE", async () => {
      mcpHttpServer = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
        serverType: "sse",
      });
      await mcpHttpServer.start();

      const config: MCPServerConfig = {
        type: "sse",
        url: mcpHttpServer.url,
      };

      const client = await setupRemoteAndConnect(config);

      try {
        const invocation = await client.callTool("echo", {
          message: "sse-test",
        });
        expect(invocation.result?.content).toBeDefined();
        const textContent = invocation.result?.content?.find(
          (c: { type: string }) => c.type === "text",
        );
        expect((textContent as { type: "text"; text: string }).text).toContain(
          "Echo: sse-test",
        );
      } finally {
        await client.disconnect();
      }
    });
  });

  describe("streamable-http", () => {
    it("connects, lists tools, and receives fetch_request events over remote", async () => {
      mcpHttpServer = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
        serverType: "streamable-http",
      });
      await mcpHttpServer.start();

      const config: MCPServerConfig = {
        type: "streamable-http",
        url: mcpHttpServer.url,
      };

      const client = await setupRemoteAndConnect(config);

      try {
        expect(client.getStatus()).toBe("connected");

        await client.listTools();

        const fetchRequests = client.getFetchRequests();
        expect(fetchRequests.length).toBeGreaterThan(0);
        const postRequest = fetchRequests.find((r) => r.method === "POST");
        expect(postRequest).toBeDefined();
        if (postRequest) {
          expect(postRequest.url).toContain("/mcp");
          expect(postRequest.requestHeaders).toBeDefined();
          expect(postRequest.responseStatus).toBeDefined();
          expect(postRequest.responseHeaders).toBeDefined();
          expect(postRequest.duration).toBeDefined();
        }
      } finally {
        await client.disconnect();
      }
    });

    it("calls a tool over remote streamable-http", async () => {
      mcpHttpServer = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
        serverType: "streamable-http",
      });
      await mcpHttpServer.start();

      const config: MCPServerConfig = {
        type: "streamable-http",
        url: mcpHttpServer.url,
      };

      const client = await setupRemoteAndConnect(config);

      try {
        const invocation = await client.callTool("echo", {
          message: "streamable-http-test",
        });
        expect(invocation.result?.content).toBeDefined();
        const textContent = invocation.result?.content?.find(
          (c: { type: string }) => c.type === "text",
        );
        expect((textContent as { type: "text"; text: string }).text).toContain(
          "Echo: streamable-http-test",
        );
      } finally {
        await client.disconnect();
      }
    });
  });

  describe("remote logging", () => {
    let tempDir: string | null = null;

    afterEach(() => {
      if (tempDir) {
        try {
          rmSync(tempDir, { recursive: true });
        } catch {
          // Ignore cleanup errors
        }
        tempDir = null;
      }
    });

    it("writes InspectorClient logs to file via createRemoteLogger over remote transport", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-log-test-"));
      const logPath = join(tempDir!, "remote.log");
      const fileLogger = pino(
        { level: "info" },
        pino.destination({ dest: logPath, append: true, mkdir: true }),
      );

      mcpHttpServer = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
        serverType: "sse",
      });
      await mcpHttpServer.start();

      const { baseUrl, server } = await startRemoteServer(0, {
        logger: fileLogger,
      });
      remoteServer = server;

      const createTransport = createRemoteTransport({ baseUrl });
      const remoteLogger = createRemoteLogger({ baseUrl, fetchFn: fetch });
      const client = new InspectorClient(
        { type: "sse", url: mcpHttpServer!.url },
        {
          transportClientFactory: createTransport,
          logger: remoteLogger,
          autoFetchServerContents: false,
          maxMessages: 100,
          maxFetchRequests: 100,
          maxStderrLogEvents: 100,
          pipeStderr: true,
        },
      );

      await client.connect();
      await client.listTools();

      // Wait for async log POSTs to complete and file logger to flush
      await new Promise<void>((resolve) => {
        fileLogger.flush(() => resolve());
      });
      await new Promise((r) => setTimeout(r, 300));

      const logContent = readFileSync(logPath, "utf-8");
      expect(logContent).toContain("transport fetch");
      expect(logContent).toContain("InspectorClient");
      expect(logContent).toContain("component");
      expect(logContent).toContain("category");

      await client.disconnect();
    });
  });
});
