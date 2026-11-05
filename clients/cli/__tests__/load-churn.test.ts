import { describe, it, expect } from "vitest";
import {
  createTestServerHttp,
  createTestServerInfo,
  getTestMcpServerCommand,
} from "@modelcontextprotocol/inspector-test-server";
import { runCli } from "./helpers/cli-runner.js";
import { expectCliSuccess, expectValidJson } from "./helpers/assertions.js";
import { fakeClock } from "./helpers/load-clock.js";
import {
  DEFAULT_LOAD_CHURN_CALLS,
  resolveLoadOptions,
  runLoadAcrossConnections,
  type LoadCallOutcome,
  type LoadSummary,
} from "@inspector/core/cli/handlers/load-test.js";
import { formatLoadSummaryHuman } from "@inspector/core/cli/handlers/load-format.js";
import { compareLoadToBaseline } from "@inspector/core/cli/handlers/load-baseline.js";

/**
 * `--load-churn` (#2912): every worker opens a session, makes N calls on it,
 * closes it, and repeats.
 */

type FakeConnection = {
  id: number;
  calls: number;
  closed: boolean;
  disconnect: () => Promise<void>;
};

function opener(options: { failEvery?: number; failClose?: boolean } = {}) {
  const made: FakeConnection[] = [];
  let attempts = 0;
  const open = async (): Promise<FakeConnection> => {
    attempts++;
    if (options.failEvery !== undefined && attempts % options.failEvery === 0) {
      throw new Error("session refused");
    }
    const c: FakeConnection = {
      id: made.length,
      calls: 0,
      closed: false,
      disconnect: async () => {
        c.closed = true;
        if (options.failClose) throw new Error("close failed");
      },
    };
    made.push(c);
    return c;
  };
  return { open, made };
}

const callOn = async (c: FakeConnection): Promise<LoadCallOutcome> => {
  if (c.closed) throw new Error("call on a closed session");
  c.calls++;
  await new Promise((r) => setTimeout(r, 1));
  return "ok";
};

const primary: FakeConnection = {
  id: -1,
  calls: 0,
  closed: false,
  disconnect: async () => {
    primary.closed = true;
  },
};

describe("resolveLoadOptions with --load-churn", () => {
  it("defaults to one call per session", () => {
    expect(resolveLoadOptions({ churn: true, requests: 5 }).churn).toEqual({
      callsPerSession: DEFAULT_LOAD_CHURN_CALLS,
    });
    expect(DEFAULT_LOAD_CHURN_CALLS).toBe(1);
    expect(
      resolveLoadOptions({ churn: true, churnCalls: 3, requests: 5 }).churn,
    ).toEqual({ callsPerSession: 3 });
    expect(resolveLoadOptions({ requests: 5 })).not.toHaveProperty("churn");
  });

  it("refuses --load-churn-calls without --load-churn", () => {
    expect(() => resolveLoadOptions({ churnCalls: 2 })).toThrow(
      "--load-churn-calls requires --load-churn.",
    );
  });

  it("refuses --load-churn with --load-connections", () => {
    expect(() =>
      resolveLoadOptions({ churn: true, connections: 2, concurrency: 4 }),
    ).toThrow("--load-churn cannot be combined with --load-connections");
  });
});

