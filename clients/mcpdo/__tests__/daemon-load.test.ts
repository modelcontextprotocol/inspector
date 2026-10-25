import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createEchoTool,
  createTestServerHttp,
  createTestServerInfo,
} from "@modelcontextprotocol/inspector-test-server";
import { DaemonServer } from "../src/daemon/server.js";
import { ConnectionRegistry } from "../src/daemon/connections.js";
import type { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { InspectorClientEventTarget } from "@inspector/core/mcp/inspectorClientEventTarget.js";
import type { ConnectionStatus } from "@inspector/core/mcp/types.js";
import type {
  LoadOptions,
  LoadSummary,
} from "@inspector/core/cli/handlers/load-test.js";
import type { RpcParams } from "../src/daemon/protocol.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";

/**
 * `tools/call --load` inside the daemon (#2744): the `rpc` op hands the run to
 * the shared engine against the connection's live client and returns its
 * summary, and the run ends early when its caller hangs up or its connection
 * drops. The engine itself is covered by the CLI's load-test suite; here it
 * is stubbed so each test controls when the run settles.
 */

type LoadImpl = (
  client: unknown,
  args: Record<string, unknown>,
  options: LoadOptions,
  run: {
    signal?: AbortSignal;
    openConnection?: () => Promise<InspectorClient>;
  },
) => Promise<LoadSummary>;

const loadMock = vi.hoisted(() => {
  const state: { impl: LoadImpl } = {
    // A test that forgets to set `impl` fails here, by name.
    impl: async () => {
      throw new Error("runToolLoad mock not configured");
    },
  };
  return state;
});
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

/**
 * Observes the daemon's OAuth storage handling (#2800) without changing it:
 * the real reset runs behind a spy, and the real class is counted.
 */
const oauthStorageMock = vi.hoisted(() => ({
  constructed: 0,
  reset: vi.fn(),
}));
vi.mock("@inspector/core/auth/node/storage-node.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@inspector/core/auth/node/storage-node.js")
    >();
  oauthStorageMock.reset.mockImplementation(actual.resetNodeOAuthStorageCache);
  return { ...actual, resetNodeOAuthStorageCache: oauthStorageMock.reset };
});
vi.mock("@inspector/core/auth/node/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@inspector/core/auth/node/index.js")>();
  class CountedNodeOAuthStorage extends actual.NodeOAuthStorage {
    constructor(
      ...args: ConstructorParameters<typeof actual.NodeOAuthStorage>
    ) {
      super(...args);
      oauthStorageMock.constructed++;
    }
  }
  return { ...actual, NodeOAuthStorage: CountedNodeOAuthStorage };
});

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

/**
 * The slice of `InspectorClient` the load path touches, on the real event
 * target so `statusChange` is dispatched exactly as the client does it.
 * `implements` checks each method against the client's own signature.
 */
