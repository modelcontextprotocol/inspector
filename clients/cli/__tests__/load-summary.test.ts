import { describe, it, expect, vi, afterEach } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import { expectCliSuccess, expectValidJson } from "./helpers/assertions.js";
import { fakeClock } from "./helpers/load-clock.js";
import {
  createTestServerHttp,
  createTestServerInfo,
  getTestMcpServerCommand,
} from "@modelcontextprotocol/inspector-test-server";
import {
  CIRCUIT_BREAKER_ERRORS,
  CIRCUIT_BREAKER_MIN_ERRORS,
  LOAD_FLAG_CONFLICT,
  MAX_TOOL_ERROR_MESSAGE_LENGTH,
  NO_TOOL_ERROR_TEXT,
  loadRateShortfallWarning,
  loadSummaryWarnings,
  runLoad,
  toolErrorText,
  type LoadCallOutcome,
  type LoadStop,
  type LoadSummary,
} from "@inspector/core/cli/handlers/load-test.js";
import {
  CliExitCodeError,
  EXIT_CODES,
} from "@inspector/core/cli/error-handler.js";
import {
  assertNotInterrupted,
  withLoadInterrupt,
} from "../src/handlers/load-interrupt.js";

/**
 * The `--load` summary fixes of the v2.14.0 milestone: Ctrl+C keeps the
 * partial summary (#2834), a circuit breaker for a dead server (#2835),
 * success-only latency and tool-error messages (#2836), and the planned
 * versus achieved figures of a `--load-rate` run (#2837).
 */

/**
 * Deliver a signal to the listener `withLoadInterrupt` added, and to nothing
 * else: `process.emit` would also reach the test worker's own SIGINT/SIGTERM
 * handlers, which end the worker. Returns false while no new listener exists.
 */
function signalLoadRun(
  signal: "SIGINT" | "SIGTERM",
  existing: ReturnType<typeof process.listeners>,
): boolean {
  const added = process
    .listeners(signal)
    .find((listener) => !existing.includes(listener));
  if (!added) return false;
  (added as (s: NodeJS.Signals) => void)(signal);
  return true;
}

describe("success and failure latency (#2836)", () => {
  it("times successes apart from failures and counts ok throughput", async () => {
    const clock = fakeClock();
    let n = 0;
    // Every second call fails instantly; the successes take 200ms.
    const call = async (): Promise<LoadCallOutcome> => {
      if (n++ % 2 === 1) return "tool_error";
      clock.advance(200);
      return "ok";
    };
    const summary = await runLoad(
      call,
      { concurrency: 1, requests: 10 },
      clock,
    );
    expect(summary).toMatchObject({
      ok: 5,
      toolErrors: 5,
      elapsedMs: 1000,
      throughput: 10,
      okThroughput: 5,
      latencyMs: { min: 200, p50: 200, p99: 200 },
      errorLatencyMs: { min: 0, max: 0 },
    });
  });

  it("reports no success latency when nothing succeeded", async () => {
    const summary = await runLoad(
      async () => "tool_error",
      { concurrency: 1, requests: 3 },
      fakeClock(),
    );
    expect(summary.latencyMs).toBeNull();
    expect(summary.errorLatencyMs).not.toBeNull();
    expect(summary.okThroughput).toBe(0);
  });

  it("tallies tool-error messages apart from thrown ones", async () => {
    let n = 0;
    const call = async (): Promise<LoadCallOutcome> => {
      const i = n++;
      if (i < 3) return { outcome: "tool_error", message: "rate limited" };
      if (i === 3) return "tool_error";
      throw new Error("boom");
    };
    const summary = await runLoad(
      call,
      { concurrency: 1, requests: 5 },
      fakeClock(),
    );
    expect(summary.toolErrorMessages).toEqual([
      { message: "rate limited", count: 3 },
      { message: NO_TOOL_ERROR_TEXT, count: 1 },
    ]);
    expect(summary.errorMessages).toEqual([{ message: "boom", count: 1 }]);
  });

  describe("toolErrorText", () => {
    it("takes the first non-empty text block, trimmed", () => {
      expect(
        toolErrorText([
          { type: "image", data: "", mimeType: "image/png" },
          null,
          { type: "text", text: "   " },
          { type: "text", text: "  rate limited \n" },
          { type: "text", text: "second" },
        ]),
      ).toBe("rate limited");
    });

    it("caps a long text", () => {
      const text = toolErrorText([{ type: "text", text: "x".repeat(500) }]);
      expect(text).toBe(`${"x".repeat(MAX_TOOL_ERROR_MESSAGE_LENGTH)}…`);
    });

    it("falls back when there is no text to report", () => {
      expect(toolErrorText([])).toBe(NO_TOOL_ERROR_TEXT);
      expect(toolErrorText(undefined)).toBe(NO_TOOL_ERROR_TEXT);
      expect(toolErrorText([{ type: "text", text: 7 }])).toBe(
        NO_TOOL_ERROR_TEXT,
      );
    });
  });
});

