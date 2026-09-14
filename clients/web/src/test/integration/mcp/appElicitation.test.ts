import { describe, it, expect, afterEach, vi } from "vitest";
import type { ElicitResult } from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { eraToVersionNegotiation } from "@inspector/core/mcp/types.js";
import type { AppElicitationRequest } from "@inspector/core/mcp/appElicitation.js";
import {
  APP_ELICITATION_URI,
  createAppElicitationResource,
  createAppElicitationTool,
  createMrtrAppElicitationTool,
  createTestServerHttp,
  createTestServerInfo,
  type TestServerHttp,
} from "@modelcontextprotocol/inspector-test-server";

/**
 * Live coverage of app-rendered form elicitations (#1854) against the public
 * fixture, over a real transport.
 *
 * The unit tests drive the handler with a hand-written frame; this drives the
 * real `app_choose_option` tool on the real composable server, so the whole
 * path is exercised: the server's `_meta.ui.resourceUri`, its advertised
 * `io.modelcontextprotocol/ui.elicitation` capability, the SDK's own
 * `elicitInput` serialization (which is where a dropped `_meta` would hide),
 * and the Inspector's routing decision.
 *
 * The renderer stands in for the web client's sandbox — everything above it is
 * production code.
 */
describe("app-rendered elicitation, live server (#1854)", () => {
  let client: InspectorClient | null = null;
  const servers: TestServerHttp[] = [];

  afterEach(async () => {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // ignore
      }
      client = null;
    }
    while (servers.length) {
      try {
        await servers.pop()?.stop();
      } catch {
        // ignore
      }
    }
  });

  /**
   * The fixture server. `appElicitation` is the server half of the
   * negotiation; omitting it is the "not negotiated" scenario.
   */
  async function startServer(appElicitation: boolean): Promise<TestServerHttp> {
    const started = createTestServerHttp({
      serverInfo: createTestServerInfo("app-elicit-test", "1.0.0"),
      tools: [createAppElicitationTool()],
      resources: [createAppElicitationResource()],
      ...(appElicitation && { appElicitation }),
    });
    await started.start();
    servers.push(started);
    return started;
  }

  /** The fixture tool definition, as the server reports it in `tools/list`. */
  async function appTool(connected: InspectorClient) {
    const { tools } = await connected.listTools();
    const tool = tools.find((t) => t.name === "app_choose_option");
    if (!tool) throw new Error("app_choose_option missing from tools/list");
    return tool;
  }

  /** The modern MRTR fixture tool, as the server reports it. */
  async function mrtrTool(connected: InspectorClient) {
    const { tools } = await connected.listTools();
    const tool = tools.find((t) => t.name === "mrtr_app_choose_option");
    if (!tool)
      throw new Error("mrtr_app_choose_option missing from tools/list");
    return tool;
  }

  async function connect(
    url: string,
    renderer?: (request: AppElicitationRequest) => Promise<ElicitResult>,
  ): Promise<InspectorClient> {
    const connected = new InspectorClient(
      { type: "streamable-http", url },
      {
        environment: { transport: createTransportNode },
        elicit: { form: true },
        ...(renderer && { appElicitation: renderer }),
      },
    );
    await connected.connect();
    client = connected;
    return connected;
  }

  it("routes the server's elicitation to the app and returns its result", async () => {
    const started = await startServer(true);
    const seen: AppElicitationRequest[] = [];
    const connected = await connect(started.url, async (request) => {
      seen.push(request);
      return { action: "accept", content: { choice: "option-a" } };
    });

    const result = await connected.callTool(await appTool(connected), {
      prompt: "Choose option A or B.",
    });

    // The tool echoes the ElicitResult it received, so this asserts the app's
    // standard result reached the SERVER — not merely the host.
    const text = JSON.stringify(result.result?.content);
    expect(text).toContain('\\"action\\":\\"accept\\"');
    expect(text).toContain("option-a");

    expect(seen).toHaveLength(1);
    // The URI the SERVER named, carried on the request's own `_meta`.
    expect(seen[0].resourceUri).toBe(APP_ELICITATION_URI);
    expect(seen[0].params.message).toBe("Choose option A or B.");
    // The native queue never opened.
    expect(connected.getPendingElicitations()).toHaveLength(0);
  });

  it("returns an app decline to the server without opening the native UI", async () => {
    const started = await startServer(true);
    const connected = await connect(started.url, async () => ({
      action: "decline",
    }));
    const result = await connected.callTool(await appTool(connected), {});
    expect(JSON.stringify(result.result?.content)).toContain("decline");
    expect(connected.getPendingElicitations()).toHaveLength(0);
  });

  it("falls back to the native UI when the server did not advertise the capability", async () => {
    // Same tool, same `_meta.ui.resourceUri` — only the server's advertisement
    // differs. This is the over-claiming failure mode: a client that renders an
    // app here would strand every user of a server that never opted in.
    const started = await startServer(false);
    let rendererCalls = 0;
    const connected = await connect(started.url, async () => {
      rendererCalls++;
      return { action: "cancel" };
    });

    const tool = await appTool(connected);
    const call = connected.callTool(tool, {});
    await vi.waitFor(() =>
      expect(connected.getPendingElicitations()).toHaveLength(1),
    );
    await connected
      .getPendingElicitations()[0]
      .respond({ action: "accept", content: { choice: "option-b" } });

    const result = await call;
    expect(JSON.stringify(result.result?.content)).toContain("option-b");
    expect(rendererCalls).toBe(0);
  });

  /**
   * The modern (2026-07-28) leg, where an elicitation reaches the client as an
   * `input_required` result the MRTR driver unpacks — not as a server→client
   * request. Stateless per request, hence a separate server.
   */
  async function startModernServer(): Promise<TestServerHttp> {
    const started = createTestServerHttp({
      serverInfo: createTestServerInfo("app-elicit-mrtr", "1.0.0"),
      tools: [createMrtrAppElicitationTool()],
      resources: [createAppElicitationResource()],
      appElicitation: true,
      modern: {},
    });
    await started.start();
    servers.push(started);
    return started;
  }

  async function connectModern(
    url: string,
    renderer?: (request: AppElicitationRequest) => Promise<ElicitResult>,
  ): Promise<InspectorClient> {
    const connected = new InspectorClient(
      { type: "streamable-http", url },
      {
        environment: { transport: createTransportNode },
        elicit: { form: true },
        versionNegotiation: eraToVersionNegotiation("modern"),
        ...(renderer && { appElicitation: renderer }),
      },
    );
    await connected.connect();
    client = connected;
    return connected;
  }

  describe("modern MRTR input_required", () => {
    it("routes an embedded elicitation to the app and retries with its result", async () => {
      // The other half of the contract: the same routing decision has to hold
      // on a leg where the elicitation never arrives as a request at all.
      const started = await startModernServer();
      const seen: AppElicitationRequest[] = [];
      const connected = await connectModern(started.url, async (request) => {
        seen.push(request);
        return { action: "accept", content: { choice: "option-b" } };
      });

      const tool = await mrtrTool(connected);
      const result = await connected.callTool(tool, {
        prompt: "Choose option A or B.",
      });

      expect(seen).toHaveLength(1);
      expect(seen[0].resourceUri).toBe(APP_ELICITATION_URI);
      // The retry carried the app's answer as `inputResponses`, and the server
      // echoed it — so the app's result completed the ORIGINAL tool call.
      expect(JSON.stringify(result.result?.content)).toContain("option-b");
      expect(connected.getPendingElicitations()).toHaveLength(0);
    });

    it("aborts the app when the tool call it belongs to is cancelled", async () => {
      // MRTR passes the call's signal down; without it a cancelled tool call
      // would leave the app's modal open with nothing left to answer.
      const started = await startModernServer();
      let rendering = false;
      let aborted = false;
      const connected = await connectModern(
        started.url,
        (request) =>
          new Promise<ElicitResult>((_resolve, reject) => {
            rendering = true;
            request.signal.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("aborted"));
            });
          }),
      );

      const tool = await mrtrTool(connected);
      const call = connected.callTool(tool, {}).catch((err: unknown) => err);
      // Cancel only once the app is actually up: cancelling earlier is a
      // different case (the signal is already aborted and no app is mounted).
      await vi.waitFor(() => expect(rendering).toBe(true));
      expect(connected.cancelToolCall()).toBe(true);
      await vi.waitFor(() => expect(aborted).toBe(true));
      await call;
    });

    it("falls back to the native UI when the modern server did not advertise it", async () => {
      const started = createTestServerHttp({
        serverInfo: createTestServerInfo("app-elicit-mrtr-native", "1.0.0"),
        tools: [createMrtrAppElicitationTool()],
        resources: [createAppElicitationResource()],
        modern: {},
      });
      await started.start();
      servers.push(started);

      let rendererCalls = 0;
      const connected = await connectModern(started.url, async () => {
        rendererCalls++;
        return { action: "cancel" };
      });
      const tool = await mrtrTool(connected);
      const call = connected.callTool(tool, {});
      await vi.waitFor(() =>
        expect(connected.getPendingElicitations()).toHaveLength(1),
      );
      await connected
        .getPendingElicitations()[0]
        .respond({ action: "accept", content: { choice: "option-a" } });
      const result = await call;
      expect(JSON.stringify(result.result?.content)).toContain("option-a");
      expect(rendererCalls).toBe(0);
    });
  });

  it("falls back when the client cannot host an app (no renderer)", async () => {
    // The CLI/TUI shape: the server offers an app, the client never advertised
    // the nested capability, so the server's request is answered natively.
    const started = await startServer(true);
    const connected = await connect(started.url);
    const tool = await appTool(connected);
    const call = connected.callTool(tool, {});
    await vi.waitFor(() =>
      expect(connected.getPendingElicitations()).toHaveLength(1),
    );
    await connected
      .getPendingElicitations()[0]
      .respond({ action: "accept", content: { choice: "option-a" } });
    await expect(call).resolves.toBeDefined();
  });
});
