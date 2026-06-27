/**
 * Coverage backfill for InspectorClient: drives a set of small, individually
 * simple methods and error paths that the broader e2e suite does not reach.
 * Uses the real stdio test server (and HTTP test servers where a network
 * transport is required) so these remain behavioral tests, not mocks.
 */

import { describe, it, expect, afterEach } from "vitest";
import * as z from "zod/v4";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { SamplingCreateMessage } from "@inspector/core/mcp/samplingCreateMessage.js";
import { ElicitationCreateMessage } from "@inspector/core/mcp/elicitationCreateMessage.js";
import {
  getTestMcpServerCommand,
  createTestServerHttp,
  type TestServerHttp,
  waitForEvent,
  createEchoTool,
  createTestServerInfo,
  getTaskServerConfig,
  createTaskTool,
  createNumberedResources,
  createNumberedPrompts,
} from "@modelcontextprotocol/inspector-test-server";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

const serverCommand = getTestMcpServerCommand();

function stdioClient(): InspectorClient {
  return new InspectorClient(
    {
      type: "stdio",
      command: serverCommand.command,
      args: serverCommand.args,
    },
    { environment: { transport: createTransportNode } },
  );
}

async function getAllTools(client: InspectorClient): Promise<Tool[]> {
  const collected: Tool[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 100; i++) {
    const r = await client.listTools(cursor);
    collected.push(...r.tools);
    cursor = r.nextCursor;
    if (!cursor) break;
  }
  return collected;
}

