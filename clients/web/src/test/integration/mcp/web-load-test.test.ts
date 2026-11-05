import { afterEach, describe, expect, it } from "vitest";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import type { LoadProgress } from "@inspector/core/cli/handlers/load-test.js";
import {
  createEchoTool,
  createTestServerHttp,
  createTestServerInfo,
  type TestServerHttp,
} from "@modelcontextprotocol/inspector-test-server";
import { runWebLoadTest } from "../../../lib/loadTest";
import {
  buildLoadTestRequest,
  DEFAULT_LOAD_TEST_FORM,
} from "../../../utils/loadTest";

/**
 * The web load panel's path end to end (#2911): the form's values, built into
 * a request, run by the shared `--load` engine over a live `InspectorClient` —
 * the connection the browser holds — against a real server.
 */
describe("web load test over a live connection", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;

  afterEach(async () => {
    try {
      await client?.disconnect();
    } catch {
      // ignore
    }
    client = null;
    try {
      await server?.stop();
    } catch {
      // ignore
    }
    server = null;
  });

  async function connect(): Promise<InspectorClient> {
    const started = createTestServerHttp({
      serverInfo: createTestServerInfo("web-load-test", "1.0.0"),
      tools: [createEchoTool()],
    });
    await started.start();
    server = started;
    const connected = new InspectorClient(
      { type: "streamable-http", url: started.url },
      { environment: { transport: createTransportNode } },
    );
    await connected.connect();
    client = connected;
    return connected;
  }

  it("runs a bounded tool load and summarizes it", async () => {
    const connected = await connect();
    const built = buildLoadTestRequest(
      { ...DEFAULT_LOAD_TEST_FORM, concurrency: 3, requests: 12 },
      { name: "echo", args: { message: "load {{seq}}" }, argsReady: true },
    );
    if (!built.ok) throw new Error(built.error);
    const progress: LoadProgress[] = [];
    const summary = await runWebLoadTest(connected, built.request, {
      signal: new AbortController().signal,
      onProgress: (p) => progress.push(p),
    });
    expect(summary).toMatchObject({
      tool: "echo",
      concurrency: 3,
      requests: 12,
      ok: 12,
      errors: 0,
      errorRate: 0,
    });
    expect(summary.latencyMs?.p50).toBeGreaterThanOrEqual(0);
  });

  it("runs a scenario and stops early when aborted", async () => {
    const connected = await connect();
    const built = buildLoadTestRequest(
      {
        ...DEFAULT_LOAD_TEST_FORM,
        target: "scenario",
        scenarioText:
          '[{"method":"tools/call","tool":"echo","args":{"message":"x"}}]',
        concurrency: 2,
        durationSec: 30,
      },
      undefined,
    );
    if (!built.ok) throw new Error(built.error);
    const controller = new AbortController();
    const summary = await runWebLoadTest(connected, built.request, {
      signal: controller.signal,
      // Stop at the first report, so the 30s window never runs out.
      onProgress: () => controller.abort(),
    });
    expect(summary.stoppedEarly?.reason).toBe("interrupted");
    expect(summary.steps?.[0]?.name).toBe("tools/call echo");
  });
});