describe("runLoadAcrossConnections with churn", () => {
  it("opens a session per call by default and closes every one", async () => {
    const { open, made } = opener();
    const closed: FakeConnection[] = [];
    const summary = await runLoadAcrossConnections(
      primary,
      open,
      callOn,
      { concurrency: 2, requests: 6, churn: { callsPerSession: 1 } },
      undefined,
      undefined,
      undefined,
      undefined,
      (c) => closed.push(c),
    );
    expect(summary).toMatchObject({ requests: 6, ok: 6, errors: 0 });
    expect(summary.churn).toMatchObject({
      callsPerSession: 1,
      opened: 6,
      failed: 0,
      closeFailed: 0,
      errorMessages: [],
    });
    expect(summary.churn!.connectMs).not.toBeNull();
    expect(made.every((c) => c.calls === 1 && c.closed)).toBe(true);
    expect(closed).toHaveLength(6);
    expect(primary.calls).toBe(0);
    expect(primary.closed).toBe(false);
    expect(summary).not.toHaveProperty("connections");
  });

  it("makes --load-churn-calls calls per session", async () => {
    const { open, made } = opener();
    const summary = await runLoadAcrossConnections(primary, open, callOn, {
      concurrency: 1,
      requests: 7,
      churn: { callsPerSession: 3 },
    });
    expect(summary.requests).toBe(7);
    // 3 + 3 + 1: the last session is closed when the run ends.
    expect(made.map((c) => c.calls)).toEqual([3, 3, 1]);
    expect(made.every((c) => c.closed)).toBe(true);
    expect(summary.churn!.opened).toBe(3);
  });

  it("keeps connecting out of the call latency", async () => {
    const clock = fakeClock();
    const open = async (): Promise<FakeConnection> => {
      clock.advance(50);
      return opener().open();
    };
    const summary = await runLoadAcrossConnections(
      primary,
      open,
      async () => {
        clock.advance(2);
        return "ok";
      },
      { concurrency: 1, requests: 3, churn: { callsPerSession: 1 } },
      clock,
    );
    expect(summary.latencyMs!.max).toBe(2);
    expect(summary.churn!.connectMs!.p50).toBe(50);
  });

  it("counts a failed open apart from the calls, spending its slot", async () => {
    const { open } = opener({ failEvery: 2 });
    const summary = await runLoadAcrossConnections(primary, open, callOn, {
      concurrency: 1,
      requests: 6,
      churn: { callsPerSession: 1 },
    });
    expect(summary).toMatchObject({ requests: 3, ok: 3, errors: 0 });
    expect(summary.churn).toMatchObject({
      opened: 3,
      failed: 3,
      errorMessages: [{ message: "session refused", count: 3 }],
    });
  });

  it("trips the circuit breaker when no session opens", async () => {
    const summary = await runLoadAcrossConnections(
      primary,
      async (): Promise<FakeConnection> => {
        throw new Error("connection refused");
      },
      callOn,
      { concurrency: 2, durationMs: 60_000, churn: { callsPerSession: 1 } },
    );
    expect(summary.stoppedEarly?.reason).toBe("consecutive_errors");
    expect(summary.requests).toBe(0);
    expect(summary.churn!.opened).toBe(0);
    expect(summary.churn!.failed).toBeGreaterThanOrEqual(50);
    expect(summary.churn!.connectMs).toBeNull();
  });

  it("counts a failed close and carries on", async () => {
    const { open } = opener({ failClose: true });
    const summary = await runLoadAcrossConnections(primary, open, callOn, {
      concurrency: 1,
      requests: 2,
      churn: { callsPerSession: 1 },
    });
    expect(summary).toMatchObject({ requests: 2, ok: 2 });
    expect(summary.churn!.closeFailed).toBe(2);
  });

  it("closes a session opened just before the run was stopped", async () => {
    const stop = new AbortController();
    const made: FakeConnection[] = [];
    const open = async (): Promise<FakeConnection> => {
      const c = await opener().open();
      made.push(c);
      // Interrupted between connecting and calling.
      stop.abort();
      return c;
    };
    const summary = await runLoadAcrossConnections(
      primary,
      open,
      callOn,
      { concurrency: 1, requests: 5, churn: { callsPerSession: 1 } },
      undefined,
      stop.signal,
    );
    expect(summary.stoppedEarly?.reason).toBe("interrupted");
    expect(summary.requests).toBe(0);
    expect(made).toHaveLength(1);
    expect(made[0]!.closed).toBe(true);
    expect(made[0]!.calls).toBe(0);
  });

  it("churns through a warm-up and through stages", async () => {
    const warm = opener();
    const warmed = await runLoadAcrossConnections(primary, warm.open, callOn, {
      concurrency: 1,
      durationMs: 30,
      warmupMs: 10,
      churn: { callsPerSession: 1 },
    });
    expect(warmed.warmup!.requests).toBeGreaterThan(0);
    // Warm-up sessions are counted too.
    expect(warmed.churn!.opened).toBe(
      warmed.requests + warmed.warmup!.requests,
    );

    const staged = opener();
    const stepped = await runLoadAcrossConnections(
      primary,
      staged.open,
      callOn,
      {
        concurrency: 2,
        stages: { by: "concurrency", levels: [1, 2], stageMs: 20 },
        churn: { callsPerSession: 1 },
      },
    );
    expect(stepped.stages).toHaveLength(2);
    expect(stepped.churn!.opened).toBe(stepped.requests);
    expect(staged.made.every((c) => c.closed)).toBe(true);
  });

  it("needs a way to open connections", async () => {
    await expect(
      runLoadAcrossConnections(primary, undefined, callOn, {
        concurrency: 1,
        requests: 1,
        churn: { callsPerSession: 1 },
      }),
    ).rejects.toThrow("--load-churn needs a way to open connections.");
  });
});

