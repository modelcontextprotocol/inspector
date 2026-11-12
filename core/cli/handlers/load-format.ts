import { PLAIN, type Style } from "../style.js";
import type {
  LoadIntervalSummary,
  LoadLatency,
  LoadStageSummary,
  LoadStepSummary,
  LoadSummary,
} from "./load-test.js";
import type { LoadFanoutSummary } from "./load-fanout.js";

/**
 * The human-readable `--load` summary, shared by both CLIs (#2838 item 7):
 * mcpdo's text output since #2744, and now the one-shot CLI's too. Every
 * figure is also in the JSON summary, which is the form to script against.
 */

function code(style: Style, name: string): string {
  return `\`${style.bold(name)}\``;
}

function heading(style: Style, text: string): string {
  return style.bold(text);
}

/**
 * `tools/call --load` summary (#2744): the run's shape, its outcome counts,
 * the latency distribution, and the most frequent thrown messages. Every
 * figure is also in `--format json`, which is the form to script against.
 */
export function formatLoadSummaryHuman(
  summary: LoadSummary,
  style: Style = PLAIN,
): string {
  const tool =
    summary.tool !== undefined
      ? ` ${code(style, summary.tool)}`
      : summary.steps !== undefined
        ? ` scenario (${summary.steps.length} ${summary.steps.length === 1 ? "step" : "steps"})`
        : "";
  const bounds = [
    `concurrency ${summary.concurrency}`,
    ...(summary.durationMs !== undefined
      ? [`duration ${summary.durationMs / 1000}s`]
      : []),
    ...(summary.requestLimit !== undefined
      ? [`limit ${summary.requestLimit}`]
      : []),
    ...(summary.rate !== undefined ? [`rate ${summary.rate}/s`] : []),
    ...(summary.openLoop === true ? ["open loop"] : []),
    ...(summary.churn !== undefined ? ["churn"] : []),
    ...(summary.workers !== undefined
      ? [`${summary.workers} worker processes`]
      : []),
  ];
  const failed = summary.toolErrors + summary.errors;
  const rate = `${(summary.errorRate * 100).toFixed(2)}%`;
  const lines = [
    `${heading(style, "Load test")}${tool} ${style.dim(`(${bounds.join(", ")})`)}`,
    `  Requests:   ${summary.requests} in ${(summary.elapsedMs / 1000).toFixed(2)}s (${summary.throughput}/s, ${summary.okThroughput}/s ok)`,
    `  Outcomes:   ${style.green(`${summary.ok} ok`)}, ${summary.toolErrors} tool errors, ${summary.errors} errors`,
    `  Error rate: ${failed > 0 ? style.red(rate) : rate}`,
  ];
  // `--load-rate` only (#2837): the planned starts the run missed.
  if (summary.plannedStarts !== undefined) {
    const dropped = `${summary.droppedSlots} dropped`;
    lines.push(
      `  Rate:       ${summary.achievedRate}/s achieved; ${summary.plannedStarts} planned, ${summary.droppedSlots! > 0 ? style.red(dropped) : dropped}`,
    );
  }
  const l = summary.latencyMs;
  lines.push(
    l === null
      ? `  Latency:    ${style.dim("no calls succeeded")}`
      : `  Latency:    ${latencyLine(l)}`,
  );
  // Failures are timed apart from successes (#2836).
  const e = summary.errorLatencyMs;
  if (e !== null) {
    lines.push(`  Failed in:  ${latencyLine(e)}`);
  }
  if (summary.errorMessages.length > 0) {
    lines.push(`  ${style.bold("Top errors:")}`);
    for (const { message, count } of summary.errorMessages) {
      lines.push(`    ${count}× ${message}`);
    }
  }
  if (summary.toolErrorMessages.length > 0) {
    lines.push(`  ${style.bold("Top tool errors:")}`);
    for (const { message, count } of summary.toolErrorMessages) {
      lines.push(`    ${count}× ${message}`);
    }
  }
  if (summary.stoppedEarly !== undefined) {
    lines.push(
      `  ${style.red("Stopped early")} (${summary.stoppedEarly.reason}): ${summary.stoppedEarly.detail}`,
    );
  }
  // `--load-warmup` (#2838): what ran before the measured window.
  const w = summary.warmup;
  if (w !== undefined) {
    const stopped =
      w.stoppedEarly !== undefined
        ? ` ${style.red(`(stopped: ${w.stoppedEarly.reason})`)}`
        : "";
    lines.push(
      `  Warm-up:    ${w.durationMs / 1000}s, ${w.requests} calls excluded (${w.ok} ok, ${w.failed} failed)${stopped}`,
    );
  }
  // `--load-interval` (#2838): the time series, one line per bucket.
  if (summary.intervals !== undefined) {
    lines.push(`  ${style.bold("Intervals:")}`);
    for (const row of summary.intervals) lines.push(formatLoadInterval(row));
  }
  // `--load-steps` / `--load-ramp` (#2841): one row per stage, so the knee
  // reads straight down the column.
  if (summary.stages !== undefined) {
    lines.push(`  ${style.bold("Stages:")}`);
    for (const stage of summary.stages) {
      lines.push(formatLoadStage(stage, style));
      // `--load-interval` puts a stepped run's buckets on each stage (#2838).
      for (const row of stage.intervals ?? []) {
        lines.push(`  ${formatLoadInterval(row)}`);
      }
    }
  }
  // `--load-scenario` (#2839): each step's share, under the totals above.
  if (summary.steps !== undefined) {
    lines.push(`  ${style.bold("Steps:")}`);
    for (const step of summary.steps)
      lines.push(...formatLoadStep(step, style));
  }
  // `--load-connections` above 1 (#2800). Connect failures are not call
  // errors, so they are listed under this line rather than "Top errors".
  const c = summary.connections;
  if (c !== undefined) {
    const failed = `${c.failed} failed`;
    const connect =
      c.connectMs === null
        ? ""
        : ` (connect p50 ${c.connectMs.p50} / max ${c.connectMs.max} ms)`;
    lines.push(
      `  Sessions:   ${c.opened} of ${c.requested} opened, ${c.failed > 0 ? style.red(failed) : failed}${connect}`,
    );
    for (const { message, count } of c.errorMessages) {
      lines.push(`    ${count}× ${message}`);
    }
  }
  // `--load-subscribe` (#2913): how the notifications fanned out.
  const f = summary.fanout;
  if (f !== undefined) lines.push(...formatLoadFanout(f, style));
  // `--load-churn` (#2912): sessions opened and closed through the run.
  const churn = summary.churn;
  if (churn !== undefined) {
    const failed = `${churn.failed} failed to open`;
    const connect =
      churn.connectMs === null
        ? ""
        : ` (connect p50 ${churn.connectMs.p50} / p99 ${churn.connectMs.p99} / max ${churn.connectMs.max} ms)`;
    const closeFailed =
      churn.closeFailed > 0 ? `, ${churn.closeFailed} failed to close` : "";
    lines.push(
      `  Churn:      ${churn.opened} sessions of ${churn.callsPerSession} ${churn.callsPerSession === 1 ? "call" : "calls"}, ${churn.failed > 0 ? style.red(failed) : failed}${closeFailed}${connect}`,
    );
    for (const { message, count } of churn.errorMessages) {
      lines.push(`    ${count}× ${message}`);
    }
  }
  return lines.join("\n");
}

