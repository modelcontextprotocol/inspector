import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DaemonServer } from "../src/daemon/server.js";
import type { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import type {
  LoadOptions,
  LoadSummary,
} from "@inspector/core/cli/handlers/load-test.js";
import type { RpcParams } from "../src/daemon/protocol.js";

/**
 * `tools/call --load` inside the daemon (#2744): the `rpc` op hands the run to
 * the shared engine against the connection's live client and returns its
 * summary, and the run ends early when its caller hangs up or its connection
 * drops. The engine itself is covered by the CLI's load-test suite; here it
 * is stubbed so each test controls when the run settles.
 */

const loadMock = vi.hoisted(() => ({
  impl: undefined as unknown as (
    client: unknown,
    args: Record<string, unknown>,
    options: LoadOptions,
    run: { signal?: AbortSignal },
  ) => Promise<LoadSummary>,
}));
vi.mock(
  "@inspector/core/cli/handlers/load-test.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@inspector/core/cli/handlers/load-test.js")
    >()),
    runToolLoad: (...args: Parameters<typeof loadMock.impl>) =>
      loadMock.impl(...args),
  }),
);

const runMethodMock = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@inspector/core/cli/handlers/run-method.js", () => ({
  runMethod: async () => {
    runMethodMock.calls++;
    return { kind: "result", result: {} };
  },
}));

const SUMMARY: LoadSummary = {
  tool: "echo",
  concurrency: 2,
  requestLimit: 4,
  requests: 4,
  ok: 4,
  toolErrors: 0,
  errors: 0,
  errorRate: 0,
  elapsedMs: 10,
  throughput: 400,
  latencyMs: { min: 1, mean: 2, p50: 2, p90: 3, p99: 3, max: 3 },
  errorMessages: [],
};

const LOAD: LoadOptions = { concurrency: 2, requests: 4 };

function fakeClient(status = "connected") {
  const target = new EventTarget();
  let ambient: AbortSignal | undefined;
  const client = {
    addEventListener: (type: string, listener: EventListener) =>
      target.addEventListener(type, listener),
    removeEventListener: (type: string, listener: EventListener) =>
      target.removeEventListener(type, listener),
    getStatus: () => status,
    cancelToolCall: () => false,
    setAmbientRequestSignal: (signal: AbortSignal | undefined) => {
      ambient = signal;
      return () => {
        ambient = undefined;
      };
    },
  } as unknown as InspectorClient;
  return {
    client,
    ambient: () => ambient,
    emitStatus: (detail: string) =>
      target.dispatchEvent(new CustomEvent("statusChange", { detail })),
  };
}

describe("daemon rpc with --load", () => {
  let dir: string;
  let server: DaemonServer;
  let fake: ReturnType<typeof fakeClient>;

  function useClient(status?: string) {
    fake = fakeClient(status);
    const registry = server.registry as unknown as Record<string, unknown>;
    registry.connectionFor = () => ({ name: "srv", client: fake.client });
    registry.liveClientFor = async () => fake.client;
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-load-"));
    server = new DaemonServer({ dir, idleMs: 0 });
    runMethodMock.calls = 0;
    useClient();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function rpc(params: Partial<RpcParams>, signal?: AbortSignal) {
    return server.handle(
      {
        id: "r1",
        op: "rpc",
        params: {
          method: "tools/call",
          name: "srv",
          toolName: "echo",
          load: LOAD,
          ...params,
        },
      },
      undefined,
      signal,
    );
  }

  /** Start a run that settles only when its signal aborts. */
  function runUntilAborted(): Promise<AbortSignal> {
    return new Promise((started) => {
      loadMock.impl = (_client, _args, _options, run) => {
        started(run.signal!);
        return new Promise((resolve) => {
          run.signal!.addEventListener("abort", () =>
            resolve({ ...SUMMARY, requests: 1 }),
          );
        });
      };
    });
  }

  it("runs the engine on the live client and returns its summary", async () => {
    let seen: { args: Record<string, unknown>; options: LoadOptions } | null =
      null;
    loadMock.impl = async (client, args, options, run) => {
      expect(client).toBe(fake.client);
      // The run's own signal is the ambient one, so in-flight calls abort too.
      expect(fake.ambient()).toBe(run.signal);
      seen = { args, options };
      return SUMMARY;
    };
    const response = await rpc({ interactive: true });
    expect(response).toEqual({
      id: "r1",
      ok: true,
      result: { kind: "load", summary: SUMMARY },
    });
    expect(seen!.options).toEqual(LOAD);
    // Routing fields stay daemon-side; only method arguments reach the engine.
    expect(seen!.args).toEqual({ method: "tools/call", toolName: "echo" });
    expect(fake.ambient()).toBeUndefined();
    expect(runMethodMock.calls).toBe(0);
  });

  it("runs rather than parks for a non-interactive caller", async () => {
    loadMock.impl = async () => SUMMARY;
    const response = await rpc({ interactive: false });
    expect(response.ok && response.result).toEqual({
      kind: "load",
      summary: SUMMARY,
    });
  });

  it("ends the run when the caller hangs up", async () => {
    const abort = new AbortController();
    const started = runUntilAborted();
    const call = rpc({}, abort.signal);
    const runSignal = await started;
    expect(runSignal.aborted).toBe(false);
    abort.abort();
    expect(runSignal.aborted).toBe(true);
    const response = await call;
    expect(response.ok && response.result).toMatchObject({
      kind: "load",
      summary: { requests: 1 },
    });
  });

  it("ends the run when the connection drops, not on other transitions", async () => {
    const started = runUntilAborted();
    const call = rpc({});
    const runSignal = await started;
    fake.emitStatus("connecting");
    expect(runSignal.aborted).toBe(false);
    fake.emitStatus("disconnected");
    expect(runSignal.aborted).toBe(true);
    expect((await call).ok).toBe(true);
  });

  it("refuses a connection that is already down", async () => {
    useClient("error");
    loadMock.impl = async () => SUMMARY;
    const response = await rpc({});
    expect(response.ok).toBe(false);
    expect(!response.ok && response.error.code).toBe("connection_stale");
  });

  it("refuses --load on any method but tools/call", async () => {
    const response = await rpc({ method: "tools/list" });
    expect(response.ok).toBe(false);
    expect(!response.ok && response.error.code).toBe("invalid_params");
  });

  it("leaves an ordinary tools/call on runMethod", async () => {
    const response = await rpc({ load: undefined });
    expect(response.ok && response.result).toEqual({
      kind: "result",
      result: {},
      appInfo: undefined,
    });
    expect(runMethodMock.calls).toBe(1);
  });
});
