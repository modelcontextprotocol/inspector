import { describe, it, expect } from "vitest";
import {
  createEchoTool,
  createTestServerHttp,
  createTestServerInfo,
  getTestMcpServerCommand,
} from "@modelcontextprotocol/inspector-test-server";
import { runCli } from "./helpers/cli-runner.js";
import { DEFAULT_CONNECT_TIMEOUT_MS, withConnectTimeout } from "../src/cli.js";
import {
  MODERN_PROTOCOL_VERSION,
  type InspectorServerSettings,
} from "@inspector/core/mcp/types.js";
import {
  expectCliFailure,
  expectCliSuccess,
  expectOutputContains,
} from "./helpers/assertions.js";

describe("withConnectTimeout", () => {
  const baseSettings: InspectorServerSettings = {
    headers: [{ key: "X-Test", value: "1" }],
    metadata: {},
    env: [],
    connectionTimeout: 42,
    requestTimeout: 0,
    taskTtl: 60000,
    maxFetchRequests: 1000,
    autoRefreshOnListChanged: false,
    roots: [],
  };

  it("returns the settings unchanged when no timeout is given", () => {
    expect(withConnectTimeout(baseSettings, undefined)).toBe(baseSettings);
    expect(withConnectTimeout(undefined, undefined)).toBeUndefined();
  });

  it("overrides an existing settings' connectionTimeout", () => {
    const result = withConnectTimeout(baseSettings, 5000);
    expect(result).not.toBe(baseSettings);
    expect(result?.connectionTimeout).toBe(5000);
    // Other fields are preserved.
    expect(result?.headers).toEqual(baseSettings.headers);
  });

  it("builds a minimal settings object when none was provided", () => {
    const result = withConnectTimeout(undefined, DEFAULT_CONNECT_TIMEOUT_MS);
    expect(result?.connectionTimeout).toBe(DEFAULT_CONNECT_TIMEOUT_MS);
    expect(result?.headers).toEqual([]);
    expect(result?.requestTimeout).toBe(0);
  });
});

/**
 * Covers the programmatic-ergonomics flags from #1573: `--method initialize`,
 * `--tool-args-json`, `--connect-timeout`, and the MCP_CATALOG_PATH ad-hoc
 * gate. All connect to the bundled stdio test server.
 */
describe("--method initialize", () => {
  it("connects and emits the cached InitializeResult fields", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([command, ...args, "--method", "initialize"]);
    expectCliSuccess(result);
    const json = JSON.parse(result.stdout) as {
      serverInfo: { name: string };
      protocolVersion: string;
      capabilities: Record<string, unknown>;
    };
    expect(json.serverInfo.name).toBeTruthy();
    expect(typeof json.protocolVersion).toBe("string");
    expect(typeof json.capabilities).toBe("object");
  });
});

describe("--tool-args-json", () => {
  it("passes the JSON object verbatim (string values stay strings)", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--method",
      "tools/call",
      "--tool-name",
      "echo",
      "--tool-args-json",
      JSON.stringify({ message: "012" }),
    ]);
    expectCliSuccess(result);
    // echo returns its message; with --tool-arg message=012 the value would
    // coerce to the number 12 (and fail the string schema), but
    // --tool-args-json preserves the string "012".
    expect(result.stdout).toContain("012");
  });

  it("rejects --tool-args-json combined with --tool-arg", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--method",
      "tools/call",
      "--tool-name",
      "echo",
      "--tool-arg",
      "x=1",
      "--tool-args-json",
      "{}",
    ]);
    expectCliFailure(result);
    expectOutputContains(result, "cannot be combined with --tool-arg");
  });

  it("rejects malformed JSON", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--method",
      "tools/call",
      "--tool-name",
      "echo",
      "--tool-args-json",
      "{not json}",
    ]);
    expectCliFailure(result);
    expectOutputContains(result, "not valid JSON");
  });

  it("rejects a non-object value", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--method",
      "tools/call",
      "--tool-name",
      "echo",
      "--tool-args-json",
      "[1,2]",
    ]);
    expectCliFailure(result);
    expectOutputContains(result, "must be a JSON object");
  });
});

describe("CLI --relogin flag conflicts", () => {
  it("rejects --relogin with --stored-auth-only", async () => {
    const result = await runCli([
      "--relogin",
      "--stored-auth-only",
      "--server-url",
      "https://example.com/mcp",
      "--method",
      "tools/list",
    ]);
    expectCliFailure(result);
    expect(result.stderr).toMatch(
      /--relogin cannot be combined with --stored-auth-only/,
    );
  });

  it("rejects --relogin with --use-stored-auth", async () => {
    const result = await runCli([
      "--relogin",
      "--use-stored-auth",
      "--server-url",
      "https://example.com/mcp",
      "--method",
      "tools/list",
    ]);
    expectCliFailure(result);
    expect(result.stderr).toMatch(/--use-stored-auth/);
  });

  it("rejects --relogin with catalog-only methods", async () => {
    const result = await runCli(["--relogin", "--method", "servers/list"]);
    expectCliFailure(result);
    expect(result.stderr).toMatch(/servers\/\* catalog command/);
  });

  it("rejects --relogin with --list-stored-auth", async () => {
    const result = await runCli(["--relogin", "--list-stored-auth"]);
    expectCliFailure(result);
    expect(result.stderr).toMatch(/--list-stored-auth or --print-handoff/);
  });

  it("rejects --relogin for stdio servers", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--relogin",
      "--method",
      "tools/list",
    ]);
    expectCliFailure(result);
    expect(result.stderr).toMatch(/HTTP\/SSE server URL/);
  });

  it("accepts --relogin and clears stored auth before connect", async () => {
    // Unreachable port: proves --relogin runs (clears store) then fails connect.
    const result = await runCli([
      "--relogin",
      "--server-url",
      "http://127.0.0.1:1/mcp",
      "--transport",
      "http",
      "--connect-timeout",
      "200",
      "--method",
      "initialize",
    ]);
    expectCliFailure(result);
  });
});

