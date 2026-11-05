import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/cli-runner.js";
import { expectValidJson } from "./helpers/assertions.js";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import {
  CliExitCodeError,
  EXIT_CODES,
} from "@inspector/core/cli/error-handler.js";
import {
  LOAD_FLAG_CONFLICT,
  type LoadStageSummary,
  type LoadSummary,
} from "@inspector/core/cli/handlers/load-test.js";
import {
  LOAD_BASELINE_INVALID,
  LOAD_BASELINE_MISMATCH,
  LOAD_REGRESSION,
  checkLoadRegression,
  compareLoadToBaseline,
  formatLoadBaselineComparison,
  maxRegressionParser,
  parseLoadBaseline,
  readLoadBaselineFile,
  resolveLoadBaseline,
  type LoadBaseline,
} from "@inspector/core/cli/handlers/load-baseline.js";

const latency = (p50: number, p99: number) => ({
  min: 1,
  mean: p50,
  p50,
  p90: p99,
  p95: p99,
  p99,
  p999: p99,
  max: p99,
});

/** A summary with only the fields a test cares about overridden. */
function summary(overrides: Partial<LoadSummary> = {}): LoadSummary {
  return {
    tool: "echo",
    concurrency: 10,
    durationMs: 10_000,
    requests: 1000,
    ok: 1000,
    toolErrors: 0,
    errors: 0,
    errorRate: 0,
    elapsedMs: 10_000,
    throughput: 100,
    okThroughput: 100,
    latencyMs: latency(10, 40),
    errorLatencyMs: null,
    errorMessages: [],
    toolErrorMessages: [],
    ...overrides,
  };
}

function stage(
  n: number,
  level: number,
  overrides: Partial<LoadSummary> = {},
): LoadStageSummary {
  return {
    stage: n,
    stepBy: "concurrency",
    level,
    ...summary({ concurrency: level, ...overrides }),
  };
}

const base = (s: LoadSummary = summary()): LoadBaseline => ({
  source: "prev.json",
  summary: s,
});

/** Run `fn` and return what it threw, which must be a CliExitCodeError. */
function thrown(fn: () => unknown): CliExitCodeError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(CliExitCodeError);
    return err as CliExitCodeError;
  }
  throw new Error("expected a throw");
}