describe("circuit breaker (#2835)", () => {
  it(`stops after ${CIRCUIT_BREAKER_ERRORS} thrown calls in a row`, async () => {
    const summary = await runLoad(
      async () => {
        throw new Error("fetch failed");
      },
      { concurrency: 1, requests: 1000 },
      fakeClock(),
    );
    expect(summary.requests).toBe(CIRCUIT_BREAKER_ERRORS);
    expect(summary.stoppedEarly).toEqual({
      reason: "consecutive_errors",
      detail: `${CIRCUIT_BREAKER_ERRORS} calls in a row threw over 0ms; the server looks unavailable`,
    });
    expect(summary.errorMessages).toEqual([
      { message: "fetch failed", count: CIRCUIT_BREAKER_ERRORS },
    ]);
  });

  it("stops a slow run after a second of nothing but thrown calls", async () => {
    const clock = fakeClock();
    const summary = await runLoad(
      async () => {
        clock.advance(250);
        throw new Error("timed out");
      },
      { concurrency: 1, durationMs: 60_000 },
      clock,
    );
    // The first failure lands at 250ms; the fifth, at 1250ms, closes a 1s
    // streak.
    expect(summary.requests).toBe(CIRCUIT_BREAKER_MIN_ERRORS);
    expect(summary.stoppedEarly?.reason).toBe("consecutive_errors");
    // Not measured to the end of a window it never ran to.
    expect(summary.elapsedMs).toBe(1250);
  });

  it("resets on any answer from the server, tool errors included", async () => {
    let n = 0;
    const call = async (): Promise<LoadCallOutcome> => {
      if (n++ % CIRCUIT_BREAKER_ERRORS === 0) return "tool_error";
      throw new Error("flaky");
    };
    const summary = await runLoad(
      call,
      { concurrency: 1, requests: 500 },
      fakeClock(),
    );
    expect(summary.requests).toBe(500);
    expect(summary.stoppedEarly).toBeUndefined();
  });
});

describe("early stops (#2834)", () => {
  it("reports an abort as interrupted by default", async () => {
    const abort = new AbortController();
    let calls = 0;
    const summary = await runLoad(
      async () => {
        if (++calls === 2) abort.abort();
        return "ok";
      },
      { concurrency: 1, requests: 10 },
      fakeClock(),
      abort.signal,
    );
    expect(summary.requests).toBe(2);
    expect(summary.stoppedEarly).toEqual({
      reason: "interrupted",
      detail: "the run was interrupted",
    });
  });

  it("keeps the reason the caller aborted with", async () => {
    const stop: LoadStop = {
      reason: "connection_lost",
      detail: "the connection went error",
    };
    const summary = await runLoad(
      async () => "ok",
      { concurrency: 1, requests: 10 },
      fakeClock(),
      AbortSignal.abort(stop),
    );
    expect(summary.stoppedEarly).toEqual(stop);
  });

  it.each([
    [{ reason: "bogus", detail: "x" }],
    [{ reason: "interrupted" }],
    ["a string"],
    [null],
  ])("does not trust a malformed reason %j", async (reason) => {
    const summary = await runLoad(
      async () => "ok",
      { concurrency: 1, requests: 1 },
      fakeClock(),
      AbortSignal.abort(reason),
    );
    expect(summary.stoppedEarly?.reason).toBe("interrupted");
  });
});

