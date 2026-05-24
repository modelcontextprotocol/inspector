import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildWebServerConfigFromEnv,
  printServerBanner,
  webServerConfigToInitialPayload,
  type WebServerConfig,
} from "../../../../server/web-server-config.js";
import {
  API_SERVER_ENV_VARS,
  LEGACY_AUTH_TOKEN_ENV,
} from "../../../../../../core/mcp/remote/constants.js";

// Env keys this suite mutates. Each test starts from a snapshot taken in
// beforeEach and restores it in afterEach so neither the test runner nor
// sibling tests see leaked state.
const MUTATED_ENV_KEYS = [
  API_SERVER_ENV_VARS.AUTH_TOKEN,
  LEGACY_AUTH_TOKEN_ENV,
  "CLIENT_PORT",
  "HOST",
  "DANGEROUSLY_OMIT_AUTH",
  "MCP_STORAGE_DIR",
  "ALLOWED_ORIGINS",
  "MCP_SANDBOX_PORT",
  "SERVER_PORT",
  "MCP_LOG_FILE",
  "MCP_AUTO_OPEN_ENABLED",
] as const;

const baseConfig = (): WebServerConfig => ({
  port: 6274,
  hostname: "localhost",
  authToken: "tok",
  dangerouslyOmitAuth: false,
  initialMcpConfig: null,
  storageDir: undefined,
  allowedOrigins: ["http://localhost:6274"],
  sandboxPort: 0,
  sandboxHost: "localhost",
  logger: undefined,
  autoOpen: false,
});

let envSnapshot: Record<string, string | undefined>;

