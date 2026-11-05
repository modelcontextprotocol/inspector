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
import { unixDaemonOnly } from "./helpers/platform.js";

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
  okThroughput: 18,
  latencyMs: { min: 1, mean: 2.5, p50: 2, p90: 4, p99: 5, max: 6 },
  errorLatencyMs: null,
  errorMessages: [{ message: "Request timed out", count: 2 }],
  toolErrorMessages: [],
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

  describe("--load-scenario (#2839)", () => {
    let dir: string | undefined;
    afterEach(() => {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    });
    function scenarioFile(content: string): string {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpdo-scenario-"));
      const file = path.join(dir, "scenario.json");
      fs.writeFileSync(file, content);
      return file;
    }

    it("reads the file in the front end and needs no tool name", () => {
      const file = scenarioFile(
        JSON.stringify([{ method: "resources/read", uri: "test://env" }]),
      );
      expect(
        resolveLoadFlags({ load: true, loadScenario: file, loadRequests: 2 }),
      ).toEqual({
        options: {
          concurrency: DEFAULT_LOAD_CONCURRENCY,
          requests: 2,
          scenario: {
            steps: [
              {
                name: "resources/read test://env",
                weight: 1,
                method: "resources/read",
                uri: "test://env",
              },
            ],
          },
        },
      });
    });

    it.each([
      [{ toolName: "echo" }, "a tool name"],
      [{ toolArg: { message: "hi" } }, "tool arguments"],
      [{ toolMetadata: { a: "b" } }, "--tool-metadata"],
    ])("refuses %j alongside a scenario", (flags, what) => {
      expect(() =>
        resolveLoadFlags({ load: true, loadScenario: "s.json", ...flags }),
      ).toThrow(
        expect.objectContaining({
          message: `--load-scenario cannot be combined with ${what}; each scenario step names its own tool and arguments.`,
          envelope: expect.objectContaining({ code: "load_flag_conflict" }),
        }),
      );
    });

    it("accepts empty tool arguments and metadata", () => {
      const file = scenarioFile(
        JSON.stringify([{ method: "tools/call", tool: "echo" }]),
      );
      expect(
        resolveLoadFlags({
          load: true,
          loadScenario: file,
          toolArg: {},
          toolMetadata: {},
        })?.options.scenario?.steps,
      ).toHaveLength(1);
    });

    it("reports a bad file as load_scenario_invalid", () => {
      const file = scenarioFile("[]");
      expect(() =>
        resolveLoadFlags({ load: true, loadScenario: file }),
      ).toThrow(
        expect.objectContaining({
          exitCode: EXIT_CODES.USAGE,
          envelope: expect.objectContaining({ code: "load_scenario_invalid" }),
        }),
      );
    });

    it("requires --load", () => {
      expect(() => resolveLoadFlags({ loadScenario: "s.json" })).toThrow(
        "--load-scenario requires --load.",
      );
    });
  });
});

describe("resolveLoadFlags with varying arguments (#2840)", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
  function argsFile(content: string): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpdo-args-"));
    const file = path.join(dir, "args.ndjson");
    fs.writeFileSync(file, content);
    return file;
  }

  it("reads the rows in the front end, in turn by default", () => {
    const file = argsFile('{"q":"a"}\n{"q":"b"}\n');
    expect(
      resolveLoadFlags({ load: true, toolName: "echo", loadArgsFile: file })
        ?.options.argRows,
    ).toEqual({ rows: [{ q: "a" }, { q: "b" }], order: "sequential" });
    expect(
      resolveLoadFlags({
        load: true,
        toolName: "echo",
        loadArgsFile: file,
        loadArgsRandom: true,
      })?.options.argRows?.order,
    ).toBe("random");
  });

  it.each([
    [
      { loadArgsRandom: true },
      "--load-args-random requires --load-args-file.",
      "load_flag_conflict",
    ],
    [
      { toolArg: { n: "{{rand:4-1}}" } },
      "tool arguments.n: {{rand:4-1}} needs safe integer bounds with min <= max.",
      "load_args_invalid",
    ],
  ])("refuses %j", (flags, message, code) => {
    expect(() =>
      resolveLoadFlags({ load: true, toolName: "echo", ...flags }),
    ).toThrow(
      expect.objectContaining({
        message,
        envelope: expect.objectContaining({ code }),
      }),
    );
  });

  it("refuses an args file alongside a scenario", () => {
    expect(() =>
      resolveLoadFlags({
        load: true,
        loadScenario: "s.json",
        loadArgsFile: "a.ndjson",
      }),
    ).toThrow("--load-args-file cannot be combined with --load-scenario");
  });

  it("reports a bad args file as load_args_invalid", () => {
    const file = argsFile("[1]");
    expect(() =>
      resolveLoadFlags({ load: true, toolName: "echo", loadArgsFile: file }),
    ).toThrow(
      expect.objectContaining({
        envelope: expect.objectContaining({ code: "load_args_invalid" }),
      }),
    );
  });

  it.each([
    [{ loadArgsFile: "a.ndjson" }, "--load-args-file requires --load."],
    [{ loadArgsRandom: true }, "--load-args-random requires --load."],
  ])("requires --load for %j", (flags, message) => {
    expect(() => resolveLoadFlags({ toolName: "echo", ...flags })).toThrow(
      message,
    );
  });
});