describe("planned and achieved rate (#2837)", () => {
  it("reports the planned starts a saturated run dropped", async () => {
    const clock = fakeClock();
    // Capacity is 10/s (one worker, 100ms calls) against a 100/s target.
    const summary = await runLoad(
      async () => {
        clock.advance(100);
        return "ok";
      },
      { concurrency: 1, durationMs: 1000, rate: 100 },
      clock,
    );
    expect(summary).toMatchObject({
      rate: 100,
      requests: 10,
      plannedStarts: 100,
      droppedSlots: 90,
      achievedRate: 10,
    });
    expect(loadRateShortfallWarning(summary)).toBe(
      "Warning: --load-rate 100/s was not reached: 10 of 100 planned calls started (10/s); 90 slots were dropped because every worker was busy. Raise --load-concurrency or lower --load-rate.",
    );
  });

  it("measures a duration-bound run to the end of its window", async () => {
    const summary = await runLoad(
      async () => "ok",
      { concurrency: 1, durationMs: 5000, rate: 1 },
      fakeClock(),
    );
    expect(summary).toMatchObject({
      requests: 5,
      elapsedMs: 5000,
      throughput: 1,
      plannedStarts: 5,
      droppedSlots: 0,
      achievedRate: 1,
    });
    expect(loadRateShortfallWarning(summary)).toBeUndefined();
  });

  it("plans a request-bound run up to its last start", async () => {
    const summary = await runLoad(
      async () => "ok",
      { concurrency: 1, requests: 3, durationMs: 10_000, rate: 4 },
      fakeClock(),
    );
    // Starts at 0, 250 and 500ms cover the grid to 750ms: exactly 4/s.
    expect(summary).toMatchObject({
      plannedStarts: 3,
      droppedSlots: 0,
      achievedRate: 4,
    });
  });

  it("plans an interrupted run up to the moment it stopped", async () => {
    const clock = fakeClock();
    const abort = new AbortController();
    let calls = 0;
    const summary = await runLoad(
      async () => {
        if (++calls === 3) {
          clock.advance(250);
          abort.abort();
        }
        return "ok";
      },
      { concurrency: 1, durationMs: 10_000, rate: 10 },
      clock,
      abort.signal,
    );
    // Stopped at 450ms: five slots were due, three were started.
    expect(summary).toMatchObject({
      requests: 3,
      plannedStarts: 5,
      droppedSlots: 2,
    });
  });

  it("reports no achieved rate for a window of zero", async () => {
    const summary = await runLoad(
      async () => "ok",
      { concurrency: 1, durationMs: 0, rate: 10 },
      fakeClock(),
    );
    expect(summary).toMatchObject({
      requests: 0,
      plannedStarts: 0,
      droppedSlots: 0,
      achievedRate: 0,
    });
  });

  it("leaves the rate figures out of a run with no rate", async () => {
    const summary = await runLoad(
      async () => "ok",
      { concurrency: 1, requests: 2 },
      fakeClock(),
    );
    expect(summary).not.toHaveProperty("plannedStarts");
    expect(summary).not.toHaveProperty("droppedSlots");
    expect(summary).not.toHaveProperty("achievedRate");
    expect(loadRateShortfallWarning(summary)).toBeUndefined();
  });
});

