import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createEchoTool,
  createTestServerHttp,
  createTestServerInfo,
} from "@modelcontextprotocol/inspector-test-server";
import { runMcp } from "./helpers/mcp-runner.js";
import {
  createSampleTestConfig,
  createTestConfig,
  deleteConfigFile,
} from "../../cli/__tests__/helpers/fixtures.js";
import { expectCliSuccess } from "../../cli/__tests__/helpers/assertions.js";
import { callDaemon } from "../src/daemon/client.js";
import { resolveLoadFlags } from "../src/connection/load-flags.js";
import { formatLoadSummaryHuman } from "../src/connection/format-human.js";
import { writeRpcOutcome } from "../src/connection/dispatch.js";
import {
  DEFAULT_LOAD_CONCURRENCY,
  DEFAULT_LOAD_DURATION_MS,
  type LoadSummary,
} from "@inspector/core/cli/handlers/load-test.js";
import { EXIT_CODES } from "@inspector/core/cli/error-handler.js";
import { PLAIN } from "@inspector/core/cli/style.js";

/**
 * `mcpdo tools/call --load` (#2744): the flag rules, the summary rendering,
 * and end-to-end runs through an auto-spawned daemon — including the
 * thresholds and multiple sessions brought over from the one-shot CLI (#2800).
 */

const SUMMARY: LoadSummary = {
  tool: "echo",
  concurrency: 4,
  durationMs: 1500,
  requestLimit: 40,
  rate: 20,
  requests: 30,
  ok: 27,
  toolErrors: 1,
  errors: 2,
  errorRate: 0.1,
  elapsedMs: 1500,
  throughput: 20,
  latencyMs: { min: 1, mean: 2.5, p50: 2, p90: 4, p99: 5, max: 6 },
  errorMessages: [{ message: "Request timed out", count: 2 }],
};

describe("resolveLoadFlags", () => {
  it("returns undefined for an ordinary call", () => {
    expect(resolveLoadFlags({ toolName: "echo" })).toBeUndefined();
  });

  it("applies the engine's defaults, with no thresholds", () => {
    expect(resolveLoadFlags({ load: true, toolName: "echo" })).toEqual({
      options: {
        concurrency: DEFAULT_LOAD_CONCURRENCY,
        durationMs: DEFAULT_LOAD_DURATION_MS,
      },
    });
  });

  it("passes every bound and threshold through", () => {
    expect(
      resolveLoadFlags({
        load: true,
        toolName: "echo",
        loadConcurrency: 3,
        loadConnections: 2,
        loadDuration: 2,
        loadRequests: 9,
        loadRate: 5,
        loadMaxErrorRate: 0,
        loadMaxP99: 250,
      }),
    ).toEqual({
      options: {
        concurrency: 3,
        connections: 2,
        durationMs: 2000,
        requests: 9,
        rate: 5,
      },
      thresholds: { maxErrorRate: 0, maxP99Ms: 250 },
    });
  });

  it("refuses more connections than workers as a usage error", () => {
    expect(() =>
      resolveLoadFlags({
        load: true,
        toolName: "echo",
        loadConcurrency: 2,
        loadConnections: 3,
      }),
    ).toThrow(
      expect.objectContaining({
        exitCode: EXIT_CODES.USAGE,
        message:
          "--load-connections (3) cannot exceed --load-concurrency (2); every connection needs at least one worker.",
        envelope: expect.objectContaining({ code: "load_flag_conflict" }),
      }),
    );
  });

  it.each([
    [{ loadConcurrency: 2 }, "--load-concurrency requires --load."],
    [{ loadConnections: 2 }, "--load-connections requires --load."],
    [{ loadDuration: 1 }, "--load-duration requires --load."],
    [{ loadRequests: 1 }, "--load-requests requires --load."],
    [{ loadRate: 1 }, "--load-rate requires --load."],
    [{ loadMaxErrorRate: 0.1 }, "--load-max-error-rate requires --load."],
    [{ loadMaxP99: 100 }, "--load-max-p99 requires --load."],
    [
      { load: true, appInfo: true },
      "--load cannot be combined with --app-info.",
    ],
  ])("rejects %j", (flags, message) => {
    expect(() => resolveLoadFlags({ toolName: "echo", ...flags })).toThrow(
      message,
    );
  });

  it("requires a tool name", () => {
    expect(() => resolveLoadFlags({ load: true })).toThrow(
      "--load requires a tool name.",
    );
  });
});