describe("formatLoadSummaryHuman", () => {
  it("renders bounds, outcomes, latency and top errors", () => {
    const text = formatLoadSummaryHuman(SUMMARY, PLAIN);
    expect(text).toBe(
      [
        "Load test `echo` (concurrency 4, duration 1.5s, limit 40, rate 20/s)",
        "  Requests:   30 in 1.50s (20/s, 18/s ok)",
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
      okThroughput: 0,
      latencyMs: null,
      errorLatencyMs: null,
      errorMessages: [],
      toolErrorMessages: [],
    });
    expect(text).toContain("Load test (concurrency 1)");
    expect(text).toContain("Error rate: 0.00%");
    expect(text).toContain("Latency:    no calls succeeded");
    expect(text).not.toContain("Failed in:");
    expect(text).not.toContain("Rate:");
    expect(text).not.toContain("Stopped early");
    expect(text).not.toContain("Top errors");
    expect(text).not.toContain("Sessions:");
  });

  it("renders failure latency, tool errors, the rate shortfall and an early stop", () => {
    const text = formatLoadSummaryHuman(
      {
        ...SUMMARY,
        plannedStarts: 30,
        droppedSlots: 12,
        achievedRate: 12,
        errorLatencyMs: { min: 0, mean: 1, p50: 1, p90: 2, p99: 2, max: 2 },
        toolErrorMessages: [{ message: "rate limited", count: 1 }],
        stoppedEarly: {
          reason: "consecutive_errors",
          detail:
            "50 calls in a row threw over 3ms; the server looks unavailable",
        },
      },
      PLAIN,
    );
    expect(text).toContain(
      "  Rate:       12/s achieved; 30 planned, 12 dropped\n",
    );
    expect(text).toContain(
      "  Failed in:  min 0 / mean 1 / p50 1 / p90 2 / p99 2 / max 2 ms\n",
    );
    expect(text).toContain("  Top tool errors:\n    1× rate limited");
    expect(text).toContain(
      "  Stopped early (consecutive_errors): 50 calls in a row threw over 3ms; the server looks unavailable",
    );
    // A rate held in full reports nothing dropped.
    expect(
      formatLoadSummaryHuman(
        { ...SUMMARY, plannedStarts: 30, droppedSlots: 0, achievedRate: 20 },
        PLAIN,
      ),
    ).toContain("  Rate:       20/s achieved; 30 planned, 0 dropped");
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

describe("formatLoadSummaryHuman with a scenario (#2839)", () => {
  it("names the scenario and renders each step under the totals", () => {
    const text = formatLoadSummaryHuman(
      {
        ...SUMMARY,
        tool: undefined,
        steps: [
          {
            name: "search",
            method: "tools/call",
            target: "search",
            weight: 3,
            requests: 20,
            ok: 19,
            toolErrors: 1,
            errors: 0,
            errorRate: 0.05,
            throughput: 13.33,
            okThroughput: 12.67,
            latencyMs: { min: 1, mean: 2, p50: 2, p90: 3, p99: 4, max: 5 },
            errorLatencyMs: null,
            errorMessages: [],
            toolErrorMessages: [{ message: "busy", count: 1 }],
          },
          {
            name: "resources/read test://doc",
            method: "resources/read",
            target: "test://doc",
            weight: 1,
            requests: 10,
            ok: 10,
            toolErrors: 0,
            errors: 0,
            errorRate: 0,
            throughput: 6.67,
            okThroughput: 6.67,
            latencyMs: null,
            errorLatencyMs: null,
            errorMessages: [],
            toolErrorMessages: [],
          },
        ],
      },
      PLAIN,
    );
    expect(text.split("\n")[0]).toBe(
      "Load test scenario (2 steps) (concurrency 4, duration 1.5s, limit 40, rate 20/s)",
    );
    expect(text).toContain(
      [
        "  Steps:",
        "    `search` (tools/call search, weight 3)",
        "      20 requests (13.33/s): 19 ok, 1 tool errors, 0 errors (5.00%); p50 2 / p99 4 ms",
        "      1× busy",
        "    `resources/read test://doc` (resources/read test://doc, weight 1)",
        "      10 requests (6.67/s): 10 ok, 0 tool errors, 0 errors (0.00%); no calls succeeded",
      ].join("\n"),
    );
  });

  it("says step for a one-step scenario", () => {
    const text = formatLoadSummaryHuman(
      { ...SUMMARY, tool: undefined, steps: [] },
      PLAIN,
    );
    expect(text).toMatch(/^Load test scenario \(0 steps\)/);
    const one = formatLoadSummaryHuman(
      {
        ...SUMMARY,
        tool: undefined,
        steps: [
          {
            name: "p",
            method: "prompts/get",
            target: "p",
            weight: 1,
            requests: 0,
            ok: 0,
            toolErrors: 0,
            errors: 0,
            errorRate: 0,
            throughput: 0,
            okThroughput: 0,
            latencyMs: null,
            errorLatencyMs: null,
            errorMessages: [],
            toolErrorMessages: [],
          },
        ],
      },
      PLAIN,
    );
    expect(one).toMatch(/^Load test scenario \(1 step\)/);
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

// Skipped on win32: needs a live daemon / Unix socket (helpers/platform.ts, #2748).
describe.skipIf(unixDaemonOnly)(
  "mcpdo tools/call --load",
  { timeout: DAEMON_TEST_MS },
  () => {
    let configPath: string | undefined;
    let storageDir: string | undefined;

    afterEach(async () => {
      if (storageDir) {
        const socketPath = path.join(storageDir, "mcpdod.sock");
        if (fs.existsSync(socketPath)) {
          try {
            await callDaemon(
              "daemon/stop",
              {},
              { socketPath, timeoutMs: 2000 },
            );
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
      expect(result.stderr).toContain(
        "Tool 'no_such_tool' not found on server.",
      );
    });

    it("runs a --load-scenario mix over a live connection (#2839)", async () => {
      const e = env();
      await connectStdio(e);
      const dir = fs.mkdtempSync(path.join(storageDir!, "scenario-"));
      const file = path.join(dir, "scenario.json");
      fs.writeFileSync(
        file,
        JSON.stringify([
          { method: "tools/call", tool: "echo", args: { message: "hi" } },
          { method: "resources/read", uri: "test://env" },
        ]),
      );
      const result = await runMcp(
        [
          "tools/call",
          "--load",
          "--load-scenario",
          file,
          "--load-requests",
          "6",
          "--format",
          "json",
        ],
        { env: e, timeout: DAEMON_COMMAND_MS },
      );
      expectCliSuccess(result);
      const summary = JSON.parse(result.stdout) as LoadSummary;
      expect(summary).toMatchObject({ requests: 6, ok: 6 });
      expect(summary.steps!.map((s) => [s.name, s.ok])).toEqual([
        ["tools/call echo", 3],
        ["resources/read test://env", 3],
      ]);
    });

    it("sends --load-args-file rows through the daemon (#2840)", async () => {
      const e = env();
      await connectStdio(e);
      const file = path.join(storageDir!, "args.ndjson");
      // Every second row breaks echo's `message: string` schema, so the
      // failure count shows the rows reached the daemon's calls.
      fs.writeFileSync(file, '{"message":"ok-{{seq}}"}\n{"message":5}\n');
      const result = await runMcp(
        [
          "tools/call",
          "echo",
          "--load",
          "--load-args-file",
          file,
          "--load-requests",
          "4",
          "--load-concurrency",
          "1",
          "--format",
          "json",
        ],
        { env: e, timeout: DAEMON_COMMAND_MS },
      );
      expectCliSuccess(result);
      const summary = JSON.parse(result.stdout) as LoadSummary;
      expect(summary.requests).toBe(4);
      expect(summary.ok).toBe(2);
      expect(summary.toolErrors + summary.errors).toBe(2);
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

    it("warns on stderr when a --load-rate run falls short (#2837)", async () => {
      const e = env();
      await connectStdio(e);
      // No single worker starts 100k calls a second.
      const result = await runMcp(
        [
          "tools/call",
          "echo",
          "message:=hi",
          "--load",
          "--load-rate",
          "100000",
          "--load-concurrency",
          "1",
          "--load-duration",
          "0.3",
          "--format",
          "json",
        ],
        { env: e, timeout: DAEMON_COMMAND_MS },
      );
      expectCliSuccess(result);
      const summary = JSON.parse(result.stdout);
      expect(summary).toMatchObject({ rate: 100000, plannedStarts: 30000 });
      expect(summary.droppedSlots).toBeGreaterThan(0);
      expect(result.stderr).toContain("Warning: --load-rate 100000/s");
    });

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
  },
);