/** The `Fan-out:` block of a `--load-subscribe` run (#2913). */
function formatLoadFanout(f: LoadFanoutSummary, style: Style): string[] {
  const failed = `${f.failed} failed`;
  const subscribe =
    f.subscribeMs === null
      ? ""
      : ` (subscribe p50 ${f.subscribeMs.p50} / max ${f.subscribeMs.max} ms)`;
  const missed = `${f.missed} missed`;
  const lines = [
    `  Fan-out:    ${code(style, f.uri)}, ${f.mode}; ${f.subscribed} of ${f.requested} sessions subscribed, ${f.failed > 0 ? style.red(failed) : failed}${subscribe}`,
    `  Delivered:  ${f.delivered} of ${f.updates * f.subscribed} notifications (${f.updates} updates × ${f.subscribed}), ${f.missed > 0 ? style.red(missed) : missed} across ${f.sessionsMissed} sessions, ${f.unexpected} unexpected`,
  ];
  if (f.deliveryMs !== null) {
    lines.push(`  Delivery:   ${latencyLine(f.deliveryMs)}`);
  }
  for (const { message, count } of f.errorMessages) {
    lines.push(`    ${count}× ${message}`);
  }
  return lines;
}

/** A latency distribution on one line, p95 and p99.9 included (#2838). */
function latencyLine(l: LoadLatency): string {
  return `min ${l.min} / mean ${l.mean} / p50 ${l.p50} / p90 ${l.p90} / p95 ${l.p95} / p99 ${l.p99} / p99.9 ${l.p999} / max ${l.max} ms`;
}

