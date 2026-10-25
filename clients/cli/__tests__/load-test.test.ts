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
  runLoadAcrossConnections,
  summarizeLatency,
  type LoadCallOutcome,
  type LoadClock,
} from "@inspector/core/cli/handlers/load-test.js";

/**
 * A clock that only moves when told to, with a timer queue: each `sleep`
 * wakes at an absolute time, and timers fire one at a time in wake order,
 * each on its own macrotask so the woken worker runs (up to its next await)
 * before the clock moves again — as real timers behave. A rate-limited run
 * therefore completes instantly while keeping the schedule it would in real
 * time.
 */
function fakeClock(
  options: { lateUntil?: number; jitter?: number } = {},
): LoadClock & { advance: (ms: number) => void; sleeps: () => number } {
  let t = 1000;
  // A stalled event loop: no timer fires before this many ms into the run.
  const earliestWake = 1000 + (options.lateUntil ?? 0);
  const timers: { wakeAt: number; resolve: () => void }[] = [];
  let pumping = false;
  let sleepCount = 0;
  const pump = (): void => {
    timers.sort((a, b) => a.wakeAt - b.wakeAt);
    const next = timers.shift();
    if (!next) {
      pumping = false;
      return;
    }
    t = Math.max(t, next.wakeAt);
    next.resolve();
    setImmediate(pump);
  };
  return {
    now: () => t,
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        sleepCount++;
        timers.push({
          wakeAt: Math.max(t + ms + (options.jitter ?? 0), earliestWake),
          resolve,
        });
        if (!pumping) {
          pumping = true;
          setImmediate(pump);
        }
      }),
    advance: (ms) => {
      t += ms;
    },
    sleeps: () => sleepCount,
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

    it("keeps an explicit connection count and omits an absent one", () => {
      expect(resolveLoadOptions({ connections: 3, requests: 5 })).toEqual({
        concurrency: DEFAULT_LOAD_CONCURRENCY,
        connections: 3,
        requests: 5,
      });
      expect(resolveLoadOptions({ requests: 5 })).not.toHaveProperty(
        "connections",
      );
    });

    it("refuses more connections than workers, default concurrency included", () => {
      expect(() =>
        resolveLoadOptions({ connections: 3, concurrency: 2 }),
      ).toThrow(
        "--load-connections (3) cannot exceed --load-concurrency (2); every connection needs at least one worker.",
      );
      expect(() =>
        resolveLoadOptions({ connections: DEFAULT_LOAD_CONCURRENCY + 1 }),
      ).toThrow(
        `cannot exceed --load-concurrency (${DEFAULT_LOAD_CONCURRENCY})`,
      );
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

    it("drops missed rate slots instead of bursting to catch up", async () => {
      const clock = fakeClock();
      const starts: number[] = [];
      let n = 0;
      const call = async (): Promise<LoadCallOutcome> => {
        starts.push(clock.now() - 1000);
        if (n++ === 0) clock.advance(1000);
        return "ok";
      };
      await runLoad(call, { concurrency: 1, requests: 5, rate: 10 }, clock);
      // The 1s stall forfeits slots 100..900; spacing resumes from 1000.
      expect(starts).toEqual([0, 1000, 1100, 1200, 1300]);
    });

    it("keeps concurrent workers spaced at the rate", async () => {
      const clock = fakeClock();
      const starts: number[] = [];
      const call = async (): Promise<LoadCallOutcome> => {
        starts.push(clock.now() - 1000);
        return "ok";
      };
      await runLoad(call, { concurrency: 3, requests: 6, rate: 5 }, clock);
      expect([...starts].sort((a, b) => a - b)).toEqual([
        0, 200, 400, 600, 800, 1000,
      ]);
    });

    it("holds the average rate when every timer wakes a little late", async () => {
      const clock = fakeClock({ jitter: 30 });
      const starts: number[] = [];
      const call = async (): Promise<LoadCallOutcome> => {
        starts.push(clock.now() - 1000);
        return "ok";
      };
      await runLoad(
        call,
        { concurrency: 1, durationMs: 1000, rate: 10 },
        clock,
      );
      // 30ms late each time, but on the 100ms grid: ten starts, not eight.
      expect(starts).toEqual([0, 130, 230, 330, 430, 530, 630, 730, 830, 930]);
    });

    it("arms one timer per slot however many workers are idle", async () => {
      const clock = fakeClock();
      const summary = await runLoad(
        async () => "ok",
        { concurrency: 100, requests: 100, rate: 1000 },
        clock,
      );
      expect(summary.requests).toBe(100);
      // Slot 0 starts immediately; each of the other 99 needs one wait.
      expect(clock.sleeps()).toBe(99);
    });

    it("keeps the rate when several workers' timers fire late together", async () => {
      const clock = fakeClock({ lateUntil: 1000 });
      const starts: number[] = [];
      const call = async (): Promise<LoadCallOutcome> => {
        starts.push(clock.now() - 1000);
        return "ok";
      };
      await runLoad(
        call,
        { concurrency: 3, requests: 3, durationMs: 2000, rate: 5 },
        clock,
      );
      // Workers 2 and 3 both wake at 1000; only one may start then.
      expect(starts).toEqual([0, 1000, 1200]);
    });

    it("does not start a call when its timer wakes past the deadline", async () => {
      const clock = fakeClock();
      // Every timer fires 100ms late.
      clock.sleep = async (ms) => clock.advance(ms + 100);
      const starts: number[] = [];
      const call = async (): Promise<LoadCallOutcome> => {
        starts.push(clock.now() - 1000);
        return "ok";
      };
      const summary = await runLoad(
        call,
        { concurrency: 1, durationMs: 100, rate: 20 },
        clock,
      );
      // Slot 50 wakes at 150, past the 100ms window, and is not started.
      expect(starts).toEqual([0]);
      expect(summary.requests).toBe(1);
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

    it("hands each call the index of the worker making it", async () => {
      const seen = new Set<number>();
      await runLoad(
        async (worker) => {
          seen.add(worker);
          await new Promise((r) => setTimeout(r, 1));
          return "ok";
        },
        { concurrency: 3, requests: 9 },
      );
      expect([...seen].sort()).toEqual([0, 1, 2]);
    });
  });

  describe("runLoadAcrossConnections", () => {
    type FakeConnection = {
      id: string;
      calls: number;
      closed: boolean;
      disconnect: () => Promise<void>;
    };
    const fake = (id: string, failClose = false): FakeConnection => {
      const c: FakeConnection = {
        id,
        calls: 0,
        closed: false,
        disconnect: async () => {
          c.closed = true;
          if (failClose) throw new Error(`close ${id} failed`);
        },
      };
      return c;
    };
    const callOn = async (c: FakeConnection): Promise<LoadCallOutcome> => {
      c.calls++;
      await new Promise((r) => setTimeout(r, 1));
      return "ok";
    };

    it("is plain runLoad on the primary, with no connections field, for one connection", async () => {
      const primary = fake("primary");
      let opened = 0;
      const open = async (): Promise<FakeConnection> => {
        opened++;
        return fake("extra");
      };
      for (const connections of [undefined, 1]) {
        const summary = await runLoadAcrossConnections(primary, open, callOn, {
          concurrency: 2,
          requests: 4,
          ...(connections !== undefined && { connections }),
        });
        expect(summary).not.toHaveProperty("connections");
        expect(summary.requests).toBe(4);
      }
      expect(primary.calls).toBe(8);
      expect(primary.closed).toBe(false);
      expect(opened).toBe(0);
    });

    it("spreads workers evenly over every connection and closes only the extras", async () => {
      const primary = fake("primary");
      const extras: FakeConnection[] = [];
      const clock = fakeClock();
      const open = async (): Promise<FakeConnection> => {
        // Opening is timed on the run's clock, before the run starts.
        clock.advance(5);
        const c = fake(`extra-${extras.length}`);
        extras.push(c);
        return c;
      };
      const summary = await runLoadAcrossConnections(
        primary,
        open,
        callOn,
        { concurrency: 6, connections: 3, requests: 30 },
        clock,
      );
      expect(extras).toHaveLength(2);
      expect(primary.calls + extras[0]!.calls + extras[1]!.calls).toBe(30);
      for (const c of [primary, ...extras]) expect(c.calls).toBeGreaterThan(0);
      expect(primary.closed).toBe(false);
      expect(extras.every((c) => c.closed)).toBe(true);
      expect(summary.connections).toEqual({
        requested: 3,
        opened: 3,
        failed: 0,
        connectMs: expect.objectContaining({ min: expect.any(Number) }),
        errorMessages: [],
      });
      expect(summary.connections!.connectMs!.max).toBeGreaterThan(0);
      // Connect time is not call time: the fake calls took no clock time.
      expect(summary.latencyMs).toMatchObject({ max: 0 });
    });

    it("pins worker i to connection i % opened", async () => {
      const primary = fake("primary");
      const extra = fake("extra");
      const seen: string[] = [];
      // Four workers, one call each, over two connections: workers 0 and 2 on
      // the primary, 1 and 3 on the extra.
      await runLoadAcrossConnections(
        primary,
        async () => extra,
        async (c) => {
          seen.push(c.id);
          await new Promise((r) => setTimeout(r, 1));
          return "ok";
        },
        { concurrency: 4, connections: 2, requests: 4 },
      );
      expect(seen).toEqual(["primary", "extra", "primary", "extra"]);
    });

    it("runs on the connections that opened and reports connect failures apart from call errors", async () => {
      const primary = fake("primary");
      const opened: FakeConnection[] = [];
      let n = 0;
      const open = async (): Promise<FakeConnection> => {
        const i = n++;
        if (i === 0) throw new Error("session limit reached");
        if (i === 1) throw "refused";
        const c = fake(`extra-${i}`);
        opened.push(c);
        return c;
      };
      const summary = await runLoadAcrossConnections(primary, open, callOn, {
        concurrency: 4,
        connections: 4,
        requests: 8,
      });
      expect(summary).toMatchObject({
        requests: 8,
        ok: 8,
        errors: 0,
        errorRate: 0,
        errorMessages: [],
        connections: {
          requested: 4,
          opened: 2,
          failed: 2,
          errorMessages: [
            { message: "session limit reached", count: 1 },
            { message: "refused", count: 1 },
          ],
        },
      });
      expect(primary.calls + opened[0]!.calls).toBe(8);
      expect(opened[0]!.closed).toBe(true);
    });

    it("still runs on the primary when every extra fails to open", async () => {
      const primary = fake("primary");
      const summary = await runLoadAcrossConnections(
        primary,
        async () => {
          throw new Error("nope");
        },
        callOn,
        { concurrency: 2, connections: 2, requests: 3 },
      );
      expect(primary.calls).toBe(3);
      expect(summary.connections).toEqual({
        requested: 2,
        opened: 1,
        failed: 1,
        connectMs: null,
        errorMessages: [{ message: "nope", count: 1 }],
      });
    });

    it("closes every extra even when the run throws or a close fails", async () => {
      const primary = fake("primary");
      const extras = [fake("a", true), fake("b")];
      const toOpen = [...extras];
      let i = 0;
      const boom = new Error("clock broke");
      const clock: LoadClock = {
        now: () => {
          // Throw once the run itself starts (after the two connect timings).
          if (i++ >= 4) throw boom;
          return 0;
        },
        sleep: async () => {},
      };
      await expect(
        runLoadAcrossConnections(
          primary,
          async () => toOpen.shift()!,
          callOn,
          { concurrency: 3, connections: 3, requests: 3 },
          clock,
        ),
      ).rejects.toBe(boom);
      expect(primary.closed).toBe(false);
      expect(extras.every((c) => c.closed)).toBe(true);
    });

    it("requires a way to open connections when more than one is asked for", async () => {
      await expect(
        runLoadAcrossConnections(fake("primary"), undefined, callOn, {
          concurrency: 2,
          connections: 2,
          requests: 1,
        }),
      ).rejects.toThrow(
        "--load-connections above 1 needs a way to open more connections.",
      );
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
        "--list-stored-auth",
      ],
      "--load cannot be combined with --list-stored-auth or --print-handoff.",
    ],
    [
      [
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--load",
        "--print-handoff",
        "--server-url",
        "http://localhost:1/mcp",
      ],
      "--load cannot be combined with --list-stored-auth or --print-handoff.",
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
    [
      [
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--load-connections",
        "2",
      ],
      "--load-connections requires --load.",
    ],
    [
      ["--method", "tools/call", "--load", "--load-connections", "0"],
      "--load-connections must be a positive integer.",
    ],
    [
      [
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--load",
        "--load-connections",
        "3",
        "--load-concurrency",
        "2",
      ],
      "--load-connections (3) cannot exceed --load-concurrency (2)",
    ],
    [
      [
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--load",
        "--load-connections",
        "2",
      ],
      "--load-connections above 1 requires an HTTP or SSE server",
    ],
  ])("rejects %j", async (flags, message) => {
    const result = await runCli([command, ...args, "--cli", ...flags]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(message);
  });

  it("keeps the one-connection summary unchanged with --load-connections 1", async () => {
    const result = await runCli([
      ...echoLoad,
      "--load",
      "--load-requests",
      "4",
      "--load-connections",
      "1",
    ]);
    expectCliSuccess(result);
    const json = expectValidJson(result);
    expect(json).toMatchObject({ requests: 4, ok: 4 });
    expect(json).not.toHaveProperty("connections");
  });

  it("spreads the calls over --load-connections separate HTTP sessions", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo("load-sessions", "1.0.0"),
      tools: [
        {
          name: "ping",
          description: "Answers",
          inputSchema: {},
          handler: async () => ({ content: [{ type: "text", text: "pong" }] }),
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
        "ping",
        "--load",
        "--load-requests",
        "12",
        "--load-concurrency",
        "6",
        "--load-connections",
        "3",
      ]);
      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toMatchObject({
        tool: "ping",
        requests: 12,
        ok: 12,
        errorRate: 0,
        connections: {
          requested: 3,
          opened: 3,
          failed: 0,
          errorMessages: [],
        },
      });
      expect(json.connections.connectMs).not.toBeNull();
      const sessions = new Set(
        server
          .getRecordedRequests()
          .filter((r) => r.method === "tools/call")
          .map((r) => r.headers?.["mcp-session-id"]),
      );
      expect(sessions.size).toBe(3);
    } finally {
      await server.stop();
    }
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
