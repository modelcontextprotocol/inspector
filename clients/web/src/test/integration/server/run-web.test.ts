import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { mockClose, startViteDevServer, startHonoServer } = vi.hoisted(() => {
  const mockClose = vi.fn().mockResolvedValue(undefined);
  return {
    mockClose,
    startViteDevServer: vi.fn().mockResolvedValue({ close: mockClose }),
    startHonoServer: vi.fn().mockResolvedValue({ close: mockClose }),
  };
});

vi.mock("../../../../server/start-vite-dev-server.js", () => ({
  startViteDevServer,
}));

vi.mock("../../../../server/server.js", () => ({
  startHonoServer,
}));

import * as nodeConfig from "../../../../../../core/mcp/node/config.js";
import { runWeb } from "../../../../server/run-web.js";

describe("runWeb", () => {
  let logLines: string[];
  let warnLines: string[];
  let errorLines: string[];
  let originalLog: typeof console.log;
  let originalWarn: typeof console.warn;
  let originalError: typeof console.error;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let exitCode: number | undefined;
  const signalHandlers = new Map<string, () => void>();

  beforeEach(() => {
    startViteDevServer.mockClear();
    startHonoServer.mockClear();
    mockClose.mockClear();
    signalHandlers.clear();
    exitCode = undefined;

    logLines = [];
    warnLines = [];
    errorLines = [];
    originalLog = console.log;
    originalWarn = console.warn;
    originalError = console.error;
    console.log = (...args: unknown[]) => {
      logLines.push(args.map(String).join(" "));
    };
    console.warn = (...args: unknown[]) => {
      warnLines.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      errorLines.push(args.map(String).join(" "));
    };

    vi.spyOn(process, "on").mockImplementation((event, handler) => {
      if (event === "SIGINT" || event === "SIGTERM") {
        signalHandlers.set(event, handler as () => void);
      }
      return process;
    });

    exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      exitCode = Number(code);
      if (code !== 0) {
        throw new Error(`process.exit:${String(code)}`);
      }
      return undefined as never;
    });
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    exitSpy.mockRestore();
    vi.restoreAllMocks();
  });

  async function expectServerStarted(
    starter: typeof startHonoServer | typeof startViteDevServer,
  ) {
    await vi.waitFor(() => expect(starter).toHaveBeenCalledTimes(1));
  }

  it("starts Hono in production mode with no server args", async () => {
    void runWeb(["node", "run-web"]);
    await expectServerStarted(startHonoServer);

    expect(startHonoServer).toHaveBeenCalledWith(
      expect.objectContaining({ initialMcpConfig: null }),
    );
    expect(startHonoServer.mock.calls[0]?.[0]?.staticRoot).toMatch(/dist$/);
    expect(logLines.some((l) => l.includes("Starting MCP inspector..."))).toBe(
      true,
    );
  });

  it("starts Vite when --dev is set", async () => {
    void runWeb(["node", "run-web", "--dev"]);
    await expectServerStarted(startViteDevServer);

    expect(startViteDevServer).toHaveBeenCalledWith(
      expect.objectContaining({ initialMcpConfig: null }),
    );
    expect(logLines.some((l) => l.includes("development mode"))).toBe(true);
  });

  it("resolves an ad-hoc HTTP URL into initialMcpConfig", async () => {
    void runWeb([
      "node",
      "run-web",
      "https://example.com/mcp",
      "--transport",
      "http",
    ]);
    await expectServerStarted(startHonoServer);

    expect(startHonoServer).toHaveBeenCalledWith(
      expect.objectContaining({
        initialMcpConfig: expect.objectContaining({
          type: "streamable-http",
          url: "https://example.com/mcp",
        }),
      }),
    );
  });

  it("appends positional args after -- to the ad-hoc target", async () => {
    void runWeb([
      "node",
      "run-web",
      "--transport",
      "http",
      "--",
      "https://example.com/mcp",
    ]);
    await expectServerStarted(startHonoServer);

    expect(startHonoServer).toHaveBeenCalledWith(
      expect.objectContaining({
        initialMcpConfig: expect.objectContaining({
          url: "https://example.com/mcp",
        }),
      }),
    );
  });

  it("fills stdio cwd when omitted", async () => {
    void runWeb(["node", "run-web", "node", "server.js"]);
    await expectServerStarted(startHonoServer);

    const config = startHonoServer.mock.calls[0]?.[0]?.initialMcpConfig;
    expect(config).toMatchObject({
      type: "stdio",
      command: "node",
      args: ["server.js"],
      cwd: process.cwd(),
    });
  });

  it("warns when --header is passed", async () => {
    void runWeb([
      "node",
      "run-web",
      "https://example.com/mcp",
      "--transport",
      "http",
      "--header",
      "Authorization: Bearer x",
    ]);
    await expectServerStarted(startHonoServer);

    expect(
      warnLines.some((l) => l.includes("Warning: --header is accepted")),
    ).toBe(true);
  });

  it("loads a named server from a config file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-web-test-"));
    const configPath = join(dir, "mcp.json");
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          api: {
            type: "streamable-http",
            url: "https://example.com/mcp",
          },
        },
      }),
    );

    try {
      void runWeb([
        "node",
        "run-web",
        "--config",
        configPath,
        "--server",
        "api",
      ]);
      await expectServerStarted(startHonoServer);

      expect(startHonoServer).toHaveBeenCalledWith(
        expect.objectContaining({
          initialMcpConfig: expect.objectContaining({
            type: "streamable-http",
            url: "https://example.com/mcp",
          }),
        }),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exits when server config resolution fails", async () => {
    await expect(
      runWeb(["node", "run-web", "--config", "/no/such/file.json"]),
    ).rejects.toThrow("process.exit:1");
    expect(errorLines.some((l) => l.startsWith("Error:"))).toBe(true);
    expect(startHonoServer).not.toHaveBeenCalled();
  });

  it("exits when the web server fails to start", async () => {
    startHonoServer.mockRejectedValueOnce(new Error("bind failed"));

    await expect(runWeb(["node", "run-web"])).rejects.toThrow("process.exit:1");
    expect(errorLines.some((l) => l.includes("bind failed"))).toBe(true);
  });

  it("shuts down via SIGINT after a successful start", async () => {
    void runWeb(["node", "run-web"]);
    await expectServerStarted(startHonoServer);

    const shutdown = signalHandlers.get("SIGINT");
    expect(shutdown).toBeDefined();
    expect(signalHandlers.get("SIGTERM")).toBeDefined();
    shutdown!();
    await vi.waitFor(() => expect(mockClose).toHaveBeenCalled());
    await vi.waitFor(() => expect(exitCode).toBe(0));
  });

  it("preserves an existing stdio cwd", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-web-cwd-"));
    const configPath = join(dir, "mcp.json");
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          local: {
            type: "stdio",
            command: "node",
            args: ["server.js"],
            cwd: "/custom/cwd",
          },
        },
      }),
    );

    try {
      void runWeb([
        "node",
        "run-web",
        "--config",
        configPath,
        "--server",
        "local",
      ]);
      await expectServerStarted(startHonoServer);

      expect(
        startHonoServer.mock.calls[0]?.[0]?.initialMcpConfig,
      ).toMatchObject({
        cwd: "/custom/cwd",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("resolves --server-url without a positional target", async () => {
    void runWeb([
      "node",
      "run-web",
      "--server-url",
      "https://example.com/mcp",
      "--transport",
      "http",
    ]);
    await expectServerStarted(startHonoServer);

    expect(startHonoServer).toHaveBeenCalledWith(
      expect.objectContaining({
        initialMcpConfig: expect.objectContaining({
          url: "https://example.com/mcp",
        }),
      }),
    );
  });

  it("exits when resolveServerConfigs returns no entries", async () => {
    vi.spyOn(nodeConfig, "resolveServerConfigs").mockReturnValueOnce([]);

    await expect(
      runWeb([
        "node",
        "run-web",
        "https://example.com/mcp",
        "--transport",
        "http",
      ]),
    ).rejects.toThrow("process.exit:1");
    expect(
      errorLines.some((l) => l.includes("Could not resolve server config")),
    ).toBe(true);
  });
});
