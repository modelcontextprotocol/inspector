import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
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
  let catalogEnvSnapshot: string | undefined;
  const signalHandlers = new Map<string, () => void>();

  beforeEach(() => {
    startViteDevServer.mockClear();
    startHonoServer.mockClear();
    mockClose.mockClear();
    signalHandlers.clear();
    exitCode = undefined;
    catalogEnvSnapshot = process.env.MCP_CATALOG_PATH;
    delete process.env.MCP_CATALOG_PATH;

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
    if (catalogEnvSnapshot === undefined) {
      delete process.env.MCP_CATALOG_PATH;
    } else {
      process.env.MCP_CATALOG_PATH = catalogEnvSnapshot;
    }
  });

  async function expectServerStarted(
    starter: typeof startHonoServer | typeof startViteDevServer,
  ) {
    await vi.waitFor(() => expect(starter).toHaveBeenCalledTimes(1));
  }

  /** The single entry of a synthesized in-memory ad-hoc catalog. */
  function soleSeededEntry(): Record<string, unknown> {
    const initialServers = startHonoServer.mock.calls[0]?.[0]
      ?.initialServers as {
      mcpServers: Record<string, Record<string, unknown>>;
    } | null;
    expect(initialServers).toBeTruthy();
    const entries = Object.values(initialServers!.mcpServers);
    expect(entries).toHaveLength(1);
    return entries[0]!;
  }

  it("starts Hono in production mode with no server args (writable default catalog)", async () => {
    void runWeb(["node", "run-web"]);
    await expectServerStarted(startHonoServer);

    expect(startHonoServer).toHaveBeenCalledWith(
      expect.objectContaining({
        initialMcpConfig: null,
        mcpConfigPath: undefined,
        writable: true,
        initialServers: null,
      }),
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
      expect.objectContaining({ initialMcpConfig: null, writable: true }),
    );
    expect(logLines.some((l) => l.includes("development mode"))).toBe(true);
  });

  // --- ad-hoc launch → read-only in-memory session ------------------------

  it("seeds an ad-hoc HTTP URL into an in-memory read-only session", async () => {
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
        writable: false,
        mcpConfigPath: undefined,
        initialMcpConfig: expect.objectContaining({
          type: "streamable-http",
          url: "https://example.com/mcp",
        }),
      }),
    );
    expect(soleSeededEntry()).toMatchObject({
      type: "streamable-http",
      url: "https://example.com/mcp",
    });
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

    expect(soleSeededEntry()).toMatchObject({
      url: "https://example.com/mcp",
    });
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

    expect(soleSeededEntry()).toMatchObject({ url: "https://example.com/mcp" });
  });

  it("fills stdio cwd when omitted", async () => {
    void runWeb(["node", "run-web", "node", "server.js"]);
    await expectServerStarted(startHonoServer);

    expect(soleSeededEntry()).toMatchObject({
      type: "stdio",
      command: "node",
      args: ["server.js"],
      cwd: process.cwd(),
    });
  });

  it("preserves an explicit --cwd for an ad-hoc stdio server", async () => {
    void runWeb([
      "node",
      "run-web",
      "--cwd",
      "/custom/cwd",
      "node",
      "server.js",
    ]);
    await expectServerStarted(startHonoServer);

    expect(soleSeededEntry()).toMatchObject({ cwd: "/custom/cwd" });
  });

  it("plumbs --header onto the seeded ad-hoc server (no warning)", async () => {
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

    // No silent no-op warning anymore — the header is applied.
    expect(warnLines.some((l) => l.includes("--header"))).toBe(false);
    expect(soleSeededEntry()).toMatchObject({
      type: "streamable-http",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer x" },
    });
  });

  it("rejects --header for a stdio ad-hoc server", async () => {
    await expect(
      runWeb([
        "node",
        "run-web",
        "node",
        "server.js",
        "--header",
        "Authorization: Bearer x",
      ]),
    ).rejects.toThrow("process.exit:1");
    expect(
      errorLines.some((l) => l.includes("--header only applies to HTTP/SSE")),
    ).toBe(true);
    expect(startHonoServer).not.toHaveBeenCalled();
  });

  it("rejects --header with no ad-hoc server to attach it to", async () => {
    await expect(
      runWeb(["node", "run-web", "--header", "Authorization: Bearer x"]),
    ).rejects.toThrow("process.exit:1");
    expect(
      errorLines.some((l) => l.includes("--header requires an ad-hoc")),
    ).toBe(true);
    expect(startHonoServer).not.toHaveBeenCalled();
  });

  it("exits when an ad-hoc config resolves to no entries", async () => {
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

  // --- --catalog → writable catalog ---------------------------------------

  it("points the backend at a writable catalog with --catalog", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-web-catalog-"));
    const catalogPath = join(dir, "mcp.json");
    await writeFile(
      catalogPath,
      JSON.stringify({
        mcpServers: {
          api: { type: "streamable-http", url: "https://example.com/mcp" },
        },
      }),
    );

    try {
      void runWeb(["node", "run-web", "--catalog", catalogPath]);
      await expectServerStarted(startHonoServer);

      expect(startHonoServer).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpConfigPath: catalogPath,
          writable: true,
          initialMcpConfig: null,
          initialServers: null,
        }),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts a non-existent --catalog path (backend seeds it)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-web-catalog-"));
    const catalogPath = join(dir, "does-not-exist-yet.json");

    try {
      void runWeb(["node", "run-web", "--catalog", catalogPath]);
      await expectServerStarted(startHonoServer);

      expect(startHonoServer.mock.calls[0]?.[0]).toMatchObject({
        mcpConfigPath: catalogPath,
        writable: true,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads MCP_CATALOG_PATH as the catalog when --catalog is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-web-catalog-"));
    const catalogPath = join(dir, "mcp.json");
    await writeFile(catalogPath, JSON.stringify({ mcpServers: {} }));
    process.env.MCP_CATALOG_PATH = catalogPath;

    try {
      void runWeb(["node", "run-web"]);
      await expectServerStarted(startHonoServer);

      expect(startHonoServer.mock.calls[0]?.[0]).toMatchObject({
        mcpConfigPath: catalogPath,
        writable: true,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("notes that --server is ignored alongside --catalog", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-web-catalog-"));
    const catalogPath = join(dir, "mcp.json");
    await writeFile(catalogPath, JSON.stringify({ mcpServers: {} }));

    try {
      void runWeb([
        "node",
        "run-web",
        "--catalog",
        catalogPath,
        "--server",
        "api",
      ]);
      await expectServerStarted(startHonoServer);

      expect(warnLines.some((l) => l.includes("--server has no effect"))).toBe(
        true,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // --- --config → read-only session file ----------------------------------

  it("serves a --config file as a read-only session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-web-config-"));
    const configPath = join(dir, "mcp.json");
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          api: { type: "streamable-http", url: "https://example.com/mcp" },
          other: { type: "sse", url: "https://example.com/sse" },
        },
      }),
    );

    try {
      void runWeb(["node", "run-web", "--config", configPath]);
      await expectServerStarted(startHonoServer);

      expect(startHonoServer).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpConfigPath: configPath,
          writable: false,
          initialMcpConfig: null,
          initialServers: null,
        }),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("notes that --server is ignored alongside --config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-web-config-"));
    const configPath = join(dir, "mcp.json");
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          api: { type: "streamable-http", url: "https://example.com/mcp" },
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

      expect(warnLines.some((l) => l.includes("--server has no effect"))).toBe(
        true,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exits when the --config file cannot be loaded", async () => {
    await expect(
      runWeb(["node", "run-web", "--config", "/no/such/file.json"]),
    ).rejects.toThrow("process.exit:1");
    expect(errorLines.some((l) => l.startsWith("Error:"))).toBe(true);
    expect(startHonoServer).not.toHaveBeenCalled();
  });

  // --- conflict matrix ----------------------------------------------------

  it.each([
    {
      name: "--catalog + --config",
      argv: ["--catalog", "/a.json", "--config", "/b.json"],
      match: "mutually exclusive",
    },
    {
      name: "--catalog + ad-hoc",
      argv: [
        "--catalog",
        "/a.json",
        "--server-url",
        "https://x/mcp",
        "--transport",
        "http",
      ],
      match: "--catalog cannot be combined with an ad-hoc",
    },
    {
      name: "--catalog + --header",
      argv: ["--catalog", "/a.json", "--header", "Authorization: Bearer x"],
      match: "--header cannot be combined with --catalog",
    },
    {
      name: "--config + ad-hoc",
      argv: [
        "--config",
        "/a.json",
        "--server-url",
        "https://x/mcp",
        "--transport",
        "http",
      ],
      match: "--config cannot be combined with an ad-hoc",
    },
    {
      name: "--config + --header",
      argv: ["--config", "/a.json", "--header", "Authorization: Bearer x"],
      match: "--header cannot be combined with --config",
    },
  ])("rejects $name", async ({ argv, match }) => {
    await expect(runWeb(["node", "run-web", ...argv])).rejects.toThrow(
      "process.exit:1",
    );
    expect(errorLines.some((l) => l.includes(match))).toBe(true);
    expect(startHonoServer).not.toHaveBeenCalled();
  });

  // --- lifecycle ----------------------------------------------------------

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

  it("does not create any temp file for an ad-hoc launch", async () => {
    void runWeb([
      "node",
      "run-web",
      "https://example.com/mcp",
      "--transport",
      "http",
    ]);
    await expectServerStarted(startHonoServer);

    // The ad-hoc list is in memory only; no path is handed to the backend.
    const cfg = startHonoServer.mock.calls[0]?.[0];
    expect(cfg?.mcpConfigPath).toBeUndefined();
    // Sanity: existsSync is imported and the absence of a path means nothing
    // to clean up on shutdown.
    expect(existsSync(join(tmpdir(), "definitely-not-created"))).toBe(false);
  });
});