describe("the churn summary", () => {
  const base: LoadSummary = {
    tool: "ping",
    concurrency: 2,
    requests: 4,
    ok: 4,
    toolErrors: 0,
    errors: 0,
    errorRate: 0,
    elapsedMs: 100,
    throughput: 40,
    okThroughput: 40,
    latencyMs: null,
    errorLatencyMs: null,
    errorMessages: [],
    toolErrorMessages: [],
    churn: {
      callsPerSession: 1,
      opened: 4,
      failed: 1,
      closeFailed: 2,
      connectMs: {
        min: 1,
        mean: 2,
        p50: 2,
        p90: 3,
        p95: 3,
        p99: 3,
        p999: 3,
        max: 3,
      },
      errorMessages: [{ message: "refused", count: 1 }],
    },
  };

  it("reads as a churn line in the text summary", () => {
    const text = formatLoadSummaryHuman(base);
    expect(text).toContain("(concurrency 2, churn)");
    expect(text).toContain(
      "Churn:      4 sessions of 1 call, 1 failed to open, 2 failed to close (connect p50 2 / p99 3 / max 3 ms)",
    );
    expect(text).toContain("    1× refused");
    const plural = formatLoadSummaryHuman({
      ...base,
      churn: {
        ...base.churn!,
        callsPerSession: 5,
        failed: 0,
        closeFailed: 0,
        connectMs: null,
      },
    });
    expect(plural).toContain(
      "Churn:      4 sessions of 5 calls, 0 failed to open\n",
    );
  });

  it("is part of a baseline's shape", () => {
    const plain = { ...base };
    delete plain.churn;
    expect(() =>
      compareLoadToBaseline(base, { source: "b.json", summary: plain }),
    ).toThrow("churn calls per session is 1 here but unset in the baseline");
  });
});

describe("--load-churn (CLI)", () => {
  it("opens a fresh HTTP session for each call", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo("load-churn", "1.0.0"),
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
        "6",
        "--load-concurrency",
        "1",
        "--load-churn",
        "--load-churn-calls",
        "2",
      ]);
      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toMatchObject({
        tool: "ping",
        requests: 6,
        ok: 6,
        churn: { callsPerSession: 2, opened: 3, failed: 0 },
      });
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

  const { command, args } = getTestMcpServerCommand();
  it.each([
    [
      ["--method", "tools/call", "--load-churn"],
      "--load-churn requires --load.",
    ],
    [
      ["--method", "tools/call", "--load-churn-calls", "2"],
      "--load-churn-calls requires --load.",
    ],
    [
      ["--method", "tools/call", "--load", "--load-churn-calls", "2"],
      "--load-churn-calls requires --load-churn.",
    ],
    [
      [
        "--method",
        "tools/call",
        "--load",
        "--load-churn",
        "--load-churn-calls",
        "0",
      ],
      "--load-churn-calls must be a positive integer.",
    ],
    [
      [
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--load",
        "--load-churn",
      ],
      "--load-churn requires an HTTP or SSE server",
    ],
  ])("rejects %j", async (flags, message) => {
    const result = await runCli([command, ...args, "--cli", ...flags]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(message);
  });
});