const dir = mkdtempSync(join(tmpdir(), "load-baseline-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
function file(name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

describe("maxRegressionParser", () => {
  it.each([
    ["10", 10],
    ["10%", 10],
    [" 2.5 % ", 2.5],
    ["0", 0],
  ])("reads %j as %d", (value, expected) => {
    expect(maxRegressionParser(value)).toBe(expected);
  });

  it.each(["", "%", "-1", "abc", "Infinity"])("refuses %j", (value) => {
    expect(() => maxRegressionParser(value)).toThrow(
      "--load-max-regression must be a percentage of 0 or more",
    );
  });
});

describe("parseLoadBaseline", () => {
  it("accepts a bare summary and the one-shot CLI's { result } envelope", () => {
    const s = summary();
    expect(parseLoadBaseline(JSON.stringify(s), "a").summary).toEqual(s);
    expect(
      parseLoadBaseline(JSON.stringify({ result: s }), "b").summary,
    ).toEqual(s);
  });

  it("accepts a baseline in which no call succeeded", () => {
    const s = summary({ ok: 0, errors: 1000, latencyMs: null });
    expect(parseLoadBaseline(JSON.stringify(s), "a").summary.latencyMs).toBe(
      null,
    );
  });

  it.each([
    ["{", "is not valid JSON"],
    ["[]", "is not a JSON object"],
    [JSON.stringify({ result: 1 }), "no numeric concurrency"],
    [JSON.stringify({ ...summary(), ok: "x" }), "no numeric ok"],
    [
      JSON.stringify({ ...summary(), latencyMs: { p50: 1 } }),
      "latencyMs is neither null nor a set of percentiles",
    ],
    [
      JSON.stringify({ ...summary(), stoppedEarly: null }),
      "stoppedEarly field that is not an object",
    ],
    [
      JSON.stringify({ ...summary(), steps: {} }),
      "steps field that is not an array",
    ],
    [
      JSON.stringify({ ...summary(), steps: [null] }),
      "scenario step without a name, method, target and weight",
    ],
    [
      JSON.stringify({ ...summary(), stages: {} }),
      "stages field that is not an array",
    ],
    [
      JSON.stringify({ ...summary(), stages: [{}] }),
      "has a stage that is not a --load summary",
    ],
    [
      JSON.stringify({
        ...summary(),
        stoppedEarly: { reason: "consecutive_errors", detail: "x" },
      }),
      "the baseline run stopped early (consecutive_errors)",
    ],
  ])("refuses %s", (text, message) => {
    const err = thrown(() => parseLoadBaseline(text, "prev.json"));
    expect(err.exitCode).toBe(EXIT_CODES.USAGE);
    expect(err.envelope?.code).toBe(LOAD_BASELINE_INVALID);
    expect(err.message).toContain("--load-baseline prev.json: ");
    expect(err.message).toContain(message);
  });
});

describe("readLoadBaselineFile and resolveLoadBaseline", () => {
  it("reads a file", () => {
    const path = file("ok.json", JSON.stringify(summary()));
    expect(readLoadBaselineFile(path)).toEqual({
      source: path,
      summary: summary(),
    });
  });

  it("refuses a file that cannot be read", () => {
    const err = thrown(() => readLoadBaselineFile(join(dir, "missing.json")));
    expect(err.envelope?.code).toBe(LOAD_BASELINE_INVALID);
    expect(err.message).toContain("cannot be read");
  });

  it("returns undefined without --load-baseline", () => {
    expect(resolveLoadBaseline({})).toBeUndefined();
  });

  it("refuses --load-max-regression without --load-baseline", () => {
    const err = thrown(() => resolveLoadBaseline({ maxRegressionPct: 5 }));
    expect(err.exitCode).toBe(EXIT_CODES.USAGE);
    expect(err.envelope?.code).toBe(LOAD_FLAG_CONFLICT);
    expect(err.message).toBe("--load-max-regression requires --load-baseline.");
  });

  it("carries the budget only when given", () => {
    const path = file("gate.json", JSON.stringify(summary()));
    expect(resolveLoadBaseline({ baseline: path })).not.toHaveProperty(
      "maxRegressionPct",
    );
    expect(
      resolveLoadBaseline({ baseline: path, maxRegressionPct: 0 })
        ?.maxRegressionPct,
    ).toBe(0);
  });
});

describe("compareLoadToBaseline", () => {
  it("reports each figure, positive when worse", () => {
    const run = summary({
      latencyMs: latency(11, 30),
      ok: 990,
      errors: 10,
      errorRate: 0.01,
      okThroughput: 99,
    });
    const { rows } = compareLoadToBaseline(run, base());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.where).toBe("");
    const byFigure = Object.fromEntries(
      rows[0]!.figures.map((f) => [f.figure, f]),
    );
    expect(byFigure.p50).toMatchObject({ baseline: 10, value: 11 });
    expect(byFigure.p50!.change).toBeCloseTo(10);
    expect(byFigure.p99!.change).toBeCloseTo(-25);
    expect(byFigure.errorRate).toMatchObject({ baseline: 0, value: 0.01 });
    expect(byFigure.errorRate!.change).toBeCloseTo(1);
    expect(byFigure.okThroughput!.change).toBeCloseTo(1);
  });

  it("does not compare a figure the baseline cannot anchor", () => {
    const baseline = summary({
      ok: 0,
      errors: 1000,
      errorRate: 1,
      okThroughput: 0,
      latencyMs: null,
    });
    const { rows } = compareLoadToBaseline(summary(), base(baseline));
    const changes = rows[0]!.figures.map((f) => [f.figure, f.change]);
    expect(changes).toEqual([
      ["p50", null],
      ["p99", null],
      ["errorRate", -100],
      ["okThroughput", null],
    ]);
  });

  it("calls a run with no successes against one with some an infinite regression", () => {
    const run = summary({
      ok: 0,
      errors: 1000,
      errorRate: 1,
      okThroughput: 0,
      latencyMs: null,
    });
    const [p50] = compareLoadToBaseline(run, base()).rows[0]!.figures;
    expect(p50).toEqual({
      figure: "p50",
      baseline: 10,
      value: null,
      change: Infinity,
    });
  });

  it("refuses a differently shaped run, naming every difference", () => {
    const run = summary({
      tool: "add",
      concurrency: 20,
      durationMs: undefined,
      requestLimit: 500,
      rate: 50,
      openLoop: true,
      connections: {
        requested: 4,
        opened: 4,
        failed: 0,
        connectMs: null,
        errorMessages: [],
      },
    });
    const err = thrown(() => compareLoadToBaseline(run, base()));
    expect(err.exitCode).toBe(EXIT_CODES.USAGE);
    expect(err.envelope?.code).toBe(LOAD_BASELINE_MISMATCH);
    for (const part of [
      'tool is "add" here but "echo" in the baseline',
      "concurrency is 20 here but 10 in the baseline",
      "durationMs is unset here but 10000 in the baseline",
      "requestLimit is 500 here but unset in the baseline",
      "rate is 50 here but unset in the baseline",
      "openLoop is true here but false in the baseline",
      "connections is 4 here but 1 in the baseline",
    ]) {
      expect(err.message).toContain(part);
    }
  });

  it("compares scenario steps", () => {
    const step = {
      name: "a",
      method: "tools/call" as const,
      target: "echo",
      weight: 1,
      ...summary(),
    };
    const run = summary({ tool: undefined, steps: [step] });
    const baseline = summary({
      tool: undefined,
      steps: [{ ...step, weight: 2 }],
    });
    expect(
      thrown(() => compareLoadToBaseline(run, base(baseline))).message,
    ).toContain(
      'scenario steps is [{"name":"a","method":"tools/call","target":"echo","weight":1}] here but [{"name":"a","method":"tools/call","target":"echo","weight":2}]',
    );
    expect(() => compareLoadToBaseline(run, base({ ...run }))).not.toThrow();
    // A step name holding the old delimiters cannot pass for two steps.
    const two = summary({
      tool: undefined,
      steps: [step, { ...step, name: "b", target: "add" }],
    });
    const one = summary({
      tool: undefined,
      steps: [{ ...step, name: "a:tools/call:echo:1,b", target: "add" }],
    });
    expect(
      thrown(() => compareLoadToBaseline(two, base(one))).envelope?.code,
    ).toBe(LOAD_BASELINE_MISMATCH);
  });

  describe("stepped runs", () => {
    const stepped = (stages: LoadStageSummary[], extra = {}) =>
      summary({ concurrency: 20, durationMs: undefined, stages, ...extra });

    it("compares stage by stage", () => {
      const run = stepped([
        stage(1, 10),
        stage(2, 20, { latencyMs: latency(20, 80) }),
      ]);
      const baseline = stepped([stage(1, 10), stage(2, 20)]);
      const { rows } = compareLoadToBaseline(run, base(baseline));
      expect(rows.map((r) => r.where)).toEqual([
        " at stage 1 (concurrency 10)",
        " at stage 2 (concurrency 20)",
      ]);
      expect(rows[1]!.figures[0]!.change).toBeCloseTo(100);
    });

    it("refuses a stepped run against a plain one, either way round", () => {
      const run = stepped([stage(1, 10)]);
      expect(
        thrown(() => compareLoadToBaseline(run, base(summary()))).message,
      ).toContain("this is a stepped run");
      expect(
        thrown(() => compareLoadToBaseline(summary(), base(run))).message,
      ).toContain("the baseline is a stepped run");
    });

    it("refuses different levels, step kinds or stage lengths", () => {
      const run = stepped([stage(1, 10), stage(2, 20)]);
      const baseline = stepped([
        stage(1, 10, { durationMs: 5000 }),
        { ...stage(2, 20), stepBy: "rate" },
      ]);
      const err = thrown(() => compareLoadToBaseline(run, base(baseline)));
      expect(err.message).toContain(
        "stage 1 is concurrency 10 for 10000ms here but concurrency 10 for 5000ms",
      );
      expect(err.message).toContain(
        "stage 2 is concurrency 20 for 10000ms here but rate 20",
      );
    });

    it("refuses a different per-stage rate", () => {
      const run = stepped([stage(1, 10, { rate: 10 })]);
      const baseline = stepped([stage(1, 10, { rate: 100 })]);
      expect(
        thrown(() => compareLoadToBaseline(run, base(baseline))).message,
      ).toContain("stage 1 rate is 10 here but 100 in the baseline");
    });

    it("refuses a different stage count, unless this run stopped early", () => {
      const baseline = stepped([stage(1, 10), stage(2, 20)]);
      const short = stepped([stage(1, 10)]);
      expect(
        thrown(() => compareLoadToBaseline(short, base(baseline))).message,
      ).toContain("this run has 1 stages but the baseline has 2");
      const stopped = stepped([stage(1, 10)], {
        stoppedEarly: { reason: "threshold_breached", detail: "x" },
      });
      expect(compareLoadToBaseline(stopped, base(baseline)).rows).toHaveLength(
        1,
      );
    });
  });
});

describe("formatLoadBaselineComparison", () => {
  it("prints one line per row, each figure baseline -> run", () => {
    const run = summary({
      latencyMs: latency(11, 30),
      ok: 990,
      errors: 10,
      errorRate: 0.01,
      okThroughput: 99,
    });
    expect(
      formatLoadBaselineComparison(compareLoadToBaseline(run, base())),
    ).toEqual([
      "Baseline prev.json: p50 10ms -> 11ms (+10% worse), p99 40ms -> 30ms (-25% worse), error rate 0% -> 1% (+1 pts worse), ok throughput 100/s -> 99/s (+1% worse)",
    ]);
  });

  it("says when a figure was not compared, or nothing succeeded", () => {
    const none = summary({
      ok: 0,
      errors: 1000,
      errorRate: 1,
      okThroughput: 0,
      latencyMs: null,
    });
    const [line] = formatLoadBaselineComparison(
      compareLoadToBaseline(none, base()),
    );
    expect(line).toContain("p50 10ms -> none (no call succeeded)");
    const [other] = formatLoadBaselineComparison(
      compareLoadToBaseline(summary(), base(none)),
    );
    expect(other).toContain("p50 none -> 10ms (not compared)");
  });
});

describe("checkLoadRegression", () => {
  const slower = summary({ latencyMs: latency(12, 40) }); // p50 +20%

  it("does nothing without a budget", () => {
    expect(() =>
      checkLoadRegression(compareLoadToBaseline(slower, base()), undefined),
    ).not.toThrow();
  });

  it("passes within the budget and fails beyond it", () => {
    const cmp = compareLoadToBaseline(slower, base());
    expect(() => checkLoadRegression(cmp, 20)).not.toThrow();
    const err = thrown(() => checkLoadRegression(cmp, 10));
    expect(err.exitCode).toBe(EXIT_CODES.LOAD_THRESHOLD_EXCEEDED);
    expect(err.envelope?.code).toBe(LOAD_REGRESSION);
    expect(err.message).toBe(
      "Load regression against --load-baseline prev.json: p50 10ms -> 12ms (+20% worse); over --load-max-regression 10%.",
    );
  });

  it("passes a change exactly at the budget despite floating-point roundoff", () => {
    // (1.1 - 1) / 1 * 100 is 10.000000000000009 in floating point.
    const cmp = compareLoadToBaseline(
      summary({ latencyMs: latency(1.1, 40) }),
      base(summary({ latencyMs: latency(1, 40) })),
    );
    expect(() => checkLoadRegression(cmp, 10)).not.toThrow();
    expect(() => checkLoadRegression(cmp, 9.99)).toThrow("p50 1ms -> 1.1ms");
  });

  it("judges a budget of 0 on the exact error rate", () => {
    // One failure in 40 000 rounds to an error rate of 0 in the summary.
    const run = summary({ requests: 40_000, ok: 39_999, errors: 1 });
    const baseline = summary({ requests: 40_000, ok: 40_000 });
    const err = thrown(() =>
      checkLoadRegression(compareLoadToBaseline(run, base(baseline)), 0),
    );
    expect(err.message).toContain("error rate");
  });

  it("names the first regressed stage", () => {
    const stepped = (p50: number) =>
      summary({
        concurrency: 20,
        durationMs: undefined,
        stages: [stage(1, 10), stage(2, 20, { latencyMs: latency(p50, 40) })],
      });
    const err = thrown(() =>
      checkLoadRegression(
        compareLoadToBaseline(stepped(30), base(stepped(10))),
        50,
      ),
    );
    expect(err.message).toContain(
      "Load regression at stage 2 (concurrency 20) against",
    );
  });
});

describe("--load-baseline (CLI)", () => {
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
    "--load",
    "--load-requests",
    "5",
    "--load-concurrency",
    "1",
  ];

  it("compares against a saved --format json summary and passes a generous budget", async () => {
    const saved = await runCli([...echoLoad, "--format", "json"]);
    expect(saved.exitCode).toBe(0);
    const path = file("cli.json", saved.stdout);
    const result = await runCli([
      ...echoLoad,
      "--load-baseline",
      path,
      "--load-max-regression",
      "1000000",
    ]);
    expect(result.exitCode).toBe(0);
    expect(expectValidJson(result)).toMatchObject({ requests: 5 });
    expect(result.stderr).toContain(`Baseline ${path}: p50 `);
  });

  it("drops the comparison under --quiet", async () => {
    const path = file(
      "quiet.json",
      JSON.stringify(
        summary({ concurrency: 1, durationMs: undefined, requestLimit: 5 }),
      ),
    );
    const result = await runCli([
      ...echoLoad,
      "--quiet",
      "--load-baseline",
      path,
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("Baseline");
  });

  it("exits 10 on a regression, after printing the summary", async () => {
    // A baseline no real call can match: 1µs latencies, a million calls a second.
    const path = file(
      "fast.json",
      JSON.stringify(
        summary({
          concurrency: 1,
          durationMs: undefined,
          requestLimit: 5,
          latencyMs: latency(0.001, 0.001),
          okThroughput: 1e6,
          elapsedMs: 0.005,
          requests: 5,
          ok: 5,
        }),
      ),
    );
    const result = await runCli([
      ...echoLoad,
      "--load-baseline",
      path,
      "--load-max-regression",
      "10%",
    ]);
    expect(result.exitCode).toBe(EXIT_CODES.LOAD_THRESHOLD_EXCEEDED);
    expect(expectValidJson(result)).toMatchObject({ requests: 5 });
    expect(result.stderr).toContain(LOAD_REGRESSION);
  });

  it("exits 1 when the runs are shaped differently", async () => {
    const path = file("other.json", JSON.stringify(summary()));
    const result = await runCli([...echoLoad, "--load-baseline", path]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(LOAD_BASELINE_MISMATCH);
  });

  it.each([
    [
      ["--method", "tools/call", "--load-baseline", "x.json"],
      "--load-baseline requires --load.",
    ],
    [
      ["--method", "tools/call", "--load-max-regression", "5"],
      "--load-max-regression requires --load.",
    ],
    [
      [
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--load",
        "--load-max-regression",
        "5",
      ],
      "--load-max-regression requires --load-baseline.",
    ],
    [
      [
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--load",
        "--load-baseline",
        "/nonexistent/baseline.json",
      ],
      "cannot be read",
    ],
  ])("rejects %j", async (flags, message) => {
    const result = await runCli([command, ...args, "--cli", ...flags]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(message);
  });
});