class FakeLoadClient
  extends InspectorClientEventTarget
  implements
    Pick<
      InspectorClient,
      "getStatus" | "cancelToolCall" | "setAmbientRequestSignal" | "disconnect"
    >
{
  ambient: AbortSignal | undefined;

  constructor(private readonly status: ConnectionStatus) {
    super();
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  cancelToolCall(): boolean {
    return false;
  }

  setAmbientRequestSignal(signal: AbortSignal | undefined): () => void {
    this.ambient = signal;
    return () => {
      this.ambient = undefined;
    };
  }

  async disconnect(): Promise<void> {}
}

function fakeClient(status: ConnectionStatus = "connected") {
  const fake = new FakeLoadClient(status);
  return {
    // The daemon is typed against the concrete `InspectorClient` class, whose
    // private members no test double can supply, so no single cast relates
    // the two. The double is sufficient because the load path calls only the
    // methods `FakeLoadClient` implements (checked above) plus the event
    // target it inherits; `runToolLoad`, which needs the rest, is mocked.
    client: fake as unknown as InspectorClient,
    ambient: () => fake.ambient,
    emitStatus: (detail: ConnectionStatus) =>
      fake.dispatchTypedEvent("statusChange", detail),
  };
}

describe("daemon rpc with --load", () => {
  let dir: string;
  let server: DaemonServer;
  let fake: ReturnType<typeof fakeClient>;

  // Only `liveClientFor` needs replacing: a load run never parks, and the
  // ordinary call below sends no `interactive`, so neither path resolves a
  // connection name through `connectionFor`.
  function useClient(status?: ConnectionStatus) {
    fake = fakeClient(status);
    vi.spyOn(server.registry, "liveClientFor").mockResolvedValue(fake.client);
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

  describe("--load-connections", () => {
    const MULTI: LoadOptions = { concurrency: 2, connections: 2, requests: 4 };

    /** Point the connection at a server config and stub the extra dial. */
    function useConnection(serverConfig: MCPServerConfig) {
      const extra = fakeClient();
      // Only `name` and `serverConfig` are read on this path.
      vi.spyOn(server.registry, "connectionFor").mockReturnValue({
        name: "srv",
        serverConfig,
      } as ReturnType<typeof server.registry.connectionFor>);
      const open = vi
        .spyOn(server.registry, "openLoadClient")
        .mockResolvedValue(extra.client);
      const release = vi.spyOn(server.registry, "releaseLoadClient");
      return { extra, open, release };
    }

    it("opens extras through the registry with the run's signal, and releases them", async () => {
      const { extra, open, release } = useConnection({
        type: "streamable-http",
        url: "http://localhost:1/mcp",
      });
      let opened: InspectorClient | undefined;
      loadMock.impl = async (_client, _args, options, run) => {
        expect(options).toEqual(MULTI);
        opened = await run.openConnection!();
        // The caller hanging up aborts the extra's in-flight calls too.
        expect(extra.ambient()).toBe(run.signal);
        return SUMMARY;
      };
      const response = await rpc({ load: MULTI });
      expect(response.ok).toBe(true);
      expect(opened).toBe(extra.client);
      expect(open).toHaveBeenCalledWith(
        {
          serverConfig: {
            type: "streamable-http",
            url: "http://localhost:1/mcp",
          },
        },
        fake.client,
        expect.any(AbortSignal),
      );
      expect(release).toHaveBeenCalledWith(extra.client);
      expect(extra.ambient()).toBeUndefined();
    });

    it("hands the run's signal to the dial, so a stalled handshake cancels", async () => {
      const { open } = useConnection({
        type: "streamable-http",
        url: "http://localhost:1/mcp",
      });
      let runSignal: AbortSignal | undefined;
      loadMock.impl = async (_client, _args, _options, run) => {
        runSignal = run.signal;
        await run.openConnection!();
        return SUMMARY;
      };
      expect((await rpc({ load: MULTI })).ok).toBe(true);
      expect(open.mock.calls[0]![2]).toBe(runSignal);
    });

    it("dials the server the primary was resolved on, even if the default moves while queued", async () => {
      const { open } = useConnection({
        type: "streamable-http",
        url: "http://a.example/mcp",
      });
      // A first run holds the connection's queue until its signal aborts.
      const firstStarted = runUntilAborted();
      const blocker = new AbortController();
      const first = rpc({ load: LOAD }, blocker.signal);
      await firstStarted;
      // The second run resolves its connection now, then waits in the queue.
      const second = rpc({ load: MULTI });
      await vi.waitFor(() =>
        expect(server.registry.liveClientFor).toHaveBeenCalledTimes(2),
      );
      // While it waits, the default connection changes to another server.
      vi.mocked(server.registry.connectionFor).mockReturnValue({
        name: "other",
        serverConfig: { type: "streamable-http", url: "http://b.example/mcp" },
      } as ReturnType<typeof server.registry.connectionFor>);
      loadMock.impl = async (_client, _args, _options, run) => {
        await run.openConnection!();
        return SUMMARY;
      };
      blocker.abort();
      await first;
      expect((await second).ok).toBe(true);
      expect(open).toHaveBeenCalledWith(
        {
          serverConfig: {
            type: "streamable-http",
            url: "http://a.example/mcp",
          },
        },
        fake.client,
        expect.any(AbortSignal),
      );
    });

    it("gives a single-session run no way to open more", async () => {
      const { open } = useConnection({
        type: "streamable-http",
        url: "http://localhost:1/mcp",
      });
      loadMock.impl = async (_client, _args, _options, run) => {
        expect(run.openConnection).toBeUndefined();
        return SUMMARY;
      };
      expect((await rpc({ load: { ...MULTI, connections: 1 } })).ok).toBe(true);
      expect(open).not.toHaveBeenCalled();
    });

    it("refuses more than one session over stdio before the run starts", async () => {
      const { open } = useConnection({ type: "stdio", command: "node" });
      loadMock.impl = async () => SUMMARY;
      const response = await rpc({ load: MULTI });
      expect(response.ok).toBe(false);
      expect(!response.ok && response.error.code).toBe("load_flag_conflict");
      expect(open).not.toHaveBeenCalled();
      // Nothing was set up, so nothing is left behind on the primary.
      expect(fake.ambient()).toBeUndefined();
    });
  });
});

/**
 * The registry side of `--load-connections` (#2800), against a real HTTP
 * server: an extra session is dialed from the connection's stored config,
 * stays out of the connection list, and is closed by a daemon shutdown that
 * lands mid-run.
 */
describe("ConnectionRegistry load sessions", () => {
  let httpServer: ReturnType<typeof createTestServerHttp>;
  let registry: ConnectionRegistry;

  beforeEach(async () => {
    httpServer = createTestServerHttp({
      serverInfo: createTestServerInfo("load-registry", "1.0.0"),
      tools: [createEchoTool()],
    });
    await httpServer.start();
    registry = new ConnectionRegistry(0);
    await registry.connect({
      name: "remote",
      serverConfig: { type: "streamable-http", url: httpServer.url },
      serverIdentity: httpServer.url,
    });
  });

  afterEach(async () => {
    await registry.disconnectAll();
    await httpServer.stop();
  });

  const target = () => ({
    serverConfig: { type: "streamable-http" as const, url: httpServer.url },
  });
  const primary = () => registry.resolve("remote", true).client;

  it("dials a separate, unlisted session that shutdown closes", async () => {
    const extra = await registry.openLoadClient(target(), primary());
    expect(extra).not.toBe(primary());
    expect(extra.getStatus()).toBe("connected");
    expect(registry.list().map((c) => c.name)).toEqual(["remote"]);
    expect(registry.connectionCount()).toBe(1);

    const disconnect = vi.spyOn(extra, "disconnect");
    await registry.disconnectAll();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("shares the primary's OAuth storage instead of a fresh token snapshot", async () => {
    oauthStorageMock.reset.mockClear();
    const constructedBefore = oauthStorageMock.constructed;
    await registry.openLoadClient(target(), primary());
    // A reset would orphan the primary's in-memory tokens, and a new storage
    // would hold its own copy: either way a refresh-token rotation in one
    // session would leave the others with an invalidated token.
    expect(oauthStorageMock.reset).not.toHaveBeenCalled();
    expect(oauthStorageMock.constructed).toBe(constructedBefore);
  });

  it("leaves a released session to its run", async () => {
    const extra = await registry.openLoadClient(target(), primary());
    await extra.disconnect();
    registry.releaseLoadClient(extra);
    const disconnect = vi.spyOn(extra, "disconnect");
    await registry.disconnectAll();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("closes a session whose dial finished after shutdown began", async () => {
    const opening = registry.openLoadClient(target(), primary());
    const outcome = opening.catch((err: unknown) => err);
    await registry.disconnectAll();
    expect(await outcome).toMatchObject({
      envelope: { code: "daemon_stopping" },
    });
  });

  it("refuses to open a session once the daemon is stopping", async () => {
    const client = primary();
    await registry.disconnectAll();
    await expect(
      registry.openLoadClient(target(), client),
    ).rejects.toMatchObject({
      envelope: { code: "daemon_stopping" },
    });
  });

  it("cancels a dial when the run's signal aborts", async () => {
    const stop = new AbortController();
    const opening = registry.openLoadClient(target(), primary(), stop.signal);
    stop.abort();
    await expect(opening).rejects.toThrow();
  });
});
