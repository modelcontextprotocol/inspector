import { describe, it, expect } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import {
  expectCliSuccess,
  expectCliFailure,
  expectValidJson,
} from "./helpers/assertions.js";
import {
  getTestMcpServerCommand,
  createTestServerHttp,
  createTestServerInfo,
  createSimpleTaskTool,
  getCrashableTestMcpServerCommand,
  CRASH_SERVER_TOOL_NAME,
} from "@modelcontextprotocol/inspector-test-server";
import {
  DEFAULT_LOAD_CONCURRENCY,
  DEFAULT_LOAD_DURATION_MS,
  MAX_ERROR_KINDS,
  OTHER_ERRORS,
  percentile,
  positiveIntegerParser,
  positiveNumberParser,
  resolveLoadOptions,
  runLoad,
  summarizeLatency,
  type LoadCallOutcome,
  type LoadClock,
} from "@inspector/core/cli/handlers/load-test.js";

/**
 * A clock that only moves when told to. `sleep` advances it by the requested
 * amount, so a rate-limited run completes instantly while still observing
 * the schedule it would keep in real time.
 */
function fakeClock(): LoadClock & { advance: (ms: number) => void } {
  let t = 1000;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

describe("load-test engine", () => {
  describe("percentile / summarizeLatency", () => {
    it("uses nearest-rank percentiles", () => {
      const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
      expect(percentile(sorted, 50)).toBe(50);
      expect(percentile(sorted, 90)).toBe(90);
      expect(percentile(sorted, 99)).toBe(99);
      expect(percentile([7], 99)).toBe(7);
      expect(percentile([1, 2, 3], 0)).toBe(1);
    });

    it("summarizes unsorted samples and returns null for none", () => {
      expect(summarizeLatency([])).toBeNull();
      expect(summarizeLatency([3, 1, 2])).toEqual({
        min: 1,
        mean: 2,
        p50: 2,
        p90: 3,
        p99: 3,
        max: 3,
      });
    });
  });

  describe("flag parsers", () => {
    it("accepts only plain positive integers for integer flags", () => {
      const parse = positiveIntegerParser("--load-requests");
      expect(parse(" 25 ")).toBe(25);
      for (const bad of ["0", "-1", "1.5", "1e3", "0x10", "", "abc"]) {
        expect(() => parse(bad)).toThrow(
          "--load-requests must be a positive integer.",
        );
      }
    });

    it("accepts positive finite numbers for number flags", () => {
      const parse = positiveNumberParser("--load-rate");
      expect(parse("2.5")).toBe(2.5);
      for (const bad of ["0", "-1", "", " ", "Infinity", "abc"]) {
        expect(() => parse(bad)).toThrow(
          "--load-rate must be a positive number.",
        );
      }
    });
  });

  describe("resolveLoadOptions", () => {
    it("defaults to the default concurrency over the default window", () => {
      expect(resolveLoadOptions({})).toEqual({
        concurrency: DEFAULT_LOAD_CONCURRENCY,
        durationMs: DEFAULT_LOAD_DURATION_MS,
      });
    });

    it("drops the default window when a request count bounds the run", () => {
      expect(resolveLoadOptions({ requests: 5, concurrency: 2 })).toEqual({
        concurrency: 2,
        requests: 5,
      });
    });

    it("keeps both bounds and the rate when all are given", () => {
      expect(
        resolveLoadOptions({ durationSec: 1.5, requests: 5, rate: 3 }),
      ).toEqual({
        concurrency: DEFAULT_LOAD_CONCURRENCY,
        durationMs: 1500,
        requests: 5,
        rate: 3,
      });
    });
  });

  describe("runLoad", () => {
    it("starts exactly the request count and never exceeds concurrency", async () => {
      let inFlight = 0;
      let peak = 0;
      const call = async (): Promise<LoadCallOutcome> => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return "ok";
      };
      const summary = await runLoad(call, { concurrency: 4, requests: 23 });
      expect(summary.requests).toBe(23);
      expect(summary.ok).toBe(23);
      expect(summary.requestLimit).toBe(23);
      expect(peak).toBe(4);
      expect(summary.errorRate).toBe(0);
      expect(summary.latencyMs).not.toBeNull();
      expect(summary.throughput).toBeGreaterThan(0);
    });

    it("classifies ok, tool errors and thrown errors", async () => {
      let n = 0;
      const call = async (): Promise<LoadCallOutcome> => {
        const i = n++;
        if (i % 4 === 1) return "tool_error";
        if (i % 4 === 2) throw new Error("boom");
        // A non-Error rejection is still counted, by its string form.
        if (i % 4 === 3) throw "raw";
        return "ok";
      };
      const summary = await runLoad(
        call,
        { concurrency: 1, requests: 8 },
        fakeClock(),
      );
      expect(summary).toMatchObject({
        requests: 8,
        ok: 2,
        toolErrors: 2,
        errors: 4,
        errorRate: 0.75,
        errorMessages: [
          { message: "boom", count: 2 },
          { message: "raw", count: 2 },
        ],
      });
    });

    it("keeps a rare error visible in the error rate", async () => {
      let n = 0;
      const call = async (): Promise<LoadCallOutcome> =>
        n++ === 0 ? "tool_error" : "ok";
      const summary = await runLoad(
        call,
        { concurrency: 1, requests: 3000 },
        fakeClock(),
      );
      expect(summary.errorRate).toBe(0.0003);
    });

    it("folds error kinds past the cap into one (other) entry", async () => {
      let n = 0;
      const call = async (): Promise<LoadCallOutcome> => {
        throw new Error(`request ${n++} failed`);
      };
      const summary = await runLoad(
        call,
        { concurrency: 1, requests: MAX_ERROR_KINDS + 3 },
        fakeClock(),
      );
      expect(summary.errorMessages).toHaveLength(MAX_ERROR_KINDS + 1);
      expect(summary.errorMessages.at(-1)).toEqual({
        message: OTHER_ERRORS,
        count: 3,
      });
    });

    it("stops starting calls at the deadline and lets in-flight ones finish", async () => {
      const clock = fakeClock();
      const call = async (): Promise<LoadCallOutcome> => {
        clock.advance(100);
        return "ok";
      };
      const summary = await runLoad(
        call,
        { concurrency: 1, durationMs: 1000 },
        clock,
      );
      // Calls start at 0, 100, …, 900ms; the one started at 900 ends at 1000.
      expect(summary.requests).toBe(10);
      expect(summary.durationMs).toBe(1000);
      expect(summary.elapsedMs).toBe(1000);
      expect(summary.throughput).toBe(10);
      expect(summary.latencyMs).toMatchObject({ min: 100, max: 100 });
    });

    it("spaces starts evenly at the rate and never sleeps past the window", async () => {
      const clock = fakeClock();
      const starts: number[] = [];
      const call = async (): Promise<LoadCallOutcome> => {
        starts.push(clock.now());
        return "ok";
      };
      const summary = await runLoad(
        call,
        { concurrency: 1, durationMs: 1000, rate: 4 },
        clock,
      );
      expect(starts.map((t) => t - 1000)).toEqual([0, 250, 500, 750]);
      expect(summary.rate).toBe(4);
      expect(summary.requests).toBe(4);
    });

    it("does not sleep for a slot whose time has already passed", async () => {
      const clock = fakeClock();
      const call = async (): Promise<LoadCallOutcome> => {
        clock.advance(500);
        return "ok";
      };
      const summary = await runLoad(
        call,
        { concurrency: 1, requests: 3, rate: 10 },
        clock,
      );
      // Each call outlasts its 100ms slot, so the schedule never holds one back.
      expect(summary.elapsedMs).toBe(1500);
    });

    it("reports an empty run without dividing by zero", async () => {
      const summary = await runLoad(
        async () => "ok",
        { concurrency: 2, durationMs: 0 },
        fakeClock(),
      );
      expect(summary).toMatchObject({
        requests: 0,
        errorRate: 0,
        throughput: 0,
        latencyMs: null,
        errorMessages: [],
      });
    });
  });
});

