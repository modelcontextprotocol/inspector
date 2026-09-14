import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildWebServerConfig,
  buildWebServerConfigFromEnv,
  defaultAllowedOrigins,
  printServerBanner,
  webServerConfigToInitialPayload,
  type WebServerConfig,
} from "../../../../server/web-server-config.js";
import { DEFAULT_SANDBOX_PORT } from "../../../../server/sandbox-controller.js";
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
  "DANGEROUSLY_BIND_ALL_INTERFACES",
  "MCP_STORAGE_DIR",
  "ALLOWED_ORIGINS",
  "MCP_SANDBOX_PORT",
  "MCP_APP_ORIGIN_PORT",
  "SERVER_PORT",
  "MCP_LOG_FILE",
  "MCP_AUTO_OPEN_ENABLED",
] as const;

const baseConfig = (): WebServerConfig => ({
  port: 6274,
  hostname: "127.0.0.1",
  authToken: "tok",
  dangerouslyOmitAuth: false,
  initialMcpConfig: null,
  mcpConfigPath: undefined,
  writable: true,
  initialServers: null,
  storageDir: undefined,
  allowedOrigins: ["http://localhost:6274"],
  sandboxPort: 0,
  appOriginPort: 0,
  sandboxHost: "127.0.0.1",
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
    expect(cfg.hostname).toBe("127.0.0.1");
    expect(cfg.authToken).toBe("");
    expect(cfg.dangerouslyOmitAuth).toBe(false);
    expect(cfg.initialMcpConfig).toBeNull();
    expect(cfg.storageDir).toBeUndefined();
    expect(cfg.allowedOrigins).toEqual([
      "http://localhost:6274",
      "http://127.0.0.1:6274",
      "http://[::1]:6274",
    ]);
    expect(cfg.sandboxPort).toBe(DEFAULT_SANDBOX_PORT);
    expect(cfg.sandboxHost).toBe("127.0.0.1");
    expect(cfg.logger).toBeUndefined();
    // Vitest sets `process.env.VITEST = 'true'`, so the autoOpen default is
    // suppressed here. Real `vite dev` runs don't set VITEST and default to
    // true (see "enables autoOpen by default outside Vitest" below).
    expect(cfg.autoOpen).toBe(false);
  });

  it("honors CLIENT_PORT and a loopback HOST", () => {
    process.env.CLIENT_PORT = "8123";
    process.env.HOST = "127.0.0.1";
    const cfg = buildWebServerConfigFromEnv();
    expect(cfg.port).toBe(8123);
    expect(cfg.hostname).toBe("127.0.0.1");
  });

  it("refuses HOST=0.0.0.0 without the bind-all opt-in", () => {
    process.env.HOST = "0.0.0.0";
    expect(() => buildWebServerConfigFromEnv()).toThrow(
      /DANGEROUSLY_BIND_ALL_INTERFACES/,
    );
  });

  it("allows HOST=0.0.0.0 when the bind-all opt-in is set", () => {
    process.env.CLIENT_PORT = "8123";
    process.env.HOST = "0.0.0.0";
    process.env.DANGEROUSLY_BIND_ALL_INTERFACES = "true";
    const cfg = buildWebServerConfigFromEnv();
    expect(cfg.hostname).toBe("0.0.0.0");
    // A wildcard bind serves loopback, so the default allow-list is the
    // loopback trio (what a `docker run -p` browser actually sends) plus the
    // canonical wildcard pair (0.0.0.0 / [::]).
    expect(cfg.allowedOrigins).toEqual([
      "http://localhost:8123",
      "http://127.0.0.1:8123",
      "http://[::1]:8123",
      "http://0.0.0.0:8123",
      "http://[::]:8123",
    ]);
  });

  it("expands a loopback HOST into all equivalent loopback origins", () => {
    // `localhost` resolves to either 127.0.0.1 or ::1 depending on the OS, and
    // Node/Vite may bind the IPv6 form — so a browser can send `Origin:
    // http://[::1]:PORT` even though the banner advertised `localhost`. The
    // default must accept all three so the DNS-rebinding guard doesn't 403 a
    // legitimate loopback connect (the exact bug behind an stdio server that
    // "should always work" failing with a 403 Invalid origin).
    process.env.HOST = "127.0.0.1";
    process.env.CLIENT_PORT = "6274";
    const cfg = buildWebServerConfigFromEnv();
    expect(cfg.allowedOrigins).toEqual([
      "http://localhost:6274",
      "http://127.0.0.1:6274",
      "http://[::1]:6274",
    ]);
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

  it("parses ALLOWED_ORIGINS, trimming entries and filtering empties", () => {
    process.env.ALLOWED_ORIGINS = "http://a:1, ,  http://b:2  ";
    const cfg = buildWebServerConfigFromEnv();
    expect(cfg.allowedOrigins).toEqual(["http://a:1", "http://b:2"]);
  });

  it.each(["", " ", ","])(
    "falls back to the default (not an empty allow-all) when ALLOWED_ORIGINS is %j",
    (value) => {
      // An empty parsed list must NOT reach the middleware — it treats an empty
      // allow-list as allow-all, which would silently disable the origin guard.
      process.env.ALLOWED_ORIGINS = value;
      const cfg = buildWebServerConfigFromEnv();
      expect(cfg.allowedOrigins).toEqual([
        "http://localhost:6274",
        "http://127.0.0.1:6274",
        "http://[::1]:6274",
      ]);
    },
  );

  it("canonicalizes ALLOWED_ORIGINS entries so copy-paste forms still match", () => {
    // Trailing slash, uppercase host, explicit default :80 — all normalized to
    // the canonical Origin the browser actually sends.
    process.env.ALLOWED_ORIGINS =
      "http://localhost:6274/, http://Example.COM:6274, http://myhost:80";
    const cfg = buildWebServerConfigFromEnv();
    expect(cfg.allowedOrigins).toEqual([
      "http://localhost:6274",
      "http://example.com:6274",
      "http://myhost",
    ]);
  });

  it("drops unparseable ALLOWED_ORIGINS entries (and falls back if none survive)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      process.env.ALLOWED_ORIGINS = "not a url, *, http://ok:1";
      const cfg = buildWebServerConfigFromEnv();
      // "not a url" / "*" throw; "http://ok:1" parses.
      expect(cfg.allowedOrigins).toEqual(["http://ok:1"]);

      process.env.ALLOWED_ORIGINS = "not a url, also bad";
      const cfg2 = buildWebServerConfigFromEnv();
      expect(cfg2.allowedOrigins).toEqual([
        "http://localhost:6274",
        "http://127.0.0.1:6274",
        "http://[::1]:6274",
      ]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('drops scheme-less / opaque ALLOWED_ORIGINS entries rather than allow-listing "null"', () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // `new URL("localhost:6274").origin` is the literal "null" (not a throw) —
      // must be dropped, not allow-listed (it'd match a real `Origin: null`).
      process.env.ALLOWED_ORIGINS =
        "localhost:6274, file:///srv, http://real:1";
      const cfg = buildWebServerConfigFromEnv();
      expect(cfg.allowedOrigins).toEqual(["http://real:1"]);

      // All scheme-less → nothing survives → fail-closed fallback to default.
      process.env.ALLOWED_ORIGINS = "localhost:6274, myhost:8080";
      const cfg2 = buildWebServerConfigFromEnv();
      expect(cfg2.allowedOrigins).toEqual([
        "http://localhost:6274",
        "http://127.0.0.1:6274",
        "http://[::1]:6274",
      ]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("drops a wildcard ALLOWED_ORIGINS entry (works for CSP but never for the origin check)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      process.env.ALLOWED_ORIGINS =
        "http://*.example.com:6274, http://real.example.com:6274";
      const cfg = buildWebServerConfigFromEnv();
      expect(cfg.allowedOrigins).toEqual(["http://real.example.com:6274"]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it.each(["0", "abc", "70000", "-1", "6274abc", "80.9"])(
    "rejects an unusable CLIENT_PORT %j with an actionable error",
    (value) => {
      process.env.CLIENT_PORT = value;
      expect(() => buildWebServerConfigFromEnv()).toThrow(/CLIENT_PORT/);
    },
  );

  it("treats an empty CLIENT_PORT as unset (defaults to 6274)", () => {
    process.env.CLIENT_PORT = "";
    const cfg = buildWebServerConfigFromEnv();
    expect(cfg.port).toBe(6274);
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
    expect(buildWebServerConfigFromEnv().sandboxPort).toBe(
      DEFAULT_SANDBOX_PORT,
    );
  });

  it("treats MCP_SANDBOX_PORT empty string as unset", () => {
    process.env.MCP_SANDBOX_PORT = "";
    process.env.SERVER_PORT = "9100";
    expect(buildWebServerConfigFromEnv().sandboxPort).toBe(9100);
  });

  it("resolves appOriginPort from MCP_APP_ORIGIN_PORT, defaulting to 6278", () => {
    // The dedicated app origin (#2056). Deliberately NOT sharing the sandbox's
    // SERVER_PORT fallback: it is a different listener and must be pinnable
    // (and forwardable) on its own.
    delete process.env.MCP_APP_ORIGIN_PORT;
    process.env.SERVER_PORT = "9100";
    expect(buildWebServerConfigFromEnv().appOriginPort).toBe(6278);
    process.env.MCP_APP_ORIGIN_PORT = "9300";
    expect(buildWebServerConfigFromEnv().appOriginPort).toBe(9300);
  });

  it.each([
    ["the web server", "CLIENT_PORT", "the web server (CLIENT_PORT)"],
    [
      "the sandbox",
      "MCP_SANDBOX_PORT",
      "the MCP Apps sandbox (MCP_SANDBOX_PORT)",
    ],
  ])(
    "yields a dynamic app-origin port when it collides with %s",
    (_label, envVar, expectedReason) => {
      // The app-origin listener starts BEFORE the web server binds, so a
      // configured collision is not a race it loses — it WINS the port and the
      // Inspector then dies with EADDRINUSE. `CLIENT_PORT=6278` was a valid
      // config before this feature existed.
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        process.env[envVar] = "6500";
        process.env.MCP_APP_ORIGIN_PORT = "6500";
        expect(buildWebServerConfigFromEnv().appOriginPort).toBe(0);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(expectedReason),
        );
      } finally {
        warnSpy.mockRestore();
      }
    },
  );

  it("leaves an explicit dynamic app-origin port alone", () => {
    // 0 means "OS-assigned" for both, so two zeros are not a collision.
    process.env.CLIENT_PORT = "6274";
    process.env.MCP_SANDBOX_PORT = "0";
    process.env.MCP_APP_ORIGIN_PORT = "0";
    expect(buildWebServerConfigFromEnv().appOriginPort).toBe(0);
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

describe("defaultAllowedOrigins", () => {
  it.each(["localhost", "127.0.0.1", "::1", "[::1]", "LOCALHOST"])(
    "expands the loopback host %s into all three loopback origins",
    (host) => {
      expect(defaultAllowedOrigins(host, 6274)).toEqual([
        "http://localhost:6274",
        "http://127.0.0.1:6274",
        "http://[::1]:6274",
      ]);
    },
  );

  it("returns a single exact origin for a specific non-loopback host", () => {
    expect(defaultAllowedOrigins("192.168.1.50", 6274)).toEqual([
      "http://192.168.1.50:6274",
    ]);
  });

  // A non-canonical spelling of a loopback address is canonicalized (the way the
  // browser canonicalizes it into `Origin`), so it's recognized as loopback and
  // gets the trio — not a single unmatchable entry.
  it.each([
    "127.1",
    "0x7f.0.0.1",
    "2130706433",
    "0:0:0:0:0:0:0:1",
    "::0001",
    "::ffff:127.0.0.1", // IPv4-mapped loopback — the socket answers on 127.0.0.1
  ])("canonicalizes the loopback spelling %j and returns the trio", (host) => {
    expect(defaultAllowedOrigins(host, 6274)).toEqual([
      "http://localhost:6274",
      "http://127.0.0.1:6274",
      "http://[::1]:6274",
    ]);
  });

  it("unmaps an IPv4-mapped non-loopback host to its dotted form", () => {
    expect(defaultAllowedOrigins("::ffff:192.168.1.50", 6274)).toEqual([
      "http://192.168.1.50:6274",
    ]);
  });

  it("keeps a distinct non-loopback address (127.0.0.2) as a single origin", () => {
    // 127.0.0.2 is canonical and a bind there doesn't serve 127.0.0.1, so the
    // single-origin branch is correct — only non-canonical *spellings* expand.
    expect(defaultAllowedOrigins("127.0.0.2", 6274)).toEqual([
      "http://127.0.0.2:6274",
    ]);
  });

  it("handles an empty host (canonicalUrlHost's non-URL fallback) as the wildcard", () => {
    // `new URL("http://")` throws, so canonicalUrlHost falls back to "" — which
    // isAllInterfacesHost treats as the wildcard. No `http://:PORT` garbage.
    expect(defaultAllowedOrigins("", 8123)).toEqual([
      "http://localhost:8123",
      "http://127.0.0.1:8123",
      "http://[::1]:8123",
      "http://0.0.0.0:8123",
      "http://[::]:8123",
    ]);
  });

  // Any wildcard spelling yields the loopback trio + the CANONICAL wildcard pair
  // (0.0.0.0 / [::]) — not the typed spelling, which the browser canonicalizes
  // away (HOST=0 / 0x0 / 0.0.0 all send http://0.0.0.0:PORT; ::0 sends [::]).
  it.each(["0.0.0.0", "::", "::0", "0", "0x0", "0.0.0"])(
    "returns the loopback trio + canonical wildcard pair for the all-interfaces host %j",
    (host) => {
      expect(defaultAllowedOrigins(host, 8123)).toEqual([
        "http://localhost:8123",
        "http://127.0.0.1:8123",
        "http://[::1]:8123",
        "http://0.0.0.0:8123",
        "http://[::]:8123",
      ]);
    },
  );

  it("lowercases a non-loopback hostname to match the browser's Origin", () => {
    expect(defaultAllowedOrigins("Example.COM", 6274)).toEqual([
      "http://example.com:6274",
    ]);
  });

  it("omits the port from the origin when it's the http default (80)", () => {
    // Browsers drop :80 from the Origin header, and the guard is an exact
    // match, so an origin with :80 could never match a real request.
    expect(defaultAllowedOrigins("192.168.1.50", 80)).toEqual([
      "http://192.168.1.50",
    ]);
    expect(defaultAllowedOrigins("localhost", 80)).toEqual([
      "http://localhost",
      "http://127.0.0.1",
      "http://[::1]",
    ]);
  });

  it("brackets a non-loopback IPv6 literal so it's a valid origin", () => {
    expect(defaultAllowedOrigins("fe80::1", 6274)).toEqual([
      "http://[fe80::1]:6274",
    ]);
  });
});

describe("buildWebServerConfig", () => {
  it("matches buildWebServerConfigFromEnv when initialMcpConfig is omitted", () => {
    process.env[API_SERVER_ENV_VARS.AUTH_TOKEN] = "shared";
    expect(buildWebServerConfig()).toEqual(buildWebServerConfigFromEnv());
    expect(buildWebServerConfig({ initialMcpConfig: null })).toEqual(
      buildWebServerConfigFromEnv(),
    );
  });

  it("threads mcpConfigPath through and defaults it to undefined", () => {
    expect(buildWebServerConfig().mcpConfigPath).toBeUndefined();
    expect(
      buildWebServerConfig({ mcpConfigPath: "/tmp/catalog/mcp.json" })
        .mcpConfigPath,
    ).toBe("/tmp/catalog/mcp.json");
  });

  it("defaults writable to true and initialServers to null", () => {
    const cfg = buildWebServerConfig();
    expect(cfg.writable).toBe(true);
    expect(cfg.initialServers).toBeNull();
  });

  it("threads writable and initialServers when provided", () => {
    const initialServers = {
      mcpServers: { srv: { type: "stdio" as const, command: "node" } },
    };
    const cfg = buildWebServerConfig({ writable: false, initialServers });
    expect(cfg.writable).toBe(false);
    expect(cfg.initialServers).toBe(initialServers);
  });

  it("preserves a stdio initialMcpConfig while applying shared env defaults", () => {
    process.env.CLIENT_PORT = "7000";
    const initialMcpConfig = {
      type: "stdio" as const,
      command: "node",
      args: ["server.js"],
      cwd: "/srv",
    };
    const cfg = buildWebServerConfig({ initialMcpConfig });
    expect(cfg.port).toBe(7000);
    expect(cfg.initialMcpConfig).toEqual(initialMcpConfig);
    expect(cfg.allowedOrigins).toEqual([
      "http://localhost:7000",
      "http://127.0.0.1:7000",
      "http://[::1]:7000",
    ]);
  });

  it("preserves remote transport initialMcpConfig", () => {
    const initialMcpConfig = {
      type: "streamable-http" as const,
      url: "https://example.com/mcp",
    };
    const cfg = buildWebServerConfig({ initialMcpConfig });
    expect(cfg.initialMcpConfig).toEqual(initialMcpConfig);
  });
});

describe("webServerConfigToInitialPayload", () => {
  it("returns only defaultEnvironment when initialMcpConfig is null", () => {
    const payload = webServerConfigToInitialPayload(baseConfig());
    expect(payload.defaultEnvironment).toBeDefined();
    expect(payload.defaultCommand).toBeUndefined();
    expect(payload.defaultTransport).toBeUndefined();
  });

  it("tags the payload with the single-source Inspector version", () => {
    // Read from the root package.json via readInspectorVersion() at module load.
    const payload = webServerConfigToInitialPayload(baseConfig());
    expect(payload.version).toMatch(/^\d+\.\d+\.\d+/);
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

  it("omits secretStorage when the caller didn't resolve a store", () => {
    // The UI treats an absent descriptor as "unknown" and shows nothing. A
    // defaulted value would put a confident wrong answer under a secret field.
    expect(webServerConfigToInitialPayload(baseConfig()).secretStorage).toBe(
      undefined,
    );
  });

  it("passes the resolved store through verbatim (#1950)", () => {
    const secretStorage = {
      kind: "file",
      reason: "fallback",
      durable: true,
      plaintext: true,
      path: "/home/node/.mcp-inspector/secrets.json",
    } as const;
    expect(
      webServerConfigToInitialPayload(baseConfig(), secretStorage)
        .secretStorage,
    ).toEqual(secretStorage);
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
      `http://127.0.0.1:6274?${API_SERVER_ENV_VARS.AUTH_TOKEN}=secret`,
    );
    expect(logSpy.lines.some((l) => l.includes("Auth token: secret"))).toBe(
      true,
    );
  });

  it("omits the query string when dangerouslyOmitAuth is true", () => {
    const cfg = baseConfig();
    cfg.dangerouslyOmitAuth = true;
    const url = printServerBanner(cfg, 6274, "irrelevant", undefined);
    expect(url).toBe("http://127.0.0.1:6274");
    expect(
      logSpy.lines.some((l) =>
        l.includes("Auth: disabled (DANGEROUSLY_OMIT_AUTH)"),
      ),
    ).toBe(true);
  });

  it("omits the query string when no token is supplied", () => {
    const url = printServerBanner(baseConfig(), 6274, "", undefined);
    expect(url).toBe("http://127.0.0.1:6274");
  });

  it("brackets an IPv6 bind host in the printed URL", () => {
    const cfg = baseConfig();
    cfg.hostname = "::1";
    const url = printServerBanner(cfg, 6274, "", undefined);
    expect(url).toBe("http://[::1]:6274");
  });

  it("advertises localhost for a wildcard bind rather than the wildcard host", () => {
    const cfg = baseConfig();
    cfg.hostname = "0.0.0.0";
    const url = printServerBanner(cfg, 6274, "", undefined);
    expect(url).toBe("http://localhost:6274");
  });

  it("advertises the canonical (unmapped) host so banner ⊆ allowedOrigins", () => {
    // An IPv4-mapped bind host: the allow-list emits the loopback trio (which
    // includes http://127.0.0.1), so the banner must advertise a member of it,
    // not the [::ffff:127.0.0.1] form (whose Origin is [::ffff:7f00:1]).
    const cfg = baseConfig();
    cfg.hostname = "::ffff:127.0.0.1";
    const url = printServerBanner(cfg, 6274, "", undefined);
    expect(url).toBe("http://127.0.0.1:6274");
    expect(defaultAllowedOrigins(cfg.hostname, 6274)).toContain(url);
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

  it("prints the secret store for every kind, not only the alarming ones", () => {
    // A line that appears only when something is wrong can't be used to
    // confirm that nothing is.
    printServerBanner(baseConfig(), 6274, "tok", undefined, {
      kind: "keyring",
      reason: "default",
      durable: true,
    });
    expect(logSpy.lines.some((l) => l.includes("Secrets: OS keychain"))).toBe(
      true,
    );
  });

  it("names the path and the fallback for a file-backed store", () => {
    printServerBanner(baseConfig(), 6274, "tok", undefined, {
      kind: "file",
      reason: "fallback",
      durable: true,
      plaintext: true,
      path: "/home/node/.mcp-inspector/secrets.json",
    });
    const line = logSpy.lines.find((l) => l.includes("Secrets:"));
    expect(line).toContain("File (unencrypted)");
    expect(line).toContain("/home/node/.mcp-inspector/secrets.json");
    expect(line).toContain("fell back");
  });

  it("prints no secrets line when no store was resolved", () => {
    printServerBanner(baseConfig(), 6274, "tok", undefined);
    expect(logSpy.lines.some((l) => l.includes("Secrets:"))).toBe(false);
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