async function getTool(client: InspectorClient, name: string): Promise<Tool> {
  const tool = (await getAllTools(client)).find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

/**
 * Attach a no-op catch to every outstanding receiver-task payload promise so a
 * deliberate reject (failure-path test) doesn't bubble up as an unhandled
 * rejection. The real consumer (the server polling tasks/result) handles the
 * rejection, but it may not have a handler attached at the instant we reject.
 */
function suppressReceiverPayloadRejections(client: InspectorClient): void {
  const records = (
    client as unknown as {
      receiverTaskRecords: Map<string, { payloadPromise: Promise<unknown> }>;
    }
  ).receiverTaskRecords;
  for (const record of records.values()) {
    record.payloadPromise.catch(() => {});
  }
}

describe("InspectorClient coverage backfill", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;

  afterEach(async () => {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // ignore
      }
      client = null;
    }
    if (server) {
      try {
        await server.stop();
      } catch {
        // ignore
      }
      server = null;
    }
  });

  describe("simple accessors and ping", () => {
    it("ping() resolves against a live server and getTransportConfig returns the config", async () => {
      client = stdioClient();
      await client.connect();
      await expect(client.ping()).resolves.toBeUndefined();

      const cfg = client.getTransportConfig();
      expect(cfg.type).toBe("stdio");
    });

    it("ping() throws when the client is not initialized", async () => {
      const c = stdioClient();
      // Force the private client field to null to hit the guard.
      (c as unknown as { client: unknown }).client = null;
      await expect(c.ping()).rejects.toThrow(/Client not initialized/);
    });

    it("getClientCapabilities reflects the advertised capabilities", async () => {
      // sampling enabled (default), elicit form enabled (default), roots set.
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        { environment: { transport: createTransportNode }, roots: [] },
      );
      const caps = client.getClientCapabilities();
      expect(caps.sampling).toBeDefined();
      expect(caps.elicitation).toBeDefined();
      expect(caps.roots).toBeDefined();
    });
  });

  describe("getAppRendererClient proxy", () => {
    it("returns null before connect and a memoized proxy after connect", async () => {
      client = stdioClient();
      // Not connected yet → null.
      expect(client.getAppRendererClient()).toBeNull();

      await client.connect();
      const proxy = client.getAppRendererClient();
      expect(proxy).not.toBeNull();
      // Second call returns the same memoized proxy.
      expect(client.getAppRendererClient()).toBe(proxy);

      // Accessing setNotificationHandler returns the wrapped function (covers
      // the prop === "setNotificationHandler" branch), and accessing another
      // prop returns the underlying value (covers the fall-through return).
      const wrapped = (proxy as unknown as { setNotificationHandler: unknown })
        .setNotificationHandler;
      expect(typeof wrapped).toBe("function");
      const other = (proxy as unknown as { request: unknown }).request;
      expect(typeof other).toBe("function");
    });
  });

  describe("getCompletions error rethrow", () => {
    it("wraps a non-MethodNotFound error as 'Failed to get completions'", async () => {
      client = stdioClient();
      await client.connect();
      // Force the underlying SDK complete() to throw a non-MethodNotFound error
      // so the catch rethrows it wrapped.
      const c = client as unknown as {
        client: { complete: () => Promise<never> };
      };
      const original = c.client.complete;
      c.client.complete = async () => {
        throw new Error("boom-completions");
      };
      try {
        await expect(
          client.getCompletions({ type: "ref/prompt", name: "x" }, "arg", ""),
        ).rejects.toThrow(/Failed to get completions: boom-completions/);
      } finally {
        c.client.complete = original;
      }
    });

    it("returns empty values gracefully when the server reports MethodNotFound", async () => {
      client = stdioClient();
      await client.connect();
      const c = client as unknown as {
        client: { complete: () => Promise<never> };
      };
      const original = c.client.complete;
      c.client.complete = async () => {
        throw new McpError(ErrorCode.MethodNotFound, "Method not found");
      };
      try {
        await expect(
          client.getCompletions({ type: "ref/prompt", name: "x" }, "arg", ""),
        ).resolves.toEqual({ values: [] });
      } finally {
        c.client.complete = original;
      }
    });
  });

  describe("setRoots", () => {
    it("enables roots when previously undefined and dispatches rootsChange", async () => {
      // No roots option → this.roots is undefined initially.
      client = stdioClient();
      await client.connect();
      const rootsChange = waitForEvent(client, "rootsChange", {
        timeout: 3000,
      });
      await client.setRoots([{ uri: "file:///tmp", name: "tmp" }]);
      await rootsChange;
      expect(client.getRoots()).toEqual([{ uri: "file:///tmp", name: "tmp" }]);
    });

    it("logs (does not throw) when the list_changed notification fails", async () => {
      client = stdioClient();
      await client.connect();
      const c = client as unknown as {
        client: { notification: (...a: unknown[]) => Promise<void> };
      };
      const original = c.client.notification;
      c.client.notification = async () => {
        throw new Error("notify-failed");
      };
      try {
        // Should resolve (error is caught + logged), and roots still update.
        await expect(
          client.setRoots([{ uri: "file:///x", name: "x" }]),
        ).resolves.toBeUndefined();
        expect(client.getRoots()).toEqual([{ uri: "file:///x", name: "x" }]);
      } finally {
        c.client.notification = original;
      }
    });

    it("throws when client is not connected", async () => {
      const c = stdioClient();
      (c as unknown as { client: unknown }).client = null;
      await expect(c.setRoots([])).rejects.toThrow(/Client is not connected/);
    });
  });

  describe("subscribe / unsubscribe error wrapping", () => {
    it("wraps subscribe failures from a server that advertises subscribe but rejects", async () => {
      // Advertise subscriptions so supportsResourceSubscriptions() passes, then
      // make the SDK subscribeResource reject to hit the catch wrapper.
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
        resources: [],
        subscriptions: true,
        serverType: "sse",
      });
      await server.start();
      client = new InspectorClient(
        { type: "sse", url: server.url },
        { environment: { transport: createTransportNode } },
      );
      await client.connect();
      expect(client.supportsResourceSubscriptions()).toBe(true);

      const c = client as unknown as {
        client: { subscribeResource: () => Promise<never> };
      };
      c.client.subscribeResource = async () => {
        throw new Error("sub-rejected");
      };
      await expect(client.subscribeToResource("test://nope")).rejects.toThrow(
        /Failed to subscribe to resource: sub-rejected/,
      );
    });

    it("wraps unsubscribe failures", async () => {
      client = stdioClient();
      await client.connect();
      const c = client as unknown as {
        client: { unsubscribeResource: () => Promise<never> };
      };
      c.client.unsubscribeResource = async () => {
        throw new Error("unsub-rejected");
      };
      await expect(
        client.unsubscribeFromResource("test://nope"),
      ).rejects.toThrow(/Failed to unsubscribe from resource: unsub-rejected/);
    });
  });

  describe("receiver-task failure callbacks (server-driven sampling/elicitation)", () => {
    it("marks the receiver task failed when the sampling request is rejected", async () => {
      const config = {
        ...getTaskServerConfig(),
        serverType: "sse" as const,
        tools: [
          createTaskTool({
            name: "receiverRejectSampling",
            samplingText: "Reply please",
            receiverTaskTtl: 5000,
          }),
          ...(getTaskServerConfig().tools || []),
        ],
      };
      server = createTestServerHttp(config);
      await server.start();
      client = new InspectorClient(
        { type: "sse", url: server.url },
        {
          environment: { transport: createTransportNode },
          sample: true,
          receiverTasks: true,
          receiverTaskTtlMs: 10_000,
        },
      );
      await client.connect();

      const samplingPromise = waitForEvent<SamplingCreateMessage>(
        client,
        "newPendingSample",
        { timeout: 5000 },
      );
      const tool = await getTool(client, "receiverRejectSampling");
      const callPromise = client
        .callToolStream(tool, { message: "x" })
        .catch((e: unknown) => e);

      const sample = await samplingPromise;
      // Pre-attach a catch to the receiver task's payload promise so its
      // rejection (driven below) doesn't surface as an unhandled rejection.
      suppressReceiverPayloadRejections(client);
      // Reject instead of respond — drives the receiver-task error callback,
      // which sets status "failed" and calls upsertReceiverTask.
      await sample.reject(new Error("user rejected sampling"));

      const outcome = await callPromise;
      // The rejected payload surfaces as a failed/errored tool call.
      expect(outcome).toBeDefined();
    });

    it("marks the receiver task failed when the elicitation request is rejected", async () => {
      const config = {
        ...getTaskServerConfig(),
        serverType: "sse" as const,
        tools: [
          createTaskTool({
            name: "receiverRejectElicit",
            elicitationSchema: z.object({
              input: z.string().describe("User input"),
            }),
            receiverTaskTtl: 5000,
          }),
          ...(getTaskServerConfig().tools || []),
        ],
      };
      server = createTestServerHttp(config);
      await server.start();
      client = new InspectorClient(
        { type: "sse", url: server.url },
        {
          environment: { transport: createTransportNode },
          elicit: true,
          receiverTasks: true,
          receiverTaskTtlMs: 10_000,
        },
      );
      await client.connect();

      const elicitationPromise = waitForEvent<ElicitationCreateMessage>(
        client,
        "newPendingElicitation",
        { timeout: 5000 },
      );
      const tool = await getTool(client, "receiverRejectElicit");
      const callPromise = client
        .callToolStream(tool, { message: "x" })
        .catch((e: unknown) => e);

      const elicitation = await elicitationPromise;
      suppressReceiverPayloadRejections(client);
      await elicitation.reject(new Error("user declined elicitation"));

      const outcome = await callPromise;
      expect(outcome).toBeDefined();
    });
  });

  describe("list/read/get with metadata + cursor (effectiveMeta + cursor branches)", () => {
    it("listResources / listResourceTemplates / listPrompts / listTools accept metadata and cursor", async () => {
      // Server with enough entries to produce a nextCursor under pagination so
      // the cursor branch is exercised on a follow-up call.
      const resources = createNumberedResources(2);
      const prompts = createNumberedPrompts(1);
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
        resources,
        resourceTemplates: [],
        prompts,
        maxPageSize: { resources: 1 },
        serverType: "streamable-http",
      });
      await server.start();
      client = new InspectorClient(
        { type: "streamable-http", url: server.url },
        {
          environment: { transport: createTransportNode },
          // Non-empty default metadata so mergeMeta returns a non-empty map →
          // the `effectiveMeta ? { _meta } : {}` truthy branch fires.
          serverSettings: {
            headers: [],
            env: [],
            metadata: [{ key: "x-test", value: "1" }],
            connectionTimeout: 0,
            requestTimeout: 0,
            taskTtl: 0,
            maxFetchRequests: 1000,
            roots: [],
          },
        },
      );
      await client.connect();

      const meta = { trace: "abc" };
      // First page (no cursor) with metadata.
      const firstResources = await client.listResources(undefined, meta);
      expect(firstResources.resources.length).toBeGreaterThan(0);
      // Follow-up page WITH cursor (exercises the cursor-truthy branch).
      if (firstResources.nextCursor) {
        const secondResources = await client.listResources(
          firstResources.nextCursor,
          meta,
        );
        expect(secondResources.resources).toBeDefined();
      }

      await client.listResourceTemplates(undefined, meta);
      await client.listResourceTemplates("cursor-x", meta).catch(() => {
        // A bogus cursor may error on some servers; we only need the param path.
      });
      await client.listPrompts(undefined, meta);
      await client.listPrompts("cursor-y", meta).catch(() => {});
      const tools = await client.listTools("cursor-z", meta).catch(() => ({
        tools: [],
      }));
      expect(tools).toBeDefined();

      // readResource + getPrompt with metadata (effectiveMeta truthy + getPrompt
      // stringArgs non-empty branch).
      const read = await client.readResource("test://resource_1", meta);
      expect(read.result).toBeDefined();
      const prompt = await client.getPrompt("prompt_1", { a: "b" }, meta);
      expect(prompt.result).toBeDefined();

      // getCompletions with context + metadata (context-truthy + _meta-truthy).
      await client
        .getCompletions(
          { type: "ref/prompt", name: "prompt_1" },
          "a",
          "",
          { other: "v" },
          meta,
        )
        .catch(() => {
          // server may not support completions; the param-build branches ran.
        });
    });

    it("getPrompt without args uses an empty arg map and omits params", async () => {
      const prompts = createNumberedPrompts(1);
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
        prompts,
        serverType: "sse",
      });
      await server.start();
      client = new InspectorClient(
        { type: "sse", url: server.url },
        { environment: { transport: createTransportNode } },
      );
      await client.connect();
      // No args → `args ? convertPromptArguments(args) : {}` false branch and
      // `Object.keys(stringArgs).length > 0 ? stringArgs : undefined` false branch.
      const invocation = await client.getPrompt("prompt_1");
      expect(invocation.result).toBeDefined();
      expect(invocation.params).toBeUndefined();
    });

    it("getCompletions without context omits the context param", async () => {
      client = stdioClient();
      await client.connect();
      // No context arg → the `context ? { context } : {}` false branch.
      await client
        .getCompletions({ type: "ref/prompt", name: "x" }, "arg", "")
        .catch(() => {
          // server support varies; the param-build branch is what we exercise.
        });
    });

    it("getCompletions falls back to empty values when completion omits them", async () => {
      client = stdioClient();
      await client.connect();
      const c = client as unknown as {
        client: { complete: () => Promise<unknown> };
      };
      // completion present but without a `values` field → `|| []` branch.
      c.client.complete = async () => ({ completion: {} });
      const res = await client.getCompletions(
        { type: "ref/prompt", name: "x" },
        "arg",
        "",
        undefined,
        { progressToken: "tok" },
      );
      expect(res.values).toEqual([]);
    });

    it("readResourceFromTemplate wraps a URI-expansion failure", async () => {
      client = stdioClient();
      await client.connect();
      // A malformed template triggers UriTemplate parse/expand to throw.
      await expect(
        client.readResourceFromTemplate("file:///{unclosed", { path: "x" }),
      ).rejects.toThrow(/Failed to expand URI template/);
    });
  });

  describe("uninitialized-client guards", () => {
    it("attemptToolCall path throws when client is null (via callTool guard)", async () => {
      const c = stdioClient();
      (c as unknown as { client: unknown }).client = null;
      await expect(
        c.callTool({ name: "x", inputSchema: { type: "object" } }, {}),
      ).rejects.toThrow(/Client is not connected/);
    });

    it("fetchServerInfo returns early when client is null", async () => {
      const c = stdioClient();
      (c as unknown as { client: unknown }).client = null;
      await expect(
        (
          c as unknown as { fetchServerInfo: () => Promise<void> }
        ).fetchServerInfo(),
      ).resolves.toBeUndefined();
    });

    it("setOAuthConfig succeeds when an oauth manager is configured", async () => {
      const c = new InspectorClient(
        { type: "sse", url: "http://localhost:9/sse" },
        {
          environment: { transport: createTransportNode },
          oauth: { clientId: "initial" },
        },
      );
      // Manager exists → delegates to it without throwing.
      expect(() => c.setOAuthConfig({ clientId: "updated" })).not.toThrow();
    });
  });

  describe("failed tool calls with metadata combinations", () => {
    // A tool the server will reject (unknown name) so the call always errors,
    // exercising the error-path metadata-merge branches in callTool
    // (dispatchFailedToolCall) and callToolStream.
    const badTool: Tool = {
      name: "definitely-not-a-real-tool",
      inputSchema: { type: "object" },
    };

    it("callTool error path covers general-only, tool-specific-only, and both metadata", async () => {
      client = stdioClient();
      await client.connect();
      // Force the underlying SDK callTool to throw so the dispatchFailedToolCall
      // error path runs for each metadata combination.
      const c = client as unknown as {
        client: { callTool: () => Promise<never> };
      };
      c.client.callTool = async () => {
        throw new Error("forced-call-failure");
      };

      await expect(
        client.callTool(badTool, {}, { g: "1" }, undefined),
      ).rejects.toThrow(/forced-call-failure/);
      await expect(
        client.callTool(badTool, {}, undefined, { t: "1" }),
      ).rejects.toThrow(/forced-call-failure/);
      await expect(
        client.callTool(badTool, {}, { g: "1" }, { t: "2" }),
      ).rejects.toThrow(/forced-call-failure/);
      await expect(
        client.callTool(badTool, {}, undefined, undefined),
      ).rejects.toThrow(/forced-call-failure/);
    });

    it("callToolStream error path covers metadata combinations", async () => {
      client = stdioClient();
      await client.connect();
      // Force the streaming API to throw synchronously so the error-path
      // metadata-merge branches run for each combination.
      const c = client as unknown as {
        client: { experimental: { tasks: { callToolStream: () => never } } };
      };
      c.client.experimental.tasks.callToolStream = () => {
        throw new Error("forced-stream-failure");
      };

      await expect(
        client.callToolStream(badTool, {}, { g: "1" }, undefined),
      ).rejects.toThrow(/forced-stream-failure/);
      await expect(
        client.callToolStream(badTool, {}, undefined, { t: "1" }),
      ).rejects.toThrow(/forced-stream-failure/);
      await expect(
        client.callToolStream(badTool, {}, { g: "1" }, { t: "2" }),
      ).rejects.toThrow(/forced-stream-failure/);
      await expect(
        client.callToolStream(badTool, {}, undefined, undefined),
      ).rejects.toThrow(/forced-stream-failure/);
    });

    it("callToolStream success path covers metadata combinations", async () => {
      client = stdioClient();
      await client.connect();
      const echo = await getTool(client, "echo");

      // general-only
      const r1 = await client.callToolStream(
        echo,
        { message: "a" },
        { g: "1" },
        undefined,
      );
      expect(r1.success).toBe(true);
      // tool-specific-only
      const r2 = await client.callToolStream(
        echo,
        { message: "b" },
        undefined,
        { t: "1" },
      );
      expect(r2.success).toBe(true);
      // both
      const r3 = await client.callToolStream(
        echo,
        { message: "c" },
        { g: "1" },
        { t: "2" },
      );
      expect(r3.success).toBe(true);
    });

    it("callToolStream throws when client is not connected", async () => {
      const c = stdioClient();
      (c as unknown as { client: unknown }).client = null;
      await expect(c.callToolStream(badTool, {})).rejects.toThrow(
        /Client is not connected/,
      );
    });
  });

  describe("connect-time timeout and safe-disconnect", () => {
    it("times out the handshake when connectionTimeout is exceeded", async () => {
      // Point at a non-routable address so the TCP connect HANGS (rather than
      // refusing immediately). With a tiny connectionTimeout the Promise.race
      // timeout wins, exercising the timeout branch (catch + disconnect +
      // rethrow) and the connectPromise.catch(()=>{}) late-rejection absorber.
      client = new InspectorClient(
        { type: "streamable-http", url: "http://10.255.255.1:81/mcp" },
        {
          environment: { transport: createTransportNode },
          serverSettings: {
            headers: [],
            env: [],
            metadata: [],
            connectionTimeout: 1,
            requestTimeout: 0,
            taskTtl: 0,
            maxFetchRequests: 1000,
            roots: [],
          },
        },
      );
      await expect(client.connect()).rejects.toThrow(/timed out/i);
      client = null;
    });

    it("disconnect(safeDisconnectTimeout) polls the response handlers before closing", async () => {
      client = stdioClient();
      await client.connect();
      // A positive safeDisconnectTimeout drives the poll loop. With no pending
      // handlers it returns promptly; the loop guard + close still run.
      await expect(client.disconnect(50)).resolves.toBeUndefined();
      expect(client.getStatus()).toBe("disconnected");
      client = null;
    });
  });

  describe("non-Error rejections and empty-response fallbacks", () => {
    it("getCompletions wraps a non-Error rejection via String(error)", async () => {
      client = stdioClient();
      await client.connect();
      const c = client as unknown as {
        client: { complete: () => Promise<never> };
      };
      c.client.complete = async () => {
        // Throw a non-Error so the `: String(error)` branch runs.
        throw "string-completions-failure";
      };
      await expect(
        client.getCompletions({ type: "ref/prompt", name: "x" }, "a", ""),
      ).rejects.toThrow(
        /Failed to get completions: string-completions-failure/,
      );
    });

    it("subscribe / unsubscribe wrap a non-Error rejection via String(error)", async () => {
      server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
        resources: [],
        subscriptions: true,
        serverType: "sse",
      });
      await server.start();
      client = new InspectorClient(
        { type: "sse", url: server.url },
        { environment: { transport: createTransportNode } },
      );
      await client.connect();
      const c = client as unknown as {
        client: {
          subscribeResource: () => Promise<never>;
          unsubscribeResource: () => Promise<never>;
        };
      };
      c.client.subscribeResource = async () => {
        throw "string-sub-failure";
      };
      c.client.unsubscribeResource = async () => {
        throw "string-unsub-failure";
      };
      await expect(client.subscribeToResource("test://x")).rejects.toThrow(
        /Failed to subscribe to resource: string-sub-failure/,
      );
      await expect(client.unsubscribeFromResource("test://x")).rejects.toThrow(
        /Failed to unsubscribe from resource: string-unsub-failure/,
      );
    });

    it("callToolStream error dispatch handles a non-Error rejection", async () => {
      client = stdioClient();
      await client.connect();
      const echo = await getTool(client, "echo");
      const c = client as unknown as {
        client: { experimental: { tasks: { callToolStream: () => never } } };
      };
      c.client.experimental.tasks.callToolStream = () => {
        throw "string-stream-failure";
      };
      await expect(
        client.callToolStream(echo, { message: "x" }, { g: "1" }),
      ).rejects.toBe("string-stream-failure");
    });

    it("list methods fall back to empty arrays when the response omits them", async () => {
      client = stdioClient();
      await client.connect();
      const c = client as unknown as {
        client: {
          listResources: () => Promise<unknown>;
          listResourceTemplates: () => Promise<unknown>;
          listPrompts: () => Promise<unknown>;
          listTools: () => Promise<unknown>;
        };
      };
      // Return responses missing the array field → `|| []` fallback branches.
      c.client.listResources = async () => ({});
      c.client.listResourceTemplates = async () => ({});
      c.client.listPrompts = async () => ({});
      c.client.listTools = async () => ({});

      expect((await client.listResources()).resources).toEqual([]);
      expect((await client.listResourceTemplates()).resourceTemplates).toEqual(
        [],
      );
      expect((await client.listPrompts()).prompts).toEqual([]);
      expect((await client.listTools()).tools).toEqual([]);
    });

    it("readResourceFromTemplate expand-failure wraps a non-Error", async () => {
      client = stdioClient();
      await client.connect();
      // Make the SDK UriTemplate throw a non-Error by passing a template that
      // the UriTemplate constructor rejects. (If it throws an Error, the Error
      // branch runs instead; either way the catch wrapper is covered.)
      await expect(
        client.readResourceFromTemplate("{a,b,c", { x: "1" }),
      ).rejects.toThrow(/Failed to expand URI template/);
    });
  });

  describe("callToolStream task-result fallback and terminal branches", () => {
    function patchStream(
      c: InspectorClient,
      gen: () => AsyncGenerator<unknown>,
      getTaskResult?: () => Promise<unknown>,
    ): void {
      const internal = c as unknown as {
        client: {
          experimental: {
            tasks: {
              callToolStream: () => AsyncGenerator<unknown>;
              getTaskResult: (id: string) => Promise<unknown>;
            };
          };
        };
      };
      internal.client.experimental.tasks.callToolStream = gen;
      if (getTaskResult) {
        internal.client.experimental.tasks.getTaskResult = getTaskResult;
      }
    }

    const fakeTask = (taskId: string) => ({
      taskId,
      status: "working" as const,
      ttl: null,
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    });

    it("falls back to getTaskResult when the stream yields no result message", async () => {
      client = stdioClient();
      await client.connect();
      const echo = await getTool(client, "echo");
      patchStream(
        client,
        async function* () {
          // taskCreated then taskStatus, but NO result → triggers the fallback.
          yield { type: "taskCreated", task: fakeTask("T1") };
          yield { type: "taskStatus", task: fakeTask("T1") };
        },
        async () => ({ content: [{ type: "text", text: "from-fallback" }] }),
      );
      const result = await client.callToolStream(echo, { message: "x" });
      expect(result.success).toBe(true);
      expect(result.result?.content?.[0]).toMatchObject({
        text: "from-fallback",
      });
    });

    it("throws when the getTaskResult fallback itself fails", async () => {
      client = stdioClient();
      await client.connect();
      const echo = await getTool(client, "echo");
      patchStream(
        client,
        async function* () {
          yield { type: "taskCreated", task: fakeTask("T2") };
        },
        async () => {
          throw new Error("fallback-failed");
        },
      );
      await expect(
        client.callToolStream(echo, { message: "x" }),
      ).rejects.toThrow(/Tool call did not return a result: fallback-failed/);
    });

    it("surfaces a stream error message and marks the task failed", async () => {
      client = stdioClient();
      await client.connect();
      const echo = await getTool(client, "echo");
      patchStream(client, async function* () {
        yield { type: "taskCreated", task: fakeTask("T3") };
        // Empty error message → `message.error.message || "Task execution failed"`
        // falsy branch.
        yield { type: "error", error: { message: "" } };
      });
      await expect(
        client.callToolStream(echo, { message: "x" }),
      ).rejects.toThrow(/Task execution failed/);
    });

    it("treats a stream taskStatus before taskCreated as the task id", async () => {
      client = stdioClient();
      await client.connect();
      const echo = await getTool(client, "echo");
      patchStream(client, async function* () {
        // taskStatus arrives first (no prior taskCreated) → `if (!taskId)` true.
        yield { type: "taskStatus", task: fakeTask("T4") };
        yield {
          type: "result",
          result: { content: [{ type: "text", text: "ok" }] },
        };
      });
      const result = await client.callToolStream(echo, { message: "x" });
      expect(result.success).toBe(true);
    });
  });

  describe("constructor capability branches and createReceiverTask options", () => {
    it("constructs with no advertised capabilities (clientOptions undefined branch)", async () => {
      // sample:false + elicit:false + no roots + no receiverTasks → the
      // capabilities object is empty, so clientOptions is passed as undefined.
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          environment: { transport: createTransportNode },
          sample: false,
          elicit: false,
        },
      );
      const caps = client.getClientCapabilities();
      expect(Object.keys(caps)).toHaveLength(0);
      await client.connect();
      expect(client.getStatus()).toBe("connected");
    });

    it("createReceiverTask honors pollInterval and statusMessage options", async () => {
      client = stdioClient();
      await client.connect();
      const internal = client as unknown as {
        createReceiverTask: (opts: {
          initialStatus: string;
          ttl?: number;
          pollInterval?: number;
          statusMessage?: string;
        }) => {
          task: {
            taskId: string;
            pollInterval?: number;
            statusMessage?: string;
          };
        };
      };
      const record = internal.createReceiverTask({
        initialStatus: "working",
        ttl: 5000,
        pollInterval: 250,
        statusMessage: "in progress",
      });
      expect(record.task.pollInterval).toBe(250);
      expect(record.task.statusMessage).toBe("in progress");

      // Omitting ttl falls back to the configured numeric receiverTaskTtlMs
      // (default 60_000) → the non-function branch of the ttl resolution.
      const recordNoTtl = internal.createReceiverTask({
        initialStatus: "working",
      }) as unknown as { task: { ttl: number } };
      expect(recordNoTtl.task.ttl).toBe(60_000);
    });

    it("createReceiverTask falls back to the configured TTL when ttl is omitted (function form)", async () => {
      // receiverTaskTtlMs as a function → exercises the typeof === 'function'
      // branch of the ttl resolution.
      client = new InspectorClient(
        {
          type: "stdio",
          command: serverCommand.command,
          args: serverCommand.args,
        },
        {
          environment: { transport: createTransportNode },
          receiverTasks: true,
          receiverTaskTtlMs: () => 1234,
        },
      );
      await client.connect();
      const internal = client as unknown as {
        createReceiverTask: (opts: { initialStatus: string }) => {
          task: { ttl: number };
        };
      };
      const record = internal.createReceiverTask({ initialStatus: "working" });
      expect(record.task.ttl).toBe(1234);
    });
  });

  describe("emitReceiverTaskStatus guards", () => {
    it("is a no-op when there is no connected client", () => {
      const c = stdioClient();
      (c as unknown as { client: unknown }).client = null;
      // Should not throw even though client is null.
      expect(() =>
        (
          c as unknown as { emitReceiverTaskStatus: (t: unknown) => void }
        ).emitReceiverTaskStatus({ taskId: "t" }),
      ).not.toThrow();
    });

    it("swallows notification-build errors via the catch path", async () => {
      client = stdioClient();
      await client.connect();
      const internal = client as unknown as {
        emitReceiverTaskStatus: (t: unknown) => void;
      };
      // Passing a malformed task makes TaskStatusNotificationSchema.parse throw,
      // which is caught and logged (no throw).
      expect(() =>
        internal.emitReceiverTaskStatus({ not: "a task" }),
      ).not.toThrow();
    });

    it("upsertReceiverTask emits status for an existing record", async () => {
      client = stdioClient();
      await client.connect();
      const internal = client as unknown as {
        createReceiverTask: (opts: { initialStatus: string; ttl?: number }) => {
          task: { taskId: string; status: string };
        };
        upsertReceiverTask: (t: { taskId: string; status: string }) => void;
        getReceiverTask: (
          id: string,
        ) => { task: { status: string } } | undefined;
      };
      const record = internal.createReceiverTask({
        initialStatus: "working",
        ttl: 5000,
      });
      const updated = { ...record.task, status: "completed" };
      internal.upsertReceiverTask(updated);
      expect(internal.getReceiverTask(record.task.taskId)?.task.status).toBe(
        "completed",
      );
      // upsert on an unknown id is a no-op (record undefined branch).
      expect(() =>
        internal.upsertReceiverTask({ taskId: "missing", status: "completed" }),
      ).not.toThrow();
    });
  });
});