describe("--load (CLI)", () => {
  const { command, args } = getTestMcpServerCommand();
  const echoLoad = [
    command,
    ...args,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    "message=hi",
  ];

  it("prints a summary of the requested number of calls", async () => {
    const result = await runCli([
      ...echoLoad,
      "--load",
      "--load-requests",
      "30",
      "--load-concurrency",
      "5",
    ]);
    expectCliSuccess(result);
    const json = expectValidJson(result);
    expect(json).toMatchObject({
      tool: "echo",
      concurrency: 5,
      requestLimit: 30,
      requests: 30,
      ok: 30,
      toolErrors: 0,
      errors: 0,
      errorRate: 0,
    });
    expect(json.durationMs).toBeUndefined();
    expect(json.latencyMs.p99).toBeGreaterThanOrEqual(json.latencyMs.p50);
  });

  it("wraps the summary in the result envelope with --format json", async () => {
    const result = await runCli([
      ...echoLoad,
      "--load",
      "--load-duration",
      "0.2",
      "--load-rate",
      "20",
      "--format",
      "json",
    ]);
    expectCliSuccess(result);
    const { result: summary } = expectValidJson(result);
    expect(summary).toMatchObject({ tool: "echo", durationMs: 200, rate: 20 });
    expect(summary.requests).toBeGreaterThan(0);
    expect(summary.requests).toBeLessThanOrEqual(4);
  });

  it("fails before loading when the tool does not exist", async () => {
    const result = await runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "tools/call",
      "--tool-name",
      "no_such_tool",
      "--load",
      "--load-requests",
      "3",
    ]);
    expect(result.exitCode).toBe(5);
    expect(result.stderr).toContain("Tool 'no_such_tool' not found on server.");
  });

  it("requires a tool name", async () => {
    const result = await runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "tools/call",
      "--load",
    ]);
    expectCliFailure(result);
    expect(result.stderr).toContain("--load requires --tool-name.");
  });

  it.each([
    [
      ["--method", "tools/list", "--load"],
      "--load requires --method tools/call.",
    ],
    [
      ["--method", "tools/call", "--tool-name", "echo", "--load", "--app-info"],
      "--load cannot be combined with --app-info.",
    ],
    [
      [
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--load",
        "--output",
        "out.json",
      ],
      "--load cannot be combined with --output or --output-format",
    ],
    [
      [
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--load-concurrency",
        "2",
      ],
      "--load-concurrency requires --load.",
    ],
    [
      ["--method", "tools/call", "--tool-name", "echo", "--load-duration", "1"],
      "--load-duration requires --load.",
    ],
    [
      ["--method", "tools/call", "--tool-name", "echo", "--load-requests", "1"],
      "--load-requests requires --load.",
    ],
    [
      ["--method", "tools/call", "--tool-name", "echo", "--load-rate", "1"],
      "--load-rate requires --load.",
    ],
    [
      ["--method", "tools/call", "--load", "--load-concurrency", "0"],
      "--load-concurrency must be a positive integer.",
    ],
  ])("rejects %j", async (flags, message) => {
    const result = await runCli([command, ...args, "--cli", ...flags]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(message);
  });

  it("counts a result carrying isError as a tool error", async () => {
    let n = 0;
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo("load-mixed", "1.0.0"),
      tools: [
        {
          name: "flaky",
          description: "Succeeds and fails in turn",
          inputSchema: {},
          // The SDK answers a throwing handler with `isError: true`.
          handler: async () => {
            if (n++ % 2 === 1) throw new Error("flaky refused");
            return { content: [{ type: "text", text: "flaky" }] };
          },
        },
      ],
    });
    try {
      await server.start();
      const result = await runCli([
        server.url,
        "--cli",
        "--transport",
        "http",
        "--method",
        "tools/call",
        "--tool-name",
        "flaky",
        "--load",
        "--load-requests",
        "8",
        "--load-concurrency",
        "1",
      ]);
      expectCliSuccess(result);
      expect(expectValidJson(result)).toMatchObject({
        requests: 8,
        ok: 4,
        toolErrors: 4,
        errors: 0,
        errorRate: 0.5,
        errorMessages: [],
      });
    } finally {
      await server.stop();
    }
  });

  it("counts calls that throw, and keeps going, when the server dies", async () => {
    const crashable = getCrashableTestMcpServerCommand();
    const result = await runCli([
      crashable.command,
      ...crashable.args,
      "--cli",
      "--method",
      "tools/call",
      "--tool-name",
      CRASH_SERVER_TOOL_NAME,
      "--load",
      "--load-requests",
      "3",
      "--load-concurrency",
      "1",
    ]);
    // The run completed and reported; the failures are in the summary.
    expectCliSuccess(result);
    const json = expectValidJson(result);
    expect(json).toMatchObject({
      requests: 3,
      ok: 0,
      toolErrors: 0,
      errors: 3,
      errorRate: 1,
    });
    expect(
      json.errorMessages.reduce(
        (sum: number, e: { count: number }) => sum + e.count,
        0,
      ),
    ).toBe(3);
  });

  it("loads a taskSupport: required tool through the task path", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo("load-tasks", "1.0.0"),
      tools: [createSimpleTaskTool("simple_task", 10)],
      tasks: { list: true, cancel: true },
      logging: true,
    });
    try {
      await server.start();
      const result = await runCli([
        server.url,
        "--cli",
        "--transport",
        "http",
        "--method",
        "tools/call",
        "--tool-name",
        "simple_task",
        "--load",
        "--load-requests",
        "3",
        "--load-concurrency",
        "3",
      ]);
      expectCliSuccess(result);
      expect(expectValidJson(result)).toMatchObject({
        tool: "simple_task",
        requests: 3,
        ok: 3,
      });
    } finally {
      await server.stop();
    }
  });
});