/** One `--load-interval` bucket's line (#2838). */
function formatLoadInterval(row: LoadIntervalSummary): string {
  const failed = row.toolErrors + row.errors;
  const l = row.latencyMs;
  const latency =
    l === null ? "no successes" : `p50 ${l.p50} / p99 ${l.p99} ms`;
  return `    ${row.startMs / 1000}–${row.endMs / 1000}s: ${row.requests} calls (${row.throughput}/s), ${failed} failed; ${latency}`;
}

/** One stage's line in {@link formatLoadSummaryHuman} (#2841). */
function formatLoadStage(stage: LoadStageSummary, style: Style): string {
  const failed = stage.toolErrors + stage.errors;
  const rate = `${(stage.errorRate * 100).toFixed(2)}%`;
  const l = stage.latencyMs;
  const latency =
    l === null
      ? style.dim("no calls succeeded")
      : `p50 ${l.p50} / p99 ${l.p99} ms`;
  const level =
    stage.stepBy === "rate"
      ? `rate ${stage.level}/s`
      : `concurrency ${stage.level}`;
  const achieved =
    stage.achievedRate !== undefined ? `, ${stage.achievedRate}/s started` : "";
  const stopped =
    stage.stoppedEarly !== undefined
      ? ` ${style.red(`(stopped: ${stage.stoppedEarly.reason})`)}`
      : "";
  return `    ${stage.stage}. ${level}: ${stage.requests} requests (${stage.okThroughput}/s ok${achieved}), ${failed > 0 ? style.red(rate) : rate} errors; ${latency}${stopped}`;
}

/** One scenario step's lines in {@link formatLoadSummaryHuman} (#2839). */
function formatLoadStep(step: LoadStepSummary, style: Style): string[] {
  const failed = step.toolErrors + step.errors;
  const rate = `${(step.errorRate * 100).toFixed(2)}%`;
  const l = step.latencyMs;
  const latency =
    l === null
      ? style.dim("no calls succeeded")
      : `p50 ${l.p50} / p99 ${l.p99} ms`;
  const lines = [
    `    ${code(style, step.name)} ${style.dim(`(${step.method} ${step.target}, weight ${step.weight})`)}`,
    `      ${step.requests} requests (${step.throughput}/s): ${style.green(`${step.ok} ok`)}, ${step.toolErrors} tool errors, ${step.errors} errors (${failed > 0 ? style.red(rate) : rate}); ${latency}`,
  ];
  for (const { message, count } of [
    ...step.errorMessages,
    ...step.toolErrorMessages,
  ]) {
    lines.push(`      ${count}× ${message}`);
  }
  return lines;
}