describe("loadSummaryWarnings", () => {
  const base: LoadSummary = {
    concurrency: 1,
    requests: 1,
    ok: 1,
    toolErrors: 0,
    errors: 0,
    errorRate: 0,
    elapsedMs: 1,
    throughput: 1,
    okThroughput: 1,
    latencyMs: null,
    errorLatencyMs: null,
    errorMessages: [],
    toolErrorMessages: [],
  };

  it("is empty for a run that held its bounds", () => {
    expect(loadSummaryWarnings(base)).toEqual([]);
  });

  it("names an early stop the caller did not ask for, but not an interrupt", () => {
    expect(
      loadSummaryWarnings({
        ...base,
        stoppedEarly: { reason: "consecutive_errors", detail: "50 in a row" },
      }),
    ).toEqual([
      "Warning: the load run stopped early (consecutive_errors): 50 in a row.",
    ]);
    expect(
      loadSummaryWarnings({
        ...base,
        stoppedEarly: { reason: "interrupted", detail: "received SIGINT" },
      }),
    ).toEqual([]);
  });

  it("adds the rate shortfall", () => {
    const warnings = loadSummaryWarnings({
      ...base,
      rate: 10,
      plannedStarts: 10,
      droppedSlots: 5,
      achievedRate: 5,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("--load-rate 10/s was not reached");
  });
});

describe("withLoadInterrupt (#2834)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Run until aborted, then settle with the abort's reason. */
  function untilAborted(signal: AbortSignal): Promise<unknown> {
    return new Promise((resolve) =>
      signal.addEventListener("abort", () => resolve(signal.reason)),
    );
  }

  it("turns the first signal into an abort and says so on stderr", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const existing = process.listeners("SIGTERM");
    const before = existing.length;
    const run = withLoadInterrupt(untilAborted);
    expect(process.listenerCount("SIGTERM")).toBe(before + 1);
    expect(signalLoadRun("SIGTERM", existing)).toBe(true);
    await expect(run).resolves.toEqual({
      reason: "interrupted",
      detail: "received SIGTERM",
    });
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("Interrupted (SIGTERM)"),
    );
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });

  it("exits 130 on the second signal", async () => {
    const exit = vi.fn();
    const existing = process.listeners("SIGINT");
    let finish!: () => void;
    const run = withLoadInterrupt(
      () => new Promise<void>((resolve) => (finish = resolve)),
      { quiet: true, exit },
    );
    signalLoadRun("SIGINT", existing);
    expect(exit).not.toHaveBeenCalled();
    signalLoadRun("SIGINT", existing);
    expect(exit).toHaveBeenCalledWith(EXIT_CODES.INTERRUPTED);
    finish();
    await run;
  });

  it("exits the real process by default on the second signal", async () => {
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const existing = process.listeners("SIGINT");
    let finish!: () => void;
    const run = withLoadInterrupt(
      () => new Promise<void>((resolve) => (finish = resolve)),
      { quiet: true },
    );
    signalLoadRun("SIGINT", existing);
    signalLoadRun("SIGINT", existing);
    expect(exit).toHaveBeenCalledWith(130);
    finish();
    await run;
  });

  it("removes its listeners when the run throws", async () => {
    const before = process.listenerCount("SIGINT");
    await expect(
      withLoadInterrupt(async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");
    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  it("raises exit 130 only for an interrupted summary", () => {
    const summary = {
      requests: 7,
      stoppedEarly: { reason: "interrupted", detail: "received SIGINT" },
    } as LoadSummary;
    let err: unknown;
    try {
      assertNotInterrupted(summary);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliExitCodeError);
    expect(err).toMatchObject({
      exitCode: EXIT_CODES.INTERRUPTED,
      envelope: { code: "interrupted" },
    });
    expect(() =>
      assertNotInterrupted({
        ...summary,
        stoppedEarly: { reason: "consecutive_errors", detail: "x" },
      }),
    ).not.toThrow();
    expect(() =>
      assertNotInterrupted({ ...summary, stoppedEarly: undefined }),
    ).not.toThrow();
  });
});

describe("--load summary fixes (CLI)", () => {
  const { command, args } = getTestMcpServerCommand();

  it("prints the partial summary on Ctrl+C and exits 130 (#2834)", async () => {
    const existing = process.listeners("SIGINT");
    const baseline = existing.length;
    const run = runCli(
      [
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        "message=hi",
        "--load",
        "--load-duration",
        "30",
        "--load-concurrency",
        "2",
        "--format",
        "json",
      ],
      { timeout: 20_000 },
    );
    // Fired once the run is under way, so some calls have completed.
    await vi.waitFor(
      () => expect(signalLoadRun("SIGINT", existing)).toBe(true),
      { timeout: 10_000, interval: 200 },
    );
    const result = await run;
    expect(result.exitCode).toBe(EXIT_CODES.INTERRUPTED);
    const lines = result.stdout.trim().split("\n");
    const { result: summary } = JSON.parse(lines[0]!);
    expect(summary.stoppedEarly).toEqual({
      reason: "interrupted",
      detail: "received SIGINT",
    });
    expect(summary.requests).toBe(summary.ok);
    expect(result.stderr).toContain("Interrupted (SIGINT)");
    const envelope = JSON.parse(result.stderr.trim().split("\n").pop()!);
    expect(envelope.error.code).toBe("interrupted");
    expect(process.listenerCount("SIGINT")).toBe(baseline);
  });

  it.each([
    [["--load-duration", "1"]],
    [["--load", "--app-info"]],
    [["--load", "--load-connections", "3", "--load-concurrency", "2"]],
    [["--load", "--load-connections", "2"]],
  ])(
    "uses the load_flag_conflict envelope code for %j (#2834)",
    async (flags) => {
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        ...flags,
      ]);
      expect(result.exitCode).toBe(EXIT_CODES.USAGE);
      const envelope = JSON.parse(result.stderr.trim().split("\n").pop()!);
      expect(envelope.error.code).toBe(LOAD_FLAG_CONFLICT);
    },
  );

  describe("over HTTP", () => {
    let n = 0;
    const makeServer = () =>
      createTestServerHttp({
        serverInfo: createTestServerInfo("load-summary", "1.0.0"),
        tools: [
          {
            name: "unique",
            description: "Always fails",
            inputSchema: {},
            // The SDK answers a throwing handler with `isError: true`.
            handler: async () => {
              throw new Error(`rate limited`);
            },
          },
          {
            name: "slow",
            description: "Answers after 50ms",
            inputSchema: {},
            handler: async () => {
              n++;
              await new Promise((r) => setTimeout(r, 50));
              return { content: [{ type: "text", text: "ok" }] };
            },
          },
        ],
      });

    let server: ReturnType<typeof makeServer>;
    const http = (tool: string, ...flags: string[]) => [
      server.url,
      "--cli",
      "--transport",
      "http",
      "--method",
      "tools/call",
      "--tool-name",
      tool,
      "--load",
      ...flags,
    ];

    it("tallies the text of isError results (#2836)", async () => {
      server = makeServer();
      await server.start();
      try {
        const result = await runCli(
          http("unique", "--load-requests", "6", "--load-concurrency", "2"),
        );
        expectCliSuccess(result);
        const json = expectValidJson(result);
        expect(json).toMatchObject({ toolErrors: 6, errorMessages: [] });
        expect(json.latencyMs).toBeNull();
        expect(json.toolErrorMessages).toHaveLength(1);
        expect(json.toolErrorMessages[0].count).toBe(6);
        expect(json.toolErrorMessages[0].message).toContain("rate limited");
      } finally {
        await server.stop();
      }
    });

    it("fails --load-max-p99 when no call succeeded (#2836)", async () => {
      server = makeServer();
      await server.start();
      try {
        const result = await runCli(
          http("unique", "--load-requests", "3", "--load-max-p99", "60000"),
        );
        expect(result.exitCode).toBe(EXIT_CODES.LOAD_THRESHOLD_EXCEEDED);
        expect(result.stderr).toContain("no call succeeded");
      } finally {
        await server.stop();
      }
    });

    it("warns when a --load-rate run falls short (#2837)", async () => {
      server = makeServer();
      await server.start();
      try {
        const result = await runCli(
          http(
            "slow",
            "--load-rate",
            "100",
            "--load-concurrency",
            "1",
            "--load-duration",
            "0.5",
          ),
        );
        expectCliSuccess(result);
        const json = expectValidJson(result);
        expect(json.plannedStarts).toBe(50);
        expect(json.droppedSlots).toBeGreaterThan(25);
        expect(json.achievedRate).toBeLessThan(90);
        expect(result.stderr).toContain("Warning: --load-rate 100/s");
        // `--quiet` drops the advisory, not the summary.
        const quiet = await runCli(
          http(
            "slow",
            "--load-rate",
            "100",
            "--load-concurrency",
            "1",
            "--load-duration",
            "0.2",
            "--quiet",
          ),
        );
        expectCliSuccess(quiet);
        expect(quiet.stderr).not.toContain("Warning");
      } finally {
        await server.stop();
      }
    });

    it("stops early when the server dies mid-run (#2835)", async () => {
      server = makeServer();
      await server.start();
      n = 0;
      const run = runCli(
        http(
          "slow",
          "--load-duration",
          "15",
          "--load-concurrency",
          "4",
          "--format",
          "json",
        ),
        { timeout: 20_000 },
      );
      await vi.waitFor(() => expect(n).toBeGreaterThan(4), {
        timeout: 10_000,
      });
      await server.stop();
      const result = await run;
      expectCliSuccess(result);
      const { result: summary } = expectValidJson(result);
      expect(summary.stoppedEarly?.reason).toBe("consecutive_errors");
      expect(summary.errors).toBeGreaterThan(0);
      expect(summary.elapsedMs).toBeLessThan(15_000);
      expect(result.stderr).toContain(
        "Warning: the load run stopped early (consecutive_errors)",
      );
    });
  });
});