describe("CLI --stored-auth-only wiring", () => {
  it("accepts the flag and fails connect without interactive OAuth prompts", async () => {
    // Unreachable host: proves the flag is accepted through parse → callMethod
    // and does not hang on an interactive OAuth prompt.
    const result = await runCli([
      "--stored-auth-only",
      "--server-url",
      "http://127.0.0.1:1/mcp",
      "--transport",
      "http",
      "--connect-timeout",
      "200",
      "--method",
      "initialize",
    ]);
    expectCliFailure(result);
    expect(result.stderr).not.toMatch(/Please navigate to:/);
    expect(result.stderr).not.toMatch(/Proceed with step-up/);
  });
});

describe("--protocol-era", () => {
  // The discriminating case: `legacy` and `auto` both connect to a legacy
  // fixture whether or not the flag is wired, since `auto` falls back. A
  // modern-only server rejects the default legacy handshake, so only a flag
  // that actually reaches negotiation turns the failure into a modern session.
  it("negotiates the modern era against a modern-only server", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: [createEchoTool()],
      modern: { legacy: "reject" },
    });
    try {
      await server.start();
      const adHoc = [server.url, "--transport", "http"];

      const withoutFlag = await runCli([...adHoc, "--method", "initialize"]);
      expectCliFailure(withoutFlag);

      const withFlag = await runCli([
        ...adHoc,
        "--protocol-era",
        "modern",
        "--method",
        "initialize",
      ]);
      expectCliSuccess(withFlag);
      const json = JSON.parse(withFlag.stdout) as { protocolVersion: string };
      expect(json.protocolVersion).toBe(MODERN_PROTOCOL_VERSION);
    } finally {
      await server.stop();
    }
  });

  it.each(["legacy", "auto"])(
    "accepts %s on an ad-hoc target and connects",
    async (era) => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--protocol-era",
        era,
        "--method",
        "tools/list",
      ]);
      expectCliSuccess(result);
    },
  );

  it("rejects an unknown era before connecting", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--protocol-era",
      "future",
      "--method",
      "tools/list",
    ]);
    expectCliFailure(result);
    expect(result.stderr).toContain("Invalid protocol era: future");
  });
});

describe("--skill-catalog-max-skills / --skill-catalog-max-bytes (#2420)", () => {
  // The flags must reach `verifySkills`' run-level budget, not just parse. A
  // budget of one skill leaves every later skill unread, which the report
  // records as an `incomplete` outcome — without the flag the fixture's whole
  // catalog fits the default budget and no skill is incomplete.
  it("caps the --verify run at the flag's skill budget", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      skills: true,
    });
    try {
      await server.start();
      const verify = [
        server.url,
        "--transport",
        "http",
        "--method",
        "skills/list",
        "--verify",
      ];

      const unbounded = await runCli(verify);
      expect(reportOutcomes(unbounded.stdout)).not.toContain("incomplete");

      const capped = await runCli([
        ...verify,
        "--skill-catalog-max-skills",
        "1",
      ]);
      expect(reportOutcomes(capped.stdout)).toContain("incomplete");
    } finally {
      await server.stop();
    }
  });

  it.each([
    ["--skill-catalog-max-skills", "0"],
    ["--skill-catalog-max-bytes", "1.5"],
  ])("rejects %s %s before connecting", async (flag, value) => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      flag,
      value,
      "--method",
      "tools/list",
    ]);
    expectCliFailure(result);
    expect(result.stderr).toContain(
      `Invalid ${flag}: ${value}. Expected a positive integer written as plain decimal digits, at most 9007199254740991.`,
    );
  });
});

/** The `outcome` of each NDJSON `--verify` report line. */
function reportOutcomes(stdout: string): string[] {
  return stdout
    .trim()
    .split("\n")
    .map((line) => (JSON.parse(line) as { outcome: string }).outcome);
}

describe("MCP_CATALOG_PATH with an ad-hoc target", () => {
  it("does not conflict with an ad-hoc target (env catalog is ignored)", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([command, ...args, "--method", "tools/list"], {
      env: { MCP_CATALOG_PATH: "/no/such/catalog.json" },
    });
    expectCliSuccess(result);
  });
});

describe("--connect-timeout", () => {
  it("accepts a numeric value and connects within it", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--connect-timeout",
      "5000",
      "--method",
      "tools/list",
    ]);
    expectCliSuccess(result);
  });

  it("accepts 0 (no timeout) and connects", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--connect-timeout",
      "0",
      "--method",
      "tools/list",
    ]);
    expectCliSuccess(result);
  });

  it("rejects a negative value", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--connect-timeout",
      "-1",
      "--method",
      "tools/list",
    ]);
    expectCliFailure(result);
    expectOutputContains(result, "non-negative number");
  });

  it("rejects a non-numeric value", async () => {
    const { command, args } = getTestMcpServerCommand();
    const result = await runCli([
      command,
      ...args,
      "--connect-timeout",
      "soon",
      "--method",
      "tools/list",
    ]);
    expectCliFailure(result);
    expectOutputContains(result, "non-negative number");
  });
});
