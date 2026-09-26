import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const callDaemon = vi.fn();
const ensureDaemon = vi.fn();
const streamDaemon = vi.fn();
const promptElicitation = vi.fn();

vi.mock("../src/daemon/index.js", () => ({
  callDaemon: (...args: unknown[]) => callDaemon(...args),
  ensureDaemon: (...args: unknown[]) => ensureDaemon(...args),
  streamDaemon: (...args: unknown[]) => streamDaemon(...args),
}));

vi.mock("../src/connection/elicitation-prompt.js", () => ({
  promptElicitation: (...args: unknown[]) => promptElicitation(...args),
}));

// Pass-through wrapper so tests can delay writes and observe completion
// order (the stream path must flush queued writes before returning).
const writeDelayMs = { value: 0 };
const writeReject = { value: false };
const writeCompletions: unknown[] = [];
vi.mock("../src/connection/format-connection.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../src/connection/format-connection.js")
    >();
  return {
    ...actual,
    writeConnectionOutput: async (...args: unknown[]) => {
      if (writeReject.value) throw new Error("stdout write failed");
      if (writeDelayMs.value > 0) {
        await new Promise((r) => setTimeout(r, writeDelayMs.value));
      }
      await (
        actual.writeConnectionOutput as (...a: unknown[]) => Promise<void>
      )(...args);
      writeCompletions.push(args[1]);
    },
  };
});