describe("formatLoadSummaryHuman", () => {
  it("renders bounds, outcomes, latency and top errors", () => {
    const text = formatLoadSummaryHuman(SUMMARY, PLAIN);
    expect(text).toBe(
      [
        "Load test `echo` (concurrency 4, duration 1.5s, limit 40, rate 20/s)",
        "  Requests:   30 in 1.50s (20/s)",
        "  Outcomes:   27 ok, 1 tool errors, 2 errors",
        "  Error rate: 10.00%",
        "  Latency:    min 1 / mean 2.5 / p50 2 / p90 4 / p99 5 / max 6 ms",
        "  Top errors:",
        "    2× Request timed out",
      ].join("\n"),
    );
  });

  it("handles a run where nothing completed", () => {
    const text = formatLoadSummaryHuman({
      concurrency: 1,
      requests: 0,
      ok: 0,
      toolErrors: 0,
      errors: 0,
      errorRate: 0,
      elapsedMs: 0,
      throughput: 0,
      latencyMs: null,
      errorMessages: [],
    });
    expect(text).toContain("Load test (concurrency 1)");
    expect(text).toContain("Error rate: 0.00%");
    expect(text).toContain("Latency:    no calls completed");
    expect(text).not.toContain("Top errors");
    expect(text).not.toContain("Sessions:");
  });

  it("renders the sessions of a multi-connection run, failures included", () => {
    const text = formatLoadSummaryHuman(
      {
        ...SUMMARY,
        errorMessages: [],
        connections: {
          requested: 3,
          opened: 2,
          failed: 1,
          connectMs: { min: 4, mean: 4, p50: 4, p90: 4, p99: 4, max: 4 },
          errorMessages: [{ message: "ECONNREFUSED", count: 1 }],
        },
      },
      PLAIN,
    );
    expect(text).toContain(
      "  Sessions:   2 of 3 opened, 1 failed (connect p50 4 / max 4 ms)\n    1× ECONNREFUSED",
    );
  });

  it("omits connect times when no extra session opened", () => {
    const text = formatLoadSummaryHuman(
      {
        ...SUMMARY,
        connections: {
          requested: 2,
          opened: 1,
          failed: 1,
          connectMs: null,
          errorMessages: [],
        },
      },
      PLAIN,
    );
    expect(text).toContain("  Sessions:   1 of 2 opened, 1 failed");
    expect(text).not.toContain("connect p50");
  });
});

describe("writeRpcOutcome for a load result", () => {
  async function capture(format: "text" | "json"): Promise<string> {
    let out = "";
    const original = process.stdout.write;
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      out += String(chunk);
      const cb = rest.find((r) => typeof r === "function") as
        | (() => void)
        | undefined;
      cb?.();
      return true;
    }) as typeof process.stdout.write;
    try {
      await writeRpcOutcome({ format, style: PLAIN }, "tools/call", "echo", {
        kind: "load",
        summary: SUMMARY,
      });
    } finally {
      process.stdout.write = original;
    }
    return out;
  }

  it("prints the bare summary as JSON", async () => {
    expect(JSON.parse(await capture("json"))).toEqual(SUMMARY);
  });

  it("prints the human summary as text", async () => {
    expect(await capture("text")).toContain("Load test `echo`");
  });
});

/** Deadline for one `runMcp` call that reaches the auto-spawned daemon. */
const DAEMON_COMMAND_MS = 20_000;
/**
 * The longest test here runs three daemon commands in sequence, so its own
 * budget has to exceed all three deadlines (AGENTS.md: an inner budget is
 * strictly smaller than the one enclosing it). Otherwise a stalled command
 * outlives its test and overlaps teardown while `runMcp` still holds the
 * captured stdout/stderr and the env overrides.
 */
const DAEMON_TEST_MS = 3 * DAEMON_COMMAND_MS + 5_000;

