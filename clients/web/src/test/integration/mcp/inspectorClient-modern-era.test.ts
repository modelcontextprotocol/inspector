import { describe, it, expect, afterEach } from "vitest";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { ToolCallCancelledError } from "@inspector/core/mcp/toolCallCancelledError.js";
import {
  eraToVersionNegotiation,
  MODERN_PROTOCOL_VERSION,
} from "@inspector/core/mcp/types.js";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
  createEchoTool,
  createSendNotificationTool,
  createMrtrTool,
  createMrtrMultiRoundTool,
  createMrtrRootsTool,
  createMrtrSamplingTool,
  createMrtrLoopTool,
  createMrtrEdgeCaseTool,
} from "@modelcontextprotocol/inspector-test-server";
import type { ServerConfig } from "@modelcontextprotocol/inspector-test-server";
import type {
  ContentBlock,
  JSONRPCRequest,
} from "@modelcontextprotocol/client";
import { LOG_LEVEL_META_KEY } from "@modelcontextprotocol/client";
import type { MessageEntry } from "@inspector/core/mcp/types.js";

/**
 * Live coverage of the modern (2026-07-28) connection path (#1700). The bundled
 * 2025 test servers negotiate legacy only; the `modern` preset here mounts the
 * SDK's `createMcpHandler`, so an SDK v2 client negotiating
 * `protocolEra: "auto" | "modern"` reaches the modern leg end-to-end. This is
 * the live counterpart to the `auto → legacy` (stdio) test in
 * `inspectorClient.test.ts`.
 */