beforeEach(() => {
  envSnapshot = {};
  for (const key of MUTATED_ENV_KEYS) {
    envSnapshot[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of MUTATED_ENV_KEYS) {
    const original = envSnapshot[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

describe("buildWebServerConfigFromEnv", () => {
  it("returns defaults when no env vars are set", () => {
    const cfg = buildWebServerConfigFromEnv();
    expect(cfg.port).toBe(6274);
    expect(cfg.hostname).toBe("localhost");
    expect(cfg.authToken).toBe("");
    expect(cfg.dangerouslyOmitAuth).toBe(false);
    expect(cfg.initialMcpConfig).toBeNull();
    expect(cfg.storageDir).toBeUndefined();
    expect(cfg.allowedOrigins).toEqual(["http://localhost:6274"]);
    expect(cfg.sandboxPort).toBe(0);
    expect(cfg.sandboxHost).toBe("localhost");
    expect(cfg.logger).toBeUndefined();
    // Vitest sets `process.env.VITEST = 'true'`, so the autoOpen default is
    // suppressed here. Real `vite dev` runs don't set VITEST and default to
    // true (see "enables autoOpen by default outside Vitest" below).
    expect(cfg.autoOpen).toBe(false);
  });

  it("honors CLIENT_PORT and HOST", () => {
    process.env.CLIENT_PORT = "8123";
    process.env.HOST = "0.0.0.0";
    const cfg = buildWebServerConfigFromEnv();
    expect(cfg.port).toBe(8123);
    expect(cfg.hostname).toBe("0.0.0.0");
    expect(cfg.allowedOrigins).toEqual(["http://0.0.0.0:8123"]);
  });

  it("clears authToken when DANGEROUSLY_OMIT_AUTH is set even if AUTH_TOKEN is present", () => {
    process.env.DANGEROUSLY_OMIT_AUTH = "1";
    process.env[API_SERVER_ENV_VARS.AUTH_TOKEN] = "ignored";
    const cfg = buildWebServerConfigFromEnv();
    expect(cfg.dangerouslyOmitAuth).toBe(true);
    expect(cfg.authToken).toBe("");
  });

  it("uses API_SERVER_ENV_VARS.AUTH_TOKEN when present", () => {
    process.env[API_SERVER_ENV_VARS.AUTH_TOKEN] = "primary";
    const cfg = buildWebServerConfigFromEnv();
    expect(cfg.authToken).toBe("primary");
  });

  it("falls back to LEGACY_AUTH_TOKEN_ENV when the primary is unset", () => {
    process.env[LEGACY_AUTH_TOKEN_ENV] = "legacy";
    const cfg = buildWebServerConfigFromEnv();
    expect(cfg.authToken).toBe("legacy");
  });

  it("prefers API_SERVER_ENV_VARS.AUTH_TOKEN over the legacy env", () => {
    process.env[API_SERVER_ENV_VARS.AUTH_TOKEN] = "primary";
    process.env[LEGACY_AUTH_TOKEN_ENV] = "legacy";
    const cfg = buildWebServerConfigFromEnv();
    expect(cfg.authToken).toBe("primary");
  });

  it("parses ALLOWED_ORIGINS and filters empty entries", () => {
    process.env.ALLOWED_ORIGINS = "http://a,,http://b";
    const cfg = buildWebServerConfigFromEnv();
    expect(cfg.allowedOrigins).toEqual(["http://a", "http://b"]);
  });

  it("resolves sandboxPort from MCP_SANDBOX_PORT", () => {
    process.env.MCP_SANDBOX_PORT = "9001";
    expect(buildWebServerConfigFromEnv().sandboxPort).toBe(9001);
  });

  it("falls back to SERVER_PORT when MCP_SANDBOX_PORT is unset", () => {
    process.env.SERVER_PORT = "9100";
    expect(buildWebServerConfigFromEnv().sandboxPort).toBe(9100);
  });

  it("ignores non-numeric MCP_SANDBOX_PORT", () => {
    process.env.MCP_SANDBOX_PORT = "not-a-port";
    process.env.SERVER_PORT = "9100";
    expect(buildWebServerConfigFromEnv().sandboxPort).toBe(9100);
  });

  it("ignores non-numeric SERVER_PORT", () => {
    process.env.SERVER_PORT = "nope";
    expect(buildWebServerConfigFromEnv().sandboxPort).toBe(0);
  });

  it("treats MCP_SANDBOX_PORT empty string as unset", () => {
    process.env.MCP_SANDBOX_PORT = "";
    process.env.SERVER_PORT = "9100";
    expect(buildWebServerConfigFromEnv().sandboxPort).toBe(9100);
  });

  it("sets MCP_STORAGE_DIR when present", () => {
    process.env.MCP_STORAGE_DIR = "/tmp/storage";
    expect(buildWebServerConfigFromEnv().storageDir).toBe("/tmp/storage");
  });

  it("disables autoOpen when MCP_AUTO_OPEN_ENABLED is 'false'", () => {
    process.env.MCP_AUTO_OPEN_ENABLED = "false";
    expect(buildWebServerConfigFromEnv().autoOpen).toBe(false);
  });

  it("enables autoOpen when MCP_AUTO_OPEN_ENABLED is 'true'", () => {
    // Explicit 'true' overrides the VITEST-suppressed default, so this works
    // inside the test runner too.
    process.env.MCP_AUTO_OPEN_ENABLED = "true";
    expect(buildWebServerConfigFromEnv().autoOpen).toBe(true);
  });

  it("falls back to !VITEST when MCP_AUTO_OPEN_ENABLED is anything else", () => {
    process.env.MCP_AUTO_OPEN_ENABLED = "yes";
    // Vitest sets `VITEST=true` for itself; default falls to false here.
    expect(buildWebServerConfigFromEnv().autoOpen).toBe(false);
  });

  it("enables autoOpen by default outside Vitest", () => {
    const original = process.env.VITEST;
    delete process.env.VITEST;
    try {
      expect(buildWebServerConfigFromEnv().autoOpen).toBe(true);
    } finally {
      if (original !== undefined) process.env.VITEST = original;
    }
  });

  it("creates a logger when MCP_LOG_FILE is set", () => {
    // pino.destination("path") opens a fd lazily; provide a writable temp path.
    const logFile = `${process.env.TMPDIR ?? "/tmp"}/web-server-config.test.log`;
    process.env.MCP_LOG_FILE = logFile;
    const cfg = buildWebServerConfigFromEnv();
    expect(cfg.logger).toBeDefined();
  });
});

describe("webServerConfigToInitialPayload", () => {
  it("returns only defaultEnvironment when initialMcpConfig is null", () => {
    const payload = webServerConfigToInitialPayload(baseConfig());
    expect(payload.defaultEnvironment).toBeDefined();
    expect(payload.defaultCommand).toBeUndefined();
    expect(payload.defaultTransport).toBeUndefined();
  });

  it("emits stdio defaults when initialMcpConfig.type === 'stdio'", () => {
    const cfg = baseConfig();
    cfg.initialMcpConfig = {
      type: "stdio",
      command: "node",
      args: ["server.js"],
      cwd: "/srv",
      env: { FOO: "bar" },
    };
    const payload = webServerConfigToInitialPayload(cfg);
    expect(payload.defaultTransport).toBe("stdio");
    expect(payload.defaultCommand).toBe("node");
    expect(payload.defaultArgs).toEqual(["server.js"]);
    expect(payload.defaultCwd).toBe("/srv");
    expect(payload.defaultEnvironment.FOO).toBe("bar");
  });

  it("treats undefined type as stdio and defaults args to []", () => {
    const cfg = baseConfig();
    cfg.initialMcpConfig = {
      command: "echo",
    } as WebServerConfig["initialMcpConfig"];
    const payload = webServerConfigToInitialPayload(cfg);
    expect(payload.defaultTransport).toBe("stdio");
    expect(payload.defaultCommand).toBe("echo");
    expect(payload.defaultArgs).toEqual([]);
  });

  it("emits sse defaults when initialMcpConfig.type === 'sse'", () => {
    const cfg = baseConfig();
    cfg.initialMcpConfig = {
      type: "sse",
      url: "https://srv/sse",
    };
    const payload = webServerConfigToInitialPayload(cfg);
    expect(payload.defaultTransport).toBe("sse");
    expect(payload.defaultServerUrl).toBe("https://srv/sse");
  });

  it("emits streamable-http defaults", () => {
    const cfg = baseConfig();
    cfg.initialMcpConfig = {
      type: "streamable-http",
      url: "https://srv/mcp",
    };
    const payload = webServerConfigToInitialPayload(cfg);
    expect(payload.defaultTransport).toBe("streamable-http");
    expect(payload.defaultServerUrl).toBe("https://srv/mcp");
  });

  it("falls back to streamable-http when the type discriminator is unknown", () => {
    const cfg = baseConfig();
    // Cast through unknown to simulate an unrecognized discriminator that
    // the function should still degrade gracefully on.
    cfg.initialMcpConfig = {
      type: "unknown",
      url: "https://srv/other",
    } as unknown as WebServerConfig["initialMcpConfig"];
    const payload = webServerConfigToInitialPayload(cfg);
    expect(payload.defaultTransport).toBe("streamable-http");
    expect(payload.defaultServerUrl).toBe("https://srv/other");
  });
});

describe("printServerBanner", () => {
  let logSpy: ReturnType<typeof vitestSpyOnConsoleLog>;

  beforeEach(() => {
    logSpy = vitestSpyOnConsoleLog();
  });

  afterEach(() => {
    logSpy.restore();
  });

  it("includes the auth token in the URL when auth is enabled", () => {
    const url = printServerBanner(baseConfig(), 6274, "secret", undefined);
    expect(url).toBe(
      `http://localhost:6274?${API_SERVER_ENV_VARS.AUTH_TOKEN}=secret`,
    );
    expect(logSpy.lines.some((l) => l.includes("Auth token: secret"))).toBe(
      true,
    );
  });

  it("omits the query string when dangerouslyOmitAuth is true", () => {
    const cfg = baseConfig();
    cfg.dangerouslyOmitAuth = true;
    const url = printServerBanner(cfg, 6274, "irrelevant", undefined);
    expect(url).toBe("http://localhost:6274");
    expect(
      logSpy.lines.some((l) =>
        l.includes("Auth: disabled (DANGEROUSLY_OMIT_AUTH)"),
      ),
    ).toBe(true);
  });

  it("omits the query string when no token is supplied", () => {
    const url = printServerBanner(baseConfig(), 6274, "", undefined);
    expect(url).toBe("http://localhost:6274");
  });

  it("prints the sandbox URL when provided", () => {
    printServerBanner(baseConfig(), 6274, "tok", "http://sandbox:9999/sandbox");
    expect(
      logSpy.lines.some((l) =>
        l.includes("Sandbox (MCP Apps): http://sandbox:9999/sandbox"),
      ),
    ).toBe(true);
  });

  it("logs the auto-open hint only when autoOpen is true", () => {
    const noAuto = baseConfig();
    printServerBanner(noAuto, 6274, "tok", undefined);
    expect(logSpy.lines.some((l) => l.includes("Opening browser"))).toBe(false);

    logSpy.lines.length = 0;
    const withAuto = baseConfig();
    withAuto.autoOpen = true;
    printServerBanner(withAuto, 6274, "tok", undefined);
    expect(logSpy.lines.some((l) => l.includes("Opening browser"))).toBe(true);
  });
});

// Minimal console.log capture so banner-format assertions don't pollute stdout.
function vitestSpyOnConsoleLog(): {
  lines: string[];
  restore: () => void;
} {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return {
    lines,
    restore: () => {
      console.log = original;
    },
  };
}
