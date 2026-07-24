import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const callDaemon = vi.fn();
const ensureDaemon = vi.fn();
const streamDaemon = vi.fn();

vi.mock("../src/daemon/index.js", () => ({
  callDaemon: (...args: unknown[]) => callDaemon(...args),
  ensureDaemon: (...args: unknown[]) => ensureDaemon(...args),
  streamDaemon: (...args: unknown[]) => streamDaemon(...args),
}));

describe("dispatchSessionRpc", () => {
  let stdout: string;
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    stdout = "";
    originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      stdout += typeof chunk === "string" ? chunk : String(chunk);
      const cb = rest.find((r) => typeof r === "function") as
        | (() => void)
        | undefined;
      cb?.();
      return true;
    }) as typeof process.stdout.write;
    ensureDaemon.mockResolvedValue({ socketPath: "/tmp/t.sock" });
    callDaemon.mockReset();
    streamDaemon.mockReset();
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it("writes pretty JSON for --format json", async () => {
    callDaemon.mockResolvedValue({
      kind: "result",
      result: { tools: [] },
    });
    const { dispatchSessionRpc } = await import("../src/session/dispatch.js");
    await dispatchSessionRpc(
      "tools/list",
      {},
      { format: "json", requireExplicit: false },
    );
    expect(JSON.parse(stdout.trim())).toEqual({ tools: [] });
    expect(stdout).toContain("\n");
  });

  it("writes human text for tools/list by default", async () => {
    callDaemon.mockResolvedValue({
      kind: "result",
      result: {
        tools: [{ name: "echo", description: "Echo", inputSchema: {} }],
      },
    });
    const { dispatchSessionRpc } = await import("../src/session/dispatch.js");
    await dispatchSessionRpc("tools/list", {}, { requireExplicit: false });
    expect(stdout).toContain("Tools (1):");
    expect(stdout).toContain("`echo");
  });

  it("writes human app-info list for ndjson outcomes", async () => {
    callDaemon.mockResolvedValue({
      kind: "ndjson",
      lines: [{ hasApp: false, toolName: "a" }],
    });
    const { dispatchSessionRpc } = await import("../src/session/dispatch.js");
    await dispatchSessionRpc(
      "tools/list",
      { appInfo: true },
      { requireExplicit: false },
    );
    expect(stdout).toContain("App info");
    expect(stdout).toContain("`a`");
  });

  it("opens a stream for logging/tail and wires SIGINT abort", async () => {
    streamDaemon.mockImplementation(
      async (
        _params: unknown,
        opts: { onData: (d: unknown) => void; signal?: AbortSignal },
      ) => {
        opts.onData({
          type: "subscribed",
          uri: "test://x",
        });
        process.emit("SIGINT");
        expect(opts.signal?.aborted).toBe(true);
      },
    );
    const { dispatchSessionRpc } = await import("../src/session/dispatch.js");
    await dispatchSessionRpc(
      "logging/tail",
      {},
      { requireExplicit: false, session: "@s" },
    );
    expect(stdout).toContain("Subscribed:");
    expect(streamDaemon).toHaveBeenCalled();
  });
});

describe("hoistAtSession / stripAt / requireExplicitSession", () => {
  it("stripAt removes leading @", async () => {
    const { stripAt, requireExplicitSession } =
      await import("../src/session/dispatch.js");
    expect(stripAt("@x")).toBe("x");
    expect(stripAt(undefined)).toBeUndefined();
    const prev = process.env.MCP_ALLOW_DEFAULT_SESSION;
    process.env.MCP_ALLOW_DEFAULT_SESSION = "1";
    expect(requireExplicitSession()).toBe(false);
    if (prev === undefined) delete process.env.MCP_ALLOW_DEFAULT_SESSION;
    else process.env.MCP_ALLOW_DEFAULT_SESSION = prev;
  });

  it("requireExplicitSession is false on a TTY when allow-default is unset", async () => {
    const { requireExplicitSession } =
      await import("../src/session/dispatch.js");
    const prevEnv = process.env.MCP_ALLOW_DEFAULT_SESSION;
    delete process.env.MCP_ALLOW_DEFAULT_SESSION;
    const desc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    try {
      expect(requireExplicitSession()).toBe(false);
    } finally {
      if (desc) Object.defineProperty(process.stdout, "isTTY", desc);
      else
        Object.defineProperty(process.stdout, "isTTY", {
          configurable: true,
          value: undefined,
        });
      if (prevEnv === undefined) delete process.env.MCP_ALLOW_DEFAULT_SESSION;
      else process.env.MCP_ALLOW_DEFAULT_SESSION = prevEnv;
    }
  });
});