describe("dispatchConnectionRpc", () => {
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
    promptElicitation.mockReset();
    writeDelayMs.value = 0;
    writeReject.value = false;
    writeCompletions.length = 0;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it("writes pretty JSON for --format json", async () => {
    callDaemon.mockResolvedValue({
      kind: "result",
      result: { tools: [] },
    });
    const { dispatchConnectionRpc } =
      await import("../src/connection/dispatch.js");
    await dispatchConnectionRpc(
      "tools/list",
      {},
      { format: "json", requireExplicit: false },
    );
    expect(JSON.parse(stdout.trim())).toEqual({ tools: [] });
    expect(stdout).toContain("\n");
  });

  it("omits format from the daemon rpc params (frontend-only concern)", async () => {
    callDaemon.mockResolvedValue({ kind: "result", result: {} });
    const { dispatchConnectionRpc } =
      await import("../src/connection/dispatch.js");
    await dispatchConnectionRpc(
      "tools/call",
      { toolName: "echo" },
      { format: "json", requireExplicit: false },
    );
    const [op, params] = callDaemon.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(op).toBe("rpc");
    // Forwarding format would make the daemon's runMethod issue a hidden
    // app-info resources/read for JSON tool calls.
    expect("format" in params).toBe(false);
    expect(params).toMatchObject({ method: "tools/call", toolName: "echo" });
  });

  it("writes human text for tools/list by default", async () => {
    callDaemon.mockResolvedValue({
      kind: "result",
      result: {
        tools: [{ name: "echo", description: "Echo", inputSchema: {} }],
      },
    });
    const { dispatchConnectionRpc } =
      await import("../src/connection/dispatch.js");
    await dispatchConnectionRpc("tools/list", {}, { requireExplicit: false });
    expect(stdout).toContain("Tools (1):");
    expect(stdout).toContain("`echo");
  });

  it("writes human app-info list for ndjson outcomes", async () => {
    callDaemon.mockResolvedValue({
      kind: "ndjson",
      lines: [{ hasApp: false, toolName: "a" }],
    });
    const { dispatchConnectionRpc } =
      await import("../src/connection/dispatch.js");
    await dispatchConnectionRpc(
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
    const { dispatchConnectionRpc } =
      await import("../src/connection/dispatch.js");
    await dispatchConnectionRpc(
      "logging/tail",
      {},
      { requireExplicit: false, connection: "@s" },
    );
    expect(stdout).toContain("Subscribed:");
    expect(streamDaemon).toHaveBeenCalled();
  });

  it("flushes queued stream writes before returning", async () => {
    // Regression: stream writes were fire-and-forget, so mcp-bin's
    // process.exit() right after dispatch resolved could truncate the final
    // event when stdout is piped or backpressured.
    writeDelayMs.value = 10;
    streamDaemon.mockImplementation(
      async (_params: unknown, opts: { onData: (d: unknown) => void }) => {
        opts.onData({ type: "subscribed", uri: "test://one" });
        opts.onData({ type: "subscribed", uri: "test://two" });
      },
    );
    const { dispatchConnectionRpc } =
      await import("../src/connection/dispatch.js");
    await dispatchConnectionRpc(
      "logging/tail",
      {},
      { requireExplicit: false, connection: "@s" },
    );
    expect(writeCompletions.length).toBe(2);
    expect(stdout).toContain("test://two");
  });

  it("recovers the write chain after a failed write and keeps streaming", async () => {
    // Regression: one rejected write left the chain permanently rejected, so
    // every later frame's `.then` was skipped and the stream went silent.
    writeReject.value = true;
    streamDaemon.mockImplementation(
      async (
        _params: unknown,
        opts: { onData: (d: unknown) => void | Promise<void> },
      ) => {
        await opts.onData({ type: "subscribed", uri: "test://failed" });
        writeReject.value = false;
        await opts.onData({ type: "subscribed", uri: "test://recovered" });
      },
    );
    const { dispatchConnectionRpc } =
      await import("../src/connection/dispatch.js");
    await dispatchConnectionRpc(
      "logging/tail",
      {},
      { requireExplicit: false, connection: "@s" },
    );
    expect(stdout).not.toContain("test://failed");
    expect(stdout).toContain("test://recovered");
  });

  it("keeps stream write failures non-fatal, as when they were fire-and-forget", async () => {
    writeReject.value = true;
    streamDaemon.mockImplementation(
      async (_params: unknown, opts: { onData: (d: unknown) => void }) => {
        opts.onData({ type: "subscribed", uri: "test://x" });
        opts.onData({ type: "subscribed", uri: "test://y" });
      },
    );
    const { dispatchConnectionRpc } =
      await import("../src/connection/dispatch.js");
    await expect(
      dispatchConnectionRpc(
        "logging/tail",
        {},
        { requireExplicit: false, connection: "@s" },
      ),
    ).resolves.toBeUndefined();
  });

  it("wires SIGINT/SIGTERM abort for the general rpc path (not just streams)", async () => {
    callDaemon.mockImplementation(
      async (_op: string, _params: unknown, opts: { signal?: AbortSignal }) => {
        process.emit("SIGTERM");
        expect(opts.signal?.aborted).toBe(true);
        return { kind: "result", result: {} };
      },
    );
    const { dispatchConnectionRpc } =
      await import("../src/connection/dispatch.js");
    await dispatchConnectionRpc(
      "tools/call",
      {},
      { format: "json", requireExplicit: false },
    );
    expect(callDaemon).toHaveBeenCalled();
  });

  it("removes the SIGINT/SIGTERM listeners after the rpc call settles", async () => {
    callDaemon.mockResolvedValue({ kind: "result", result: {} });
    const before = process.listenerCount("SIGINT");
    const { dispatchConnectionRpc } =
      await import("../src/connection/dispatch.js");
    await dispatchConnectionRpc(
      "tools/call",
      {},
      { format: "json", requireExplicit: false },
    );
    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  it("wires onElicitation as interactive when text format + TTY stdin/stdout", async () => {
    callDaemon.mockResolvedValue({ kind: "result", result: {} });
    const stdinDesc = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdoutDesc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    try {
      const { dispatchConnectionRpc } =
        await import("../src/connection/dispatch.js");
      await dispatchConnectionRpc(
        "tools/call",
        {},
        { format: "text", requireExplicit: false },
      );
      const opts = callDaemon.mock.calls[0][2] as {
        onElicitation: (frame: unknown) => unknown;
      };
      expect(opts.onElicitation).toBeInstanceOf(Function);
      promptElicitation.mockResolvedValue({ action: "cancel" });
      await opts.onElicitation({ id: "x" });
      expect(promptElicitation).toHaveBeenCalledWith(
        { id: "x" },
        expect.objectContaining({ interactive: true }),
      );
    } finally {
      if (stdinDesc) Object.defineProperty(process.stdin, "isTTY", stdinDesc);
      if (stdoutDesc)
        Object.defineProperty(process.stdout, "isTTY", stdoutDesc);
    }
  });

  it("wires onElicitation as non-interactive for --format json", async () => {
    callDaemon.mockResolvedValue({ kind: "result", result: {} });
    const { dispatchConnectionRpc } =
      await import("../src/connection/dispatch.js");
    await dispatchConnectionRpc(
      "tools/call",
      {},
      { format: "json", requireExplicit: false },
    );
    const opts = callDaemon.mock.calls[0][2] as {
      onElicitation: (frame: unknown) => unknown;
    };
    promptElicitation.mockResolvedValue({ action: "cancel" });
    await opts.onElicitation({ id: "x" });
    expect(promptElicitation).toHaveBeenCalledWith(
      { id: "x" },
      expect.objectContaining({ interactive: false }),
    );
  });
});

describe("hoistAtConnection / stripAt / requireExplicitConnection", () => {
  it("stripAt removes leading @", async () => {
    const { stripAt, requireExplicitConnection } =
      await import("../src/connection/dispatch.js");
    expect(stripAt("@x")).toBe("x");
    expect(stripAt(undefined)).toBeUndefined();
    const prev = process.env.MCP_ALLOW_DEFAULT_CONNECTION;
    process.env.MCP_ALLOW_DEFAULT_CONNECTION = "1";
    expect(requireExplicitConnection()).toBe(false);
    if (prev === undefined) delete process.env.MCP_ALLOW_DEFAULT_CONNECTION;
    else process.env.MCP_ALLOW_DEFAULT_CONNECTION = prev;
  });

  it("requireExplicitConnection keys off stdin TTY (piping stdout still OK)", async () => {
    const { requireExplicitConnection } =
      await import("../src/connection/dispatch.js");
    const prevEnv = process.env.MCP_ALLOW_DEFAULT_CONNECTION;
    delete process.env.MCP_ALLOW_DEFAULT_CONNECTION;
    const stdinDesc = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdoutDesc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    try {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: true,
      });
      Object.defineProperty(process.stdout, "isTTY", {
        configurable: true,
        value: false,
      });
      expect(requireExplicitConnection()).toBe(false);

      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: false,
      });
      expect(requireExplicitConnection()).toBe(true);
    } finally {
      if (stdinDesc) Object.defineProperty(process.stdin, "isTTY", stdinDesc);
      else
        Object.defineProperty(process.stdin, "isTTY", {
          configurable: true,
          value: undefined,
        });
      if (stdoutDesc)
        Object.defineProperty(process.stdout, "isTTY", stdoutDesc);
      else
        Object.defineProperty(process.stdout, "isTTY", {
          configurable: true,
          value: undefined,
        });
      if (prevEnv === undefined)
        delete process.env.MCP_ALLOW_DEFAULT_CONNECTION;
      else process.env.MCP_ALLOW_DEFAULT_CONNECTION = prevEnv;
    }
  });
});
