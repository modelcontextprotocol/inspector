/**
 * E2E tests for remote transport (stdio, SSE, streamable-http).
 * Verifies connection, tools, fetch tracking, stderr logging, and remote logging over the remote.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
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
  storageDir?: string;
}

async function startRemoteServer(
  port: number,
  options: StartRemoteServerOptions = {},
): Promise<{
  baseUrl: string;
  server: ServerType;
  authToken: string;
}> {
  const { app, authToken } = createRemoteApp({
    logger: options.logger,
    storageDir: options.storageDir,
  });
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
          server,
          authToken,
        });
      },
    );
    server.on("error", reject);
  });
}

describe("Remote transport e2e", () => {
  let remoteServer: ServerType | null;
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
    const { baseUrl, server, authToken } = await startRemoteServer(0);
    remoteServer = server;

    const createTransport = createRemoteTransport({ baseUrl, authToken });
    const client = new InspectorClient(config, {
      environment: {
        transport: createTransport,
      },
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

    const { baseUrl, server, authToken } = await startRemoteServer(0);
    remoteServer = server;

    const res = await fetch(`${baseUrl}/api/mcp/connect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mcp-remote-auth": `Bearer ${authToken}`,
      },
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

  describe("authentication", () => {
    it("rejects requests without auth token", async () => {
      const { baseUrl, server } = await startRemoteServer(0);
      remoteServer = server;

      const res = await fetch(`${baseUrl}/api/mcp/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { type: "sse" as const, url: "http://localhost:3000" },
        }),
      });

      expect(res.status).toBe(401);
      const json = (await res.json()) as { error?: string; message?: string };
      expect(json.error).toBe("Unauthorized");
      expect(json.message).toContain("x-mcp-remote-auth");
    });

    it("rejects requests with incorrect auth token", async () => {
      const { baseUrl, server, authToken } = await startRemoteServer(0);
      remoteServer = server;

      const res = await fetch(`${baseUrl}/api/mcp/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mcp-remote-auth": `Bearer wrong-token-${authToken}`,
        },
        body: JSON.stringify({
          config: { type: "sse" as const, url: "http://localhost:3000" },
        }),
      });

      expect(res.status).toBe(401);
      const json = (await res.json()) as { error?: string; message?: string };
      expect(json.error).toBe("Unauthorized");
    });

    it("rejects requests without Bearer prefix", async () => {
      const { baseUrl, server, authToken } = await startRemoteServer(0);
      remoteServer = server;

      const res = await fetch(`${baseUrl}/api/mcp/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mcp-remote-auth": authToken, // Missing "Bearer " prefix
        },
        body: JSON.stringify({
          config: { type: "sse" as const, url: "http://localhost:3000" },
        }),
      });

      expect(res.status).toBe(401);
      const json = (await res.json()) as { error?: string; message?: string };
      expect(json.error).toBe("Unauthorized");
    });

    it("rejects requests to /api/fetch without auth token", async () => {
      const { baseUrl, server } = await startRemoteServer(0);
      remoteServer = server;

      const res = await fetch(`${baseUrl}/api/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "http://example.com" }),
      });

      expect(res.status).toBe(401);
      const json = (await res.json()) as { error?: string; message?: string };
      expect(json.error).toBe("Unauthorized");
    });

    it("rejects requests to /api/log without auth token", async () => {
      const { baseUrl, server } = await startRemoteServer(0);
      remoteServer = server;

      const res = await fetch(`${baseUrl}/api/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: { label: "info" }, messages: ["test"] }),
      });

      expect(res.status).toBe(401);
      const json = (await res.json()) as { error?: string; message?: string };
      expect(json.error).toBe("Unauthorized");
    });

    it("rejects requests to /api/mcp/send without auth token", async () => {
      const { baseUrl, server } = await startRemoteServer(0);
      remoteServer = server;

      const res = await fetch(`${baseUrl}/api/mcp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session",
          message: { jsonrpc: "2.0", method: "test", id: 1 },
        }),
      });

      expect(res.status).toBe(401);
      const json = (await res.json()) as { error?: string; message?: string };
      expect(json.error).toBe("Unauthorized");
    });

    it("rejects requests to /api/mcp/events without auth token", async () => {
      const { baseUrl, server } = await startRemoteServer(0);
      remoteServer = server;

      const res = await fetch(`${baseUrl}/api/mcp/events?sessionId=test`, {
        method: "GET",
      });

      expect(res.status).toBe(401);
      const json = (await res.json()) as { error?: string; message?: string };
      expect(json.error).toBe("Unauthorized");
    });

    it("rejects requests to /api/mcp/disconnect without auth token", async () => {
      const { baseUrl, server } = await startRemoteServer(0);
      remoteServer = server;

      const res = await fetch(`${baseUrl}/api/mcp/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "test-session" }),
      });

      expect(res.status).toBe(401);
      const json = (await res.json()) as { error?: string; message?: string };
      expect(json.error).toBe("Unauthorized");
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

      const { baseUrl, server, authToken } = await startRemoteServer(0, {
        logger: fileLogger,
      });
      remoteServer = server;

      const createTransport = createRemoteTransport({
        baseUrl,
        authToken,
      });
      const remoteLogger = createRemoteLogger({
        baseUrl,
        authToken,
        fetchFn: fetch,
      });
      const client = new InspectorClient(
        { type: "sse", url: mcpHttpServer!.url },
        {
          environment: {
            transport: createTransport,
            logger: remoteLogger,
          },
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

  describe("storage", () => {
    let tempDir: string | null = null;

    beforeEach(() => {
      tempDir = null;
    });

    afterEach(async () => {
      if (tempDir) {
        try {
          rmSync(tempDir, { recursive: true });
        } catch {
          // Ignore cleanup errors
        }
        tempDir = null;
      }
    });

    it("returns empty object for non-existent store", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const { baseUrl, server, authToken } = await startRemoteServer(0, {
        storageDir: tempDir,
      });
      remoteServer = server;

      const res = await fetch(`${baseUrl}/api/storage/test-store`, {
        method: "GET",
        headers: {
          "x-mcp-remote-auth": `Bearer ${authToken}`,
        },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({});
    });

    it("reads and writes store data", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const { baseUrl, server, authToken } = await startRemoteServer(0, {
        storageDir: tempDir,
      });
      remoteServer = server;

      const testData = { key1: "value1", key2: { nested: "value" } };

      // Write store
      const writeRes = await fetch(`${baseUrl}/api/storage/test-store`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mcp-remote-auth": `Bearer ${authToken}`,
        },
        body: JSON.stringify(testData),
      });

      expect(writeRes.status).toBe(200);
      const writeJson = await writeRes.json();
      expect(writeJson).toEqual({ ok: true });

      // Read store
      const readRes = await fetch(`${baseUrl}/api/storage/test-store`, {
        method: "GET",
        headers: {
          "x-mcp-remote-auth": `Bearer ${authToken}`,
        },
      });

      expect(readRes.status).toBe(200);
      const readJson = await readRes.json();
      expect(readJson).toEqual(testData);
    });

    it("overwrites store on POST", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const { baseUrl, server, authToken } = await startRemoteServer(0, {
        storageDir: tempDir,
      });
      remoteServer = server;

      const initialData = { key1: "value1" };
      const updatedData = { key2: "value2" };

      // Write initial data
      await fetch(`${baseUrl}/api/storage/test-store`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mcp-remote-auth": `Bearer ${authToken}`,
        },
        body: JSON.stringify(initialData),
      });

      // Overwrite with new data
      await fetch(`${baseUrl}/api/storage/test-store`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mcp-remote-auth": `Bearer ${authToken}`,
        },
        body: JSON.stringify(updatedData),
      });

      // Read and verify overwrite
      const readRes = await fetch(`${baseUrl}/api/storage/test-store`, {
        method: "GET",
        headers: {
          "x-mcp-remote-auth": `Bearer ${authToken}`,
        },
      });

      expect(readRes.status).toBe(200);
      const readJson = await readRes.json();
      expect(readJson).toEqual(updatedData);
      expect(readJson).not.toEqual(initialData);
    });

    it("rejects invalid storeId", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const { baseUrl, server, authToken } = await startRemoteServer(0, {
        storageDir: tempDir,
      });
      remoteServer = server;

      // Test invalid characters (not alphanumeric, hyphen, underscore)
      const res = await fetch(`${baseUrl}/api/storage/invalid.store.id`, {
        method: "GET",
        headers: {
          "x-mcp-remote-auth": `Bearer ${authToken}`,
        },
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Invalid storeId");
    });

    it("rejects requests without auth token", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const { baseUrl, server } = await startRemoteServer(0, {
        storageDir: tempDir,
      });
      remoteServer = server;

      const res = await fetch(`${baseUrl}/api/storage/test-store`, {
        method: "GET",
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("deletes store with DELETE endpoint", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const { baseUrl, server, authToken } = await startRemoteServer(0, {
        storageDir: tempDir,
      });
      remoteServer = server;

      const testData = { key1: "value1" };

      // Write store
      await fetch(`${baseUrl}/api/storage/test-store`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mcp-remote-auth": `Bearer ${authToken}`,
        },
        body: JSON.stringify(testData),
      });

      // Verify it exists
      const readRes = await fetch(`${baseUrl}/api/storage/test-store`, {
        method: "GET",
        headers: {
          "x-mcp-remote-auth": `Bearer ${authToken}`,
        },
      });
      expect(readRes.status).toBe(200);
      const readJson = await readRes.json();
      expect(readJson).toEqual(testData);

      // Delete store
      const deleteRes = await fetch(`${baseUrl}/api/storage/test-store`, {
        method: "DELETE",
        headers: {
          "x-mcp-remote-auth": `Bearer ${authToken}`,
        },
      });
      expect(deleteRes.status).toBe(200);
      const deleteJson = await deleteRes.json();
      expect(deleteJson).toEqual({ ok: true });

      // Verify it's gone (returns empty object)
      const readAfterDelete = await fetch(`${baseUrl}/api/storage/test-store`, {
        method: "GET",
        headers: {
          "x-mcp-remote-auth": `Bearer ${authToken}`,
        },
      });
      expect(readAfterDelete.status).toBe(200);
      const readAfterDeleteJson = await readAfterDelete.json();
      expect(readAfterDeleteJson).toEqual({});
    });

    it("DELETE returns success for non-existent store", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-storage-test-"));
      const { baseUrl, server, authToken } = await startRemoteServer(0, {
        storageDir: tempDir,
      });
      remoteServer = server;

      const deleteRes = await fetch(`${baseUrl}/api/storage/non-existent`, {
        method: "DELETE",
        headers: {
          "x-mcp-remote-auth": `Bearer ${authToken}`,
        },
      });
      expect(deleteRes.status).toBe(200);
      const deleteJson = await deleteRes.json();
      expect(deleteJson).toEqual({ ok: true });
    });
  });
});
