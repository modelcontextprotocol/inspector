import { describe, it, expect, afterEach, afterAll } from "vitest";
import * as z from "zod/v4";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { eraToVersionNegotiation } from "@inspector/core/mcp/types.js";
import { ManagedRequestorTasksState } from "@inspector/core/mcp/state/managedRequestorTasksState.js";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
} from "@modelcontextprotocol/inspector-test-server";
import type { ServerConfig } from "@modelcontextprotocol/inspector-test-server";
import { getTaskServerConfig } from "@modelcontextprotocol/inspector-test-server";
import type { ContentBlock } from "@modelcontextprotocol/client";
import type { MessageEntry } from "@inspector/core/mcp/types.js";

/**
 * Live coverage of the Tasks era fork (#1631). Modern (2026-07-28) servers serve
 * the `io.modelcontextprotocol/tasks` extension (SEP-2663): a task-augmented
 * `tools/call` returns a `CreateTaskResult`, the client polls `tasks/get`
 * (no `tasks/list`, no blocking `tasks/result`), an `input_required` task
 * surfaces an embedded elicitation answered via `tasks/update`, and a completed
 * task inlines its result. Legacy servers keep the `capabilities.tasks` /
 * `tasks/list` flow. Both are driven against a real server over a real transport.
 */
describe("tasks era fork (#1631)", () => {
  let client: InspectorClient | null = null;
  // One server per era, shared across the block's tests (started lazily, stopped
  // in afterAll). Starting a fresh Express server per test made connection
  // negotiation flaky under the heavy concurrent coverage run; task ids are
  // unique per create so sharing state is harmless.
  let modernServer: TestServerHttp | null = null;
  let legacyServer: TestServerHttp | null = null;

  afterEach(async () => {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // ignore
      }
      client = null;
    }
  });

  afterAll(async () => {
    for (const s of [modernServer, legacyServer]) {
      if (s) {
        try {
          await s.stop();
        } catch {
          // ignore
        }
      }
    }
    modernServer = null;
    legacyServer = null;
  });

  async function startModernTasksServer(): Promise<TestServerHttp> {
    if (modernServer) return modernServer;
    const started = createTestServerHttp({
      serverInfo: createTestServerInfo("tasks-modern-test", "1.0.0"),
      tasksExtension: true,
      // A plain tool alongside the task tools, so a modern tools/call that does
      // NOT create a task exercises the synchronous-result path.
      tools: [
        {
          name: "plain_echo",
          description: "Echo the message without creating a task",
          inputSchema: { message: z.string().optional() },
          handler: async (args: Record<string, unknown>) => ({
            content: [
              { type: "text" as const, text: `echo:${args.message ?? ""}` },
            ],
          }),
        },
      ],
      modern: {},
    });
    await started.start();
    modernServer = started;
    return started;
  }

  async function startLegacyTasksServer(): Promise<TestServerHttp> {
    if (legacyServer) return legacyServer;
    const config = getTaskServerConfig() as ServerConfig;
    const started = createTestServerHttp({
      ...config,
      serverInfo: createTestServerInfo("tasks-legacy-test", "1.0.0"),
    });
    await started.start();
    legacyServer = started;
    return started;
  }

  async function connect(
    url: string,
    era: "legacy" | "modern",
  ): Promise<{ connected: InspectorClient; messages: MessageEntry[] }> {
    const connected = new InspectorClient(
      { type: "streamable-http", url },
      {
        environment: { transport: createTransportNode },
        versionNegotiation: eraToVersionNegotiation(era),
      },
    );
    const messages: MessageEntry[] = [];
    connected.addEventListener("message", (event) => {
      messages.push(event.detail);
    });
    await connected.connect();
    client = connected;
    return { connected, messages };
  }

  function methodsSent(messages: MessageEntry[]): string[] {
    return messages
      .filter((m) => m.direction === "request")
      .map((m) => ("method" in m.message ? m.message.method : ""))
      .filter(Boolean);
  }

  function firstText(content: ContentBlock[] | undefined): string {
    const block = content?.[0];
    return block && "text" in block ? block.text : "";
  }

  describe("modern era", () => {
    it("negotiates the tasks extension and gates on it", async () => {
      const started = await startModernTasksServer();
      const { connected } = await connect(started.url, "modern");
      expect(connected.getProtocolEra()).toBe("modern");
      expect(connected.isTasksExtensionNegotiated()).toBe(true);
      expect(
        connected.getCapabilities()?.extensions?.[
          "io.modelcontextprotocol/tasks"
        ],
      ).toBeDefined();
    });

    it("creates a task, polls tasks/get (no tasks/list or tasks/result), and inlines the completed result", async () => {
      const started = await startModernTasksServer();
      const { connected, messages } = await connect(started.url, "modern");
      const { tools } = await connected.listTools();
      const tool = tools.find((t) => t.name === "modern_task");
      expect(tool).toBeDefined();

      messages.length = 0;
      const invocation = await connected.callToolStream(tool!, {
        message: "hi",
      });
      expect(invocation.success).toBe(true);
      expect(firstText(invocation.result?.content as ContentBlock[])).toContain(
        "completed",
      );

      const methods = methodsSent(messages);
      expect(methods).toContain("tasks/get");
      expect(methods).not.toContain("tasks/list");
      expect(methods).not.toContain("tasks/result");

      // Every task-eligible request declares the extension per-request (SEP-2663).
      const call = messages.find(
        (m) =>
          m.direction === "request" &&
          "method" in m.message &&
          m.message.method === "tools/call",
      );
      const meta = (
        call?.message as { params?: { _meta?: Record<string, unknown> } }
      ).params?._meta;
      expect(
        (
          meta?.["io.modelcontextprotocol/clientCapabilities"] as {
            extensions?: Record<string, unknown>;
          }
        )?.extensions,
      ).toHaveProperty("io.modelcontextprotocol/tasks");
    });

    it("answers an input_required task via tasks/update, then completes", async () => {
      const started = await startModernTasksServer();
      const { connected, messages } = await connect(started.url, "modern");
      const { tools } = await connected.listTools();
      const tool = tools.find((t) => t.name === "modern_input_task");
      expect(tool).toBeDefined();

      let pausedAtPendingUi = false;
      connected.addEventListener("newPendingElicitation", (event) => {
        pausedAtPendingUi = true;
        // The task round is tagged distinctly from an MRTR round so the UI can
        // show the accurate "answer via tasks/update" note (#1631 follow-up).
        expect(event.detail.origin).toBe("task-input-required");
        void event.detail.respond({
          action: "accept",
          content: { approved: true },
        });
      });

      messages.length = 0;
      const invocation = await connected.callToolStream(tool!, {});
      expect(invocation.success).toBe(true);
      expect(pausedAtPendingUi).toBe(true);
      expect(firstText(invocation.result?.content as ContentBlock[])).toContain(
        "approved",
      );

      const methods = methodsSent(messages);
      expect(methods).toContain("tasks/update");
    });

    it("auto-polls an unsolicited task handle on the ordinary callTool path (#1631 follow-up)", async () => {
      const started = await startModernTasksServer();
      const { connected, messages } = await connect(started.url, "modern");
      const { tools } = await connected.listTools();
      const tool = tools.find((t) => t.name === "modern_task")!;

      // The ordinary (non-run-as-task) path: the server answers with a task
      // handle; callTool must poll it to termination and resolve to the task's
      // final inline result — NOT the transport's "task created" placeholder.
      const taskUpdates: string[] = [];
      connected.addEventListener("requestorTaskUpdated", (event) => {
        taskUpdates.push(event.detail.taskId);
      });

      messages.length = 0;
      const invocation = await connected.callTool(tool, {
        message: "unsolicited",
      });
      expect(invocation.success).toBe(true);
      expect(firstText(invocation.result?.content as ContentBlock[])).toContain(
        "completed",
      );
      expect(taskUpdates.length).toBeGreaterThan(0);
      expect(methodsSent(messages)).toContain("tasks/get");
    });

    it("answers an input_required unsolicited handle via tasks/update on the ordinary path (#1631 follow-up)", async () => {
      const started = await startModernTasksServer();
      const { connected, messages } = await connect(started.url, "modern");
      const { tools } = await connected.listTools();
      const tool = tools.find((t) => t.name === "modern_input_task")!;

      connected.addEventListener("newPendingElicitation", (event) => {
        expect(event.detail.origin).toBe("task-input-required");
        void event.detail.respond({
          action: "accept",
          content: { approved: true },
        });
      });

      messages.length = 0;
      const invocation = await connected.callTool(tool, {});
      expect(invocation.success).toBe(true);
      expect(firstText(invocation.result?.content as ContentBlock[])).toContain(
        "approved",
      );
      expect(methodsSent(messages)).toContain("tasks/update");
    });

    it("bounds a never-completing input_required task with the round cap (#1631 review)", async () => {
      const started = await startModernTasksServer();
      const { connected } = await connect(started.url, "modern");
      const { tools } = await connected.listTools();
      const tool = tools.find((t) => t.name === "modern_loop_task")!;

      // The server never advances past input_required, so the client re-prompts
      // each poll; auto-answer, and the round cap must eventually abort instead
      // of looping forever.
      connected.addEventListener("newPendingElicitation", (event) => {
        void event.detail.respond({
          action: "accept",
          content: { approved: true },
        });
      });

      await expect(connected.callToolStream(tool, {})).rejects.toThrow(
        /exceeded \d+ input_required rounds/,
      );
    });

    it("cancels a modern task via tasks/cancel", async () => {
      const started = await startModernTasksServer();
      const { connected, messages } = await connect(started.url, "modern");
      const { tools } = await connected.listTools();

      // Seed a task via a direct tools/call so we hold its id, then cancel it.
      const seed = await connected.getRequestorTask.bind(connected);
      expect(typeof seed).toBe("function");

      // Create through the poll stream but cancel from the Tasks side: run the
      // input task (which parks at input_required) and cancel by id.
      const tool = tools.find((t) => t.name === "modern_input_task")!;
      let capturedTaskId: string | undefined;
      connected.addEventListener("requestorTaskUpdated", (event) => {
        capturedTaskId = event.detail.taskId;
      });
      connected.addEventListener("newPendingElicitation", (event) => {
        // Cancel the underlying task instead of answering.
        if (capturedTaskId) void connected.cancelRequestorTask(capturedTaskId);
        void event.detail.respond({ action: "cancel" });
      });

      messages.length = 0;
      await connected.callToolStream(tool, {}).catch(() => {
        // the cancel path may reject the stream; that's fine for this assertion
      });
      expect(methodsSent(messages)).toContain("tasks/cancel");
    });

    it("passes a synchronous (non-task) tool result straight through", async () => {
      const started = await startModernTasksServer();
      const { connected } = await connect(started.url, "modern");
      const { tools } = await connected.listTools();
      const plain = tools.find((t) => t.name === "plain_echo");
      expect(plain).toBeDefined();

      const invocation = await connected.callToolStream(plain!, {
        message: "hi",
      });
      expect(invocation.success).toBe(true);
      expect(firstText(invocation.result?.content as ContentBlock[])).toContain(
        "echo:hi",
      );
    });

    it("rejects a tasks/get for an unknown task id (raw-wire error path)", async () => {
      const started = await startModernTasksServer();
      const { connected } = await connect(started.url, "modern");
      await expect(
        connected.getRequestorTask("does-not-exist"),
      ).rejects.toThrow();
    });

    it("modern store refresh re-polls known tasks (no tasks/list)", async () => {
      const started = await startModernTasksServer();
      const { connected, messages } = await connect(started.url, "modern");
      const store = new ManagedRequestorTasksState(connected);
      const { tools } = await connected.listTools();
      const tool = tools.find((t) => t.name === "modern_task")!;

      // Running the task seeds the store via requestorTaskUpdated events.
      await connected.callToolStream(tool, { message: "x" });
      expect(store.getTasks().length).toBeGreaterThan(0);

      messages.length = 0;
      await store.refresh();
      const methods = methodsSent(messages);
      // Refresh re-polls with tasks/get; it never calls tasks/list on modern.
      expect(methods).not.toContain("tasks/list");
      store.destroy();
    });
  });

  describe("legacy era", () => {
    it("does not negotiate the extension and keeps the tasks/list flow", async () => {
      const started = await startLegacyTasksServer();
      const { connected, messages } = await connect(started.url, "legacy");
      expect(connected.isTasksExtensionNegotiated()).toBe(false);
      expect(connected.getCapabilities()?.tasks).toBeDefined();

      const store = new ManagedRequestorTasksState(connected);
      messages.length = 0;
      await store.refresh();
      expect(methodsSent(messages)).toContain("tasks/list");
      store.destroy();
    });
  });
});