describe("mcpdo tools/call --load", { timeout: DAEMON_TEST_MS }, () => {
  let configPath: string | undefined;
  let storageDir: string | undefined;

  afterEach(async () => {
    if (storageDir) {
      const socketPath = path.join(storageDir, "mcpdod.sock");
      if (fs.existsSync(socketPath)) {
        try {
          await callDaemon("daemon/stop", {}, { socketPath, timeoutMs: 2000 });
        } catch {
          // already stopped
        }
      }
      fs.rmSync(storageDir, { recursive: true, force: true });
      storageDir = undefined;
    }
    if (configPath) {
      deleteConfigFile(configPath);
      configPath = undefined;
    }
  });

  function env(): Record<string, string> {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-load-e2e-"));
    return {
      MCP_STORAGE_DIR: storageDir,
      MCP_INSPECTOR_DAEMON_DIR: storageDir,
      MCP_ALLOW_DEFAULT_CONNECTION: "1",
    };
  }

  it("loads a tool over a live connection and leaves it usable", async () => {
    configPath = createSampleTestConfig();
    const e = env();
    expectCliSuccess(
      await runMcp(["connect", "test-stdio", "--config", configPath], {
        env: e,
        timeout: DAEMON_COMMAND_MS,
      }),
    );

    const loaded = await runMcp(
      [
        "tools/call",
        "echo",
        "message:=hi",
        "--load",
        "--load-requests",
        "12",
        "--load-concurrency",
        "3",
        "--format",
        "json",
      ],
      { env: e, timeout: DAEMON_COMMAND_MS },
    );
    expectCliSuccess(loaded);
    expect(JSON.parse(loaded.stdout)).toMatchObject({
      tool: "echo",
      concurrency: 3,
      requestLimit: 12,
      requests: 12,
      ok: 12,
      errors: 0,
      errorRate: 0,
    });

    // The queue slot is released: an ordinary call runs afterwards.
    expectCliSuccess(
      await runMcp(
        ["tools/call", "echo", "message:=after", "--format", "json"],
        {
          env: e,
          timeout: DAEMON_COMMAND_MS,
        },
      ),
    );
  });

  it("fails before loading when the tool does not exist", async () => {
    configPath = createSampleTestConfig();
    const e = env();
    expectCliSuccess(
      await runMcp(["connect", "test-stdio", "--config", configPath], {
        env: e,
        timeout: DAEMON_COMMAND_MS,
      }),
    );
    const result = await runMcp(
      ["tools/call", "no_such_tool", "--load", "--load-requests", "2"],
      { env: e, timeout: DAEMON_COMMAND_MS },
    );
    expect(result.exitCode).toBe(5);
    expect(result.stderr).toContain("Tool 'no_such_tool' not found on server.");
  });

  async function connectStdio(e: Record<string, string>): Promise<void> {
    configPath = createSampleTestConfig();
    expectCliSuccess(
      await runMcp(["connect", "test-stdio", "--config", configPath], {
        env: e,
        timeout: DAEMON_COMMAND_MS,
      }),
    );
  }

  it("prints the summary, then fails a breached threshold with the CLI's code", async () => {
    const e = env();
    await connectStdio(e);
    // A real call never completes in a microsecond, so this p99 always fails.
    const breached = await runMcp(
      [
        "tools/call",
        "echo",
        "message:=hi",
        "--load",
        "--load-requests",
        "4",
        "--load-max-p99",
        "0.001",
        "--format",
        "json",
      ],
      { env: e, timeout: DAEMON_COMMAND_MS },
    );
    expect(breached.exitCode).toBe(EXIT_CODES.LOAD_THRESHOLD_EXCEEDED);
    expect(JSON.parse(breached.stdout)).toMatchObject({ requests: 4, ok: 4 });
    expect(breached.stderr).toContain("load_p99_exceeded");

    // A threshold the run meets leaves the exit code alone.
    expectCliSuccess(
      await runMcp(
        [
          "tools/call",
          "echo",
          "message:=hi",
          "--load",
          "--load-requests",
          "4",
          "--load-max-error-rate",
          "0",
        ],
        { env: e, timeout: DAEMON_COMMAND_MS },
      ),
    );
  });

  it("refuses more than one session over stdio", async () => {
    const e = env();
    await connectStdio(e);
    const result = await runMcp(
      [
        "tools/call",
        "echo",
        "--load",
        "--load-requests",
        "2",
        "--load-connections",
        "2",
      ],
      { env: e, timeout: DAEMON_COMMAND_MS },
    );
    expect(result.exitCode).toBe(EXIT_CODES.USAGE);
    expect(result.stderr).toContain(
      "--load-connections above 1 requires an HTTP or SSE connection",
    );
  });

  it("spreads a run over extra sessions that never become connections", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo("load-sessions", "1.0.0"),
      tools: [createEchoTool()],
    });
    try {
      await server.start();
      configPath = createTestConfig({
        mcpServers: { remote: { type: "streamable-http", url: server.url } },
      });
      const e = env();
      expectCliSuccess(
        await runMcp(["connect", "remote", "--config", configPath], {
          env: e,
          timeout: DAEMON_COMMAND_MS,
        }),
      );
      const loaded = await runMcp(
        [
          "tools/call",
          "echo",
          "message:=hi",
          "--load",
          "--load-requests",
          "9",
          "--load-concurrency",
          "3",
          "--load-connections",
          "3",
          "--format",
          "json",
        ],
        { env: e, timeout: DAEMON_COMMAND_MS },
      );
      expectCliSuccess(loaded);
      expect(JSON.parse(loaded.stdout)).toMatchObject({
        requests: 9,
        ok: 9,
        errors: 0,
        connections: { requested: 3, opened: 3, failed: 0 },
      });

      // The extras belonged to the run: only the connection itself is listed.
      const listed = await runMcp(["connections/list", "--format", "json"], {
        env: e,
        timeout: DAEMON_COMMAND_MS,
      });
      expectCliSuccess(listed);
      expect(
        (
          JSON.parse(listed.stdout) as { connections: { name: string }[] }
        ).connections.map((c) => c.name),
      ).toEqual(["remote"]);
    } finally {
      await server.stop();
    }
  });

  it.each([
    [
      ["tools/call", "echo", "--load-requests", "2"],
      "--load-requests requires --load.",
    ],
    [["tools/call", "--load"], "--load requires a tool name."],
    [
      ["tools/call", "echo", "--load", "--load-concurrency", "0"],
      "--load-concurrency must be a positive integer.",
    ],
    [
      ["tools/call", "echo", "--load-max-p99", "10"],
      "--load-max-p99 requires --load.",
    ],
    [
      ["tools/call", "echo", "--load", "--load-max-error-rate", "5"],
      "--load-max-error-rate must be a number from 0 to 1.",
    ],
    [
      ["tools/call", "echo", "--load", "--load-connections", "0"],
      "--load-connections must be a positive integer.",
    ],
  ])("rejects %j before reaching a daemon", async (args, message) => {
    const result = await runMcp(args, { env: env() });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(message);
  });
});