describe("modern-era negotiation (2026-07-28)", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;

  afterEach(async () => {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      client = null;
    }
    if (server) {
      try {
        await server.stop();
      } catch {
        // Ignore server stop errors
      }
      server = null;
    }
  });

  async function startServer(
    modern: ServerConfig["modern"] = {},
  ): Promise<TestServerHttp> {
    const started = createTestServerHttp({
      serverInfo: createTestServerInfo("modern-era-test", "1.0.0"),
      tools: [createEchoTool()],
      modern,
    });
    await started.start();
    server = started;
    return started;
  }

  async function connectWithEra(
    url: string,
    era: "legacy" | "auto" | "modern",
  ): Promise<InspectorClient> {
    const connected = new InspectorClient(
      { type: "streamable-http", url },
      {
        environment: { transport: createTransportNode },
        versionNegotiation: eraToVersionNegotiation(era),
      },
    );
    await connected.connect();
    client = connected;
    return connected;
  }

  it("negotiates the modern era under 'auto' with a populated discover result", async () => {
    const started = await startServer();
    const connected = await connectWithEra(started.url, "auto");

    expect(connected.getProtocolEra()).toBe("modern");
    expect(connected.getProtocolVersion()).toBe(MODERN_PROTOCOL_VERSION);

    // Unlike a legacy server, a modern server answers server/discover, so the
    // discover result is populated (supported versions + capabilities).
    const discover = connected.getDiscoverResult();
    expect(discover).toBeDefined();
    expect(discover?.supportedVersions).toContain(MODERN_PROTOCOL_VERSION);
  });

  it("negotiates the modern era under a 'modern' pin", async () => {
    const started = await startServer();
    const connected = await connectWithEra(started.url, "modern");

    expect(connected.getProtocolEra()).toBe("modern");
    expect(connected.getProtocolVersion()).toBe(MODERN_PROTOCOL_VERSION);
    expect(connected.getDiscoverResult()?.supportedVersions).toContain(
      MODERN_PROTOCOL_VERSION,
    );
  });

  it("still connects a legacy client via the stateless fallback (dual-era)", async () => {
    const started = await startServer({ legacy: "stateless" });
    const connected = await connectWithEra(started.url, "legacy");

    // A plain 2025 initialize handshake is routed to the stateless legacy leg,
    // so the client connects and reports the legacy era.
    expect(connected.getProtocolEra()).toBe("legacy");
    expect(connected.getDiscoverResult()).toBeUndefined();
    expect((await connected.listTools()).tools.length).toBeGreaterThan(0);
  });

  it("exercises the modern surface after an 'auto' connect (tools/call)", async () => {
    const started = await startServer();
    const connected = await connectWithEra(started.url, "auto");

    const { tools } = await connected.listTools();
    const echo = tools.find((t) => t.name === "echo");
    expect(echo).toBeDefined();

    const result = await connected.callTool(echo!, { message: "hi" });
    expect(result.success).toBe(true);
    const content = result.result!.content as ContentBlock[];
    expect(content[0]).toHaveProperty("type", "text");
    expect("text" in content[0] && content[0].text).toContain("hi");
  });

  // Collect every outbound `tools/call` request frame the transport captured,
  // so a test can assert what the MRTR retry actually put on the wire.
  function collectToolCallRequests(
    connected: InspectorClient,
  ): JSONRPCRequest[] {
    const frames: JSONRPCRequest[] = [];
    connected.addEventListener("message", (event) => {
      const entry = event.detail;
      if (
        entry.direction === "request" &&
        "method" in entry.message &&
        entry.message.method === "tools/call"
      ) {
        frames.push(entry.message as JSONRPCRequest);
      }
    });
    return frames;
  }

  async function startMrtrServer(
    tool: ReturnType<typeof createMrtrTool>,
  ): Promise<TestServerHttp> {
    const started = createTestServerHttp({
      serverInfo: createTestServerInfo("modern-mrtr-test", "1.0.0"),
      tools: [tool],
      modern: {},
    });
    await started.start();
    server = started;
    return started;
  }

  it("drives an MRTR round-trip manually (pauses at the pending UI, retries with inputResponses + requestState on a new id)", async () => {
    // The modern (2026-07-28) leg has no server→client requests; a tool that
    // needs input returns `input_required` embedding the request. With the SDK's
    // auto-fulfil disabled, InspectorClient drives the loop itself: it surfaces
    // the embedded elicitation through the pending-request UI, then retries the
    // original call with the answer.
    const started = await startMrtrServer(createMrtrTool());
    const connected = await connectWithEra(started.url, "modern");
    const toolCallFrames = collectToolCallRequests(connected);

    // Prove the pending UX actually paused: record that an elicitation was
    // surfaced BEFORE we answer it (the manual driver enqueued it), then answer.
    let pausedAtPendingUi = false;
    connected.addEventListener("newPendingElicitation", (event) => {
      pausedAtPendingUi = true;
      // The manual driver tags an MRTR round's request "input-required".
      expect(event.detail.origin).toBe("input-required");
      void event.detail.respond({
        action: "accept",
        content: { confirm: true },
      });
    });

    const { tools } = await connected.listTools();
    const mrtr = tools.find((t) => t.name === "mrtr_confirm");
    expect(mrtr).toBeDefined();

    const result = await connected.callTool(mrtr!, { action: "deploy" });
    expect(result.success).toBe(true);
    expect(pausedAtPendingUi).toBe(true);

    const content = result.result!.content as ContentBlock[];
    const text = content[0] && "text" in content[0] ? content[0].text : "";
    // The final result is only reachable after the input_required round was
    // fulfilled and the original call retried — i.e. the full MRTR loop ran.
    expect(text).toContain("MRTR complete");
    expect(text).toContain("confirm");

    // Two tools/call frames: the original and the retry. The retry has a
    // DIFFERENT json-rpc id and carries inputResponses + the echoed requestState.
    expect(toolCallFrames.length).toBe(2);
    const [original, retry] = toolCallFrames;
    expect(retry.id).not.toBe(original.id);
    const retryParams = retry.params as {
      inputResponses?: Record<string, unknown>;
      requestState?: unknown;
    };
    expect(retryParams.inputResponses?.confirm).toEqual({
      action: "accept",
      content: { confirm: true },
    });
    // The original call carries no requestState; the retry echoes the opaque
    // server-minted token verbatim (shape: `mrtr:<action>:<n>`).
    expect(
      (original.params as { requestState?: unknown }).requestState,
    ).toBeUndefined();
    expect(retryParams.requestState).toMatch(/^mrtr:deploy:/);
  });

  it("drives a multi-round MRTR (two embedded elicitations in sequence, then completes)", async () => {
    const started = await startMrtrServer(createMrtrMultiRoundTool());
    const connected = await connectWithEra(started.url, "modern");

    const seenMessages: string[] = [];
    connected.addEventListener("newPendingElicitation", (event) => {
      seenMessages.push(event.detail.request.params.message ?? "");
      void event.detail.respond({
        action: "accept",
        content: { value: `answer-${seenMessages.length}` },
      });
    });

    const { tools } = await connected.listTools();
    const tool = tools.find((t) => t.name === "mrtr_two_step");
    const result = await connected.callTool(tool!, {});
    expect(result.success).toBe(true);

    // Both rounds surfaced, in order.
    expect(seenMessages).toEqual([
      "Step 1: enter the first value",
      "Step 2: enter the second value",
    ]);
    const content = result.result!.content as ContentBlock[];
    const text = content[0] && "text" in content[0] ? content[0].text : "";
    expect(text).toContain("MRTR two-step complete");
  });

  it("auto-answers an embedded roots/list request from configured roots (no pending UI)", async () => {
    const started = await startMrtrServer(createMrtrRootsTool());
    const connected = new InspectorClient(
      { type: "streamable-http", url: started.url },
      {
        environment: { transport: createTransportNode },
        versionNegotiation: eraToVersionNegotiation("modern"),
        roots: [{ uri: "file:///workspace", name: "workspace" }],
      },
    );
    client = connected;
    await connected.connect();

    let surfacedPending = false;
    connected.addEventListener("newPendingElicitation", () => {
      surfacedPending = true;
    });
    connected.addEventListener("newPendingSample", () => {
      surfacedPending = true;
    });

    const { tools } = await connected.listTools();
    const tool = tools.find((t) => t.name === "mrtr_roots");
    const result = await connected.callTool(tool!, {});
    expect(result.success).toBe(true);
    // roots is answered silently — nothing pauses at the pending UI.
    expect(surfacedPending).toBe(false);
    const content = result.result!.content as ContentBlock[];
    const text = content[0] && "text" in content[0] ? content[0].text : "";
    expect(text).toContain("client reported 1 root");
  });

  it("surfaces an embedded sampling request through the pending-sample UI", async () => {
    const started = await startMrtrServer(createMrtrSamplingTool());
    const connected = await connectWithEra(started.url, "modern");

    let sampleOrigin: string | undefined;
    connected.addEventListener("newPendingSample", (event) => {
      sampleOrigin = event.detail.origin;
      void event.detail.respond({
        model: "test-model",
        stopReason: "endTurn",
        role: "assistant",
        content: { type: "text", text: "hello" },
      });
    });

    const { tools } = await connected.listTools();
    const tool = tools.find((t) => t.name === "mrtr_sample");
    const result = await connected.callTool(tool!, {});
    expect(result.success).toBe(true);
    expect(sampleOrigin).toBe("input-required");
    const content = result.result!.content as ContentBlock[];
    const text = content[0] && "text" in content[0] ? content[0].text : "";
    expect(text).toContain("MRTR sample complete");
  });

  it("echoes a declined elicitation back to the server (decline is not an abort)", async () => {
    const started = await startMrtrServer(createMrtrTool());
    const connected = await connectWithEra(started.url, "modern");

    connected.addEventListener("newPendingElicitation", (event) => {
      void event.detail.respond({ action: "decline" });
    });

    const { tools } = await connected.listTools();
    const tool = tools.find((t) => t.name === "mrtr_confirm");
    // The tool still completes — the declined result is echoed back, and the
    // server returns its final result citing the declined answer.
    const result = await connected.callTool(tool!, { action: "deploy" });
    expect(result.success).toBe(true);
    const content = result.result!.content as ContentBlock[];
    const text = content[0] && "text" in content[0] ? content[0].text : "";
    expect(text).toContain("MRTR complete");
    expect(text).toContain("decline");
  });

  it("bounds a pathological MRTR that never completes (MRTR_MAX_ROUNDS)", async () => {
    const started = await startMrtrServer(createMrtrLoopTool());
    const connected = await connectWithEra(started.url, "modern");

    // Auto-answer every round; the server never completes, so the driver's cap
    // must stop the loop rather than spin forever.
    connected.addEventListener("newPendingElicitation", (event) => {
      void event.detail.respond({ action: "accept", content: { value: "x" } });
    });

    const { tools } = await connected.listTools();
    const tool = tools.find((t) => t.name === "mrtr_loop");
    await expect(connected.callTool(tool!, {})).rejects.toThrow(
      /exceeded .* input_required rounds/,
    );
  });

  it("handles requestState-only and inputRequests-only rounds (param shaping)", async () => {
    const started = await startMrtrServer(createMrtrEdgeCaseTool());
    const connected = await connectWithEra(started.url, "modern");
    const toolCallFrames = collectToolCallRequests(connected);

    connected.addEventListener("newPendingElicitation", (event) => {
      void event.detail.respond({ action: "accept", content: { value: "n" } });
    });

    const { tools } = await connected.listTools();
    const tool = tools.find((t) => t.name === "mrtr_edge");
    const result = await connected.callTool(tool!, {});
    expect(result.success).toBe(true);
    const content = result.result!.content as ContentBlock[];
    const text = content[0] && "text" in content[0] ? content[0].text : "";
    expect(text).toContain("MRTR edge complete");

    // Three rounds: original + two retries.
    expect(toolCallFrames.length).toBe(3);
    // Round-1 retry carries inputResponses but NO requestState (round 1 minted
    // none).
    const retry1 = toolCallFrames[1].params as {
      inputResponses?: unknown;
      requestState?: unknown;
    };
    expect(retry1.inputResponses).toBeDefined();
    expect(retry1.requestState).toBeUndefined();
    // Round-2 retry carries requestState and no meaningful inputResponses (round
    // 2 was requestState-only; the driver adds none — the modern SDK codec may
    // serialize an empty `{}` on the wire).
    const retry2 = toolCallFrames[2].params as {
      inputResponses?: Record<string, unknown>;
      requestState?: unknown;
    };
    expect(retry2.requestState).toBeDefined();
    expect(Object.keys(retry2.inputResponses ?? {})).toHaveLength(0);
  });

  it("cancels an in-flight MRTR call while its embedded request is pending", async () => {
    const started = await startMrtrServer(createMrtrTool());
    const connected = await connectWithEra(started.url, "modern");

    // Cancel the tool call the moment its embedded elicitation is surfaced,
    // instead of answering it.
    connected.addEventListener("newPendingElicitation", () => {
      connected.cancelToolCall();
    });

    const { tools } = await connected.listTools();
    const tool = tools.find((t) => t.name === "mrtr_confirm");
    await expect(
      connected.callTool(tool!, { action: "deploy" }),
    ).rejects.toThrow(ToolCallCancelledError);
    // The pending elicitation was removed when the call aborted.
    expect(connected.getPendingElicitations()).toHaveLength(0);
  });

  // #1629: modern per-request log level. `logging/setLevel` is gone on the
  // modern leg; the client opts into logs by stamping the
  // `io.modelcontextprotocol/logLevel` `_meta` key on each request.
  function metaOf(frame: JSONRPCRequest): Record<string, unknown> {
    const params = frame.params as { _meta?: Record<string, unknown> };
    return params?._meta ?? {};
  }

  it("stamps the per-request log level on outgoing requests, tracks changes, and stops when cleared", async () => {
    const started = await startServer();
    const connected = await connectWithEra(started.url, "modern");
    const frames = collectToolCallRequests(connected);

    const { tools } = await connected.listTools();
    const echo = tools.find((t) => t.name === "echo")!;

    // No server setting was passed, so the client seeds the default modern log
    // level (DEFAULT_MODERN_LOG_LEVEL = "debug") — opted in from the start.
    expect(connected.getModernLogLevel()).toBe("debug");
    await connected.callTool(echo, { message: "a" });

    // Change the level — subsequent requests carry the new one.
    connected.setModernLogLevel("warning");
    expect(connected.getModernLogLevel()).toBe("warning");
    await connected.callTool(echo, { message: "b" });

    // Opt back out — the stamp disappears.
    connected.setModernLogLevel(undefined);
    expect(connected.getModernLogLevel()).toBeUndefined();
    await connected.callTool(echo, { message: "c" });

    expect(frames).toHaveLength(3);
    const [seeded, changed, cleared] = frames;
    expect(metaOf(seeded)[LOG_LEVEL_META_KEY]).toBe("debug");
    expect(metaOf(changed)[LOG_LEVEL_META_KEY]).toBe("warning");
    expect(metaOf(cleared)[LOG_LEVEL_META_KEY]).toBeUndefined();
  });

  it("seeds the per-request log level from the server setting (defaults opted-in), and 'off' opts out (#1629)", async () => {
    const started = await startServer();

    // A server setting of "info" seeds the client opted-in from the start — the
    // first tools/call stamps it without any UI interaction.
    const seeded = new InspectorClient(
      { type: "streamable-http", url: started.url },
      {
        environment: { transport: createTransportNode },
        versionNegotiation: eraToVersionNegotiation("modern"),
        serverSettings: {
          headers: [],
          metadata: [],
          env: [],
          connectionTimeout: 0,
          requestTimeout: 0,
          taskTtl: 60000,
          maxFetchRequests: 1000,
          roots: [],
          modernLogLevel: "info",
        },
      },
    );
    client = seeded;
    const seededFrames = collectToolCallRequests(seeded);
    await seeded.connect();
    expect(seeded.getModernLogLevel()).toBe("info");
    const { tools } = await seeded.listTools();
    const echo = tools.find((t) => t.name === "echo")!;
    await seeded.callTool(echo, { message: "seeded" });
    expect(metaOf(seededFrames[0])[LOG_LEVEL_META_KEY]).toBe("info");
    await seeded.disconnect();

    // A server setting of "off" seeds not-opted-in: no stamp.
    const offClient = new InspectorClient(
      { type: "streamable-http", url: started.url },
      {
        environment: { transport: createTransportNode },
        versionNegotiation: eraToVersionNegotiation("modern"),
        serverSettings: {
          headers: [],
          metadata: [],
          env: [],
          connectionTimeout: 0,
          requestTimeout: 0,
          taskTtl: 60000,
          maxFetchRequests: 1000,
          roots: [],
          modernLogLevel: "off",
        },
      },
    );
    client = offClient;
    const offFrames = collectToolCallRequests(offClient);
    await offClient.connect();
    expect(offClient.getModernLogLevel()).toBeUndefined();
    const echo2 = (await offClient.listTools()).tools.find(
      (t) => t.name === "echo",
    )!;
    await offClient.callTool(echo2, { message: "off" });
    expect(metaOf(offFrames[0])[LOG_LEVEL_META_KEY]).toBeUndefined();
  });

  // A modern server that actually emits logs: the `send_notification` tool routes
  // through the SDK's request-scoped `ctx.mcpReq.log`, which on the modern leg
  // gates on the per-request `logLevel` opt-in and streams the admitted log on
  // the originating request's SSE response.
  async function startLoggingServer(): Promise<TestServerHttp> {
    const started = createTestServerHttp({
      serverInfo: createTestServerInfo("modern-logging-test", "1.0.0"),
      tools: [createEchoTool(), createSendNotificationTool()],
      logging: true,
      modern: {},
    });
    await started.start();
    server = started;
    return started;
  }

  // Connect a modern client, seeding the per-request log level from a server
  // setting (like the app does). Collect every received `notifications/message`.
  async function connectLoggingClient(
    url: string,
    modernLogLevel: "off" | "debug" | "info" | "warning",
  ): Promise<{ client: InspectorClient; logs: MessageEntry[] }> {
    const connected = new InspectorClient(
      { type: "streamable-http", url },
      {
        environment: { transport: createTransportNode },
        versionNegotiation: eraToVersionNegotiation("modern"),
        serverSettings: {
          headers: [],
          metadata: [],
          env: [],
          connectionTimeout: 0,
          requestTimeout: 0,
          taskTtl: 60000,
          maxFetchRequests: 1000,
          roots: [],
          modernLogLevel,
        },
      },
    );
    const logs: MessageEntry[] = [];
    connected.addEventListener("message", (event) => {
      const entry = event.detail;
      if (
        entry.direction === "notification" &&
        "method" in entry.message &&
        entry.message.method === "notifications/message"
      ) {
        logs.push(entry);
      }
    });
    await connected.connect();
    client = connected;
    return { client: connected, logs };
  }

  it("delivers a server log over the request stream when opted in (#1629)", async () => {
    const started = await startLoggingServer();
    const { client: connected, logs } = await connectLoggingClient(
      started.url,
      "info",
    );

    const send = (await connected.listTools()).tools.find(
      (t) => t.name === "send_notification",
    )!;
    await connected.callTool(send, {
      message: "modern log delivered",
      level: "warning",
    });

    // The opted-in request's SSE response carried the notifications/message.
    expect(logs).toHaveLength(1);
    const params = (logs[0].message as { params?: Record<string, unknown> })
      .params!;
    expect((params.data as { message: string }).message).toBe(
      "modern log delivered",
    );
    expect(params.level).toBe("warning");
    expect(params.logger).toBe("test-server");
  });

  it("gates the server log when not opted in (setting 'off') (#1629)", async () => {
    const started = await startLoggingServer();
    const { client: connected, logs } = await connectLoggingClient(
      started.url,
      "off",
    );
    expect(connected.getModernLogLevel()).toBeUndefined();

    const send = (await connected.listTools()).tools.find(
      (t) => t.name === "send_notification",
    )!;
    // The tool still returns a result, but with no logLevel opt-in on the
    // request the modern server suppresses the notifications/message (plain
    // JSON response, nothing on an SSE stream).
    const result = await connected.callTool(send, {
      message: "should be gated",
      level: "warning",
    });
    expect(result.success).toBe(true);
    expect(logs).toHaveLength(0);
  });

  it("rejects a legacy client against a strict modern-only server", async () => {
    const started = await startServer({ legacy: "reject" });
    const failing = new InspectorClient(
      { type: "streamable-http", url: started.url },
      {
        environment: { transport: createTransportNode },
        versionNegotiation: eraToVersionNegotiation("legacy"),
      },
    );
    client = failing;
    await expect(failing.connect()).rejects.toThrow();
  });
});
