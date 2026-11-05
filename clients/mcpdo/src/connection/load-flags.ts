import {
  CliExitCodeError,
  EXIT_CODES,
} from "@inspector/core/cli/error-handler.js";
import {
  LOAD_FLAG_CONFLICT,
  DEFAULT_LOAD_PROGRESS_SEC,
  resolveLoadOptions,
  type LoadOptions,
} from "@inspector/core/cli/handlers/load-test.js";
import {
  readLoadArgsFile,
  readLoadScenarioFile,
} from "@inspector/core/cli/handlers/load-files.js";
import {
  assertLoadArgsTemplate,
  LOAD_ARGS_INVALID,
} from "@inspector/core/cli/handlers/load-template.js";
import { LOAD_SCENARIO_INVALID } from "@inspector/core/cli/handlers/load-scenario.js";
import {
  resolveLoadStages,
  type LoadRamp,
  type LoadStepBy,
} from "@inspector/core/cli/handlers/load-stages.js";
import { MAX_REQUEST_LINE_BYTES } from "../daemon/ipc-glue.js";
import {
  resolveLoadBaseline,
  type LoadBaselineGate,
} from "@inspector/core/cli/handlers/load-baseline.js";
import {
  resolveLoadThresholds,
  type LoadThresholds,
} from "@inspector/core/cli/handlers/load-thresholds.js";

/** What a `tools/call --load` invocation asked for. */
export type LoadFlags = {
  /** Bounds the run; sent to the daemon, which runs the engine. */
  options: LoadOptions;
  /**
   * Grades the finished summary (#2800). Front-end only: the daemon never
   * sees it, since it judges a summary rather than bounding the run.
   */
  thresholds?: LoadThresholds;
  /**
   * `--load-baseline` (#2910): the saved summary to compare against, read
   * here so a relative path is the caller's. Front-end only, like
   * `thresholds`.
   */
  baseline?: LoadBaselineGate;
};

/**
 * `tools/call --load` (#2744): turn mcpdo's flag values into the shared
 * engine's {@link LoadOptions} and the optional {@link LoadThresholds},
 * refusing the same combinations the one-shot CLI refuses (#2439, #2745,
 * #2746). Each `--load-*` flag is meaningless without `--load`, and
 * `--app-info` shapes a single result where a load run prints a summary, so
 * both are usage errors rather than silently ignored. Value parsing itself
 * (positive integers, positive numbers, fractions) is done by commander
 * through the engine's own parsers, so the two CLIs reject the same inputs.
 *
 * `--load-scenario <file>` (#2839) is read HERE, in the front end, so a
 * relative path means the caller's working directory rather than the
 * daemon's; the parsed scenario rides `options` to the daemon. It replaces
 * the tool name, its arguments and its metadata, so naming any of those too
 * is refused rather than silently overridden.
 *
 * Returns `undefined` when `--load` is not set: an ordinary `tools/call`.
 */
export function resolveLoadFlags(flags: {
  load?: boolean;
  loadConcurrency?: number;
  loadConnections?: number;
  loadDuration?: number;
  loadRequests?: number;
  loadRate?: number;
  loadScenario?: string;
  loadArgsFile?: string;
  loadArgsRandom?: boolean;
  loadSteps?: number[];
  loadRamp?: LoadRamp;
  loadStepBy?: LoadStepBy;
  loadStepDuration?: number;
  loadStopOnBreach?: boolean;
  loadInterval?: number;
  loadWarmup?: number;
  loadProgress?: number;
  loadOpenLoop?: boolean;
  loadChurn?: boolean;
  loadChurnCalls?: number;
  loadSubscribe?: string;
  loadSubscribers?: number;
  loadSubscribeWait?: number;
  loadMaxErrorRate?: number;
  loadMaxP99?: number;
  loadMaxP50?: number;
  loadMaxP95?: number;
  loadMinThroughput?: number;
  loadBaseline?: string;
  loadMaxRegression?: number;
  appInfo?: boolean;
  toolName?: string;
  /** The resolved tool arguments, from positionals or flags. */
  toolArg?: Record<string, unknown>;
  /** `--tool-metadata`. */
  toolMetadata?: Record<string, unknown>;
}): LoadFlags | undefined {
  const bounds = [
    ["--load-concurrency", flags.loadConcurrency],
    ["--load-connections", flags.loadConnections],
    ["--load-duration", flags.loadDuration],
    ["--load-requests", flags.loadRequests],
    ["--load-rate", flags.loadRate],
    ["--load-scenario", flags.loadScenario],
    ["--load-args-file", flags.loadArgsFile],
    ["--load-args-random", flags.loadArgsRandom],
    ["--load-steps", flags.loadSteps],
    ["--load-ramp", flags.loadRamp],
    ["--load-step-by", flags.loadStepBy],
    ["--load-step-duration", flags.loadStepDuration],
    ["--load-stop-on-breach", flags.loadStopOnBreach],
    ["--load-interval", flags.loadInterval],
    ["--load-warmup", flags.loadWarmup],
    ["--load-progress", flags.loadProgress],
    ["--load-open-loop", flags.loadOpenLoop],
    ["--load-churn", flags.loadChurn],
    ["--load-churn-calls", flags.loadChurnCalls],
    ["--load-subscribe", flags.loadSubscribe],
    ["--load-subscribers", flags.loadSubscribers],
    ["--load-subscribe-wait", flags.loadSubscribeWait],
    ["--load-max-error-rate", flags.loadMaxErrorRate],
    ["--load-max-p99", flags.loadMaxP99],
    ["--load-max-p50", flags.loadMaxP50],
    ["--load-max-p95", flags.loadMaxP95],
    ["--load-min-throughput", flags.loadMinThroughput],
    ["--load-baseline", flags.loadBaseline],
    ["--load-max-regression", flags.loadMaxRegression],
  ] as const;
  if (flags.load !== true) {
    for (const [flag, value] of bounds) {
      if (value !== undefined) {
        throw usage(`${flag} requires --load.`);
      }
    }
    return undefined;
  }
  if (flags.appInfo === true) {
    throw usage("--load cannot be combined with --app-info.");
  }
  if (flags.loadScenario !== undefined) {
    const named = [
      ["a tool name", flags.toolName !== undefined],
      ["tool arguments", Object.keys(flags.toolArg ?? {}).length > 0],
      ["--tool-metadata", Object.keys(flags.toolMetadata ?? {}).length > 0],
    ] as const;
    for (const [what, given] of named) {
      if (given) {
        throw usage(
          `--load-scenario cannot be combined with ${what}; each scenario step names its own tool and arguments.`,
        );
      }
    }
    if (flags.loadArgsFile !== undefined) {
      throw usage(
        "--load-args-file cannot be combined with --load-scenario; put placeholders in each step's args instead.",
      );
    }
  } else if (!flags.toolName && flags.loadSubscribe === undefined) {
    // A fan-out run (#2913) without a tool listens passively.
    // Checked here rather than left to the daemon so a missing name fails
    // before a connection is resolved, with the flag a user can act on.
    throw usage("--load requires a tool name.", "missing_tool_name");
  }
  if (flags.loadArgsRandom === true && flags.loadArgsFile === undefined) {
    throw usage("--load-args-random requires --load-args-file.");
  }
  // Placeholders (#2840): a reversed `{{rand:9-1}}` fails before connecting.
  assertLoadArgsTemplate(flags.toolArg, "tool arguments");
  // A bad file is a usage error of its own (`load_scenario_invalid`,
  // `load_args_invalid`), read here so a relative path is the caller's.
  const scenario =
    flags.loadScenario !== undefined
      ? readLoadScenarioFile(flags.loadScenario)
      : undefined;
  const argRows =
    flags.loadArgsFile !== undefined
      ? {
          rows: readLoadArgsFile(flags.loadArgsFile),
          order:
            flags.loadArgsRandom === true
              ? ("random" as const)
              : ("sequential" as const),
        }
      : undefined;
  const thresholds = resolveLoadThresholds({
    maxErrorRate: flags.loadMaxErrorRate,
    maxP50Ms: flags.loadMaxP50,
    maxP95Ms: flags.loadMaxP95,
    maxP99Ms: flags.loadMaxP99,
    minThroughput: flags.loadMinThroughput,
  });
  let options: LoadOptions;
  try {
    // Stages (#2841): `--load-stop-on-breach` needs the thresholds in the
    // daemon, where the stages run, so they ride inside the stages.
    const stages = resolveLoadStages({
      steps: flags.loadSteps,
      ramp: flags.loadRamp,
      stepBy: flags.loadStepBy,
      stepDurationSec: flags.loadStepDuration,
      stopOnBreach: flags.loadStopOnBreach,
      thresholds,
      concurrency: flags.loadConcurrency,
      rate: flags.loadRate,
      durationSec: flags.loadDuration,
      requests: flags.loadRequests,
    });
    options = resolveLoadOptions({
      concurrency: flags.loadConcurrency,
      connections: flags.loadConnections,
      durationSec: flags.loadDuration,
      requests: flags.loadRequests,
      rate: flags.loadRate,
      scenario,
      argRows,
      stages,
      intervalSec: flags.loadInterval,
      warmupSec: flags.loadWarmup,
      openLoop: flags.loadOpenLoop,
      churn: flags.loadChurn,
      churnCalls: flags.loadChurnCalls,
      subscribe: flags.loadSubscribe,
      subscribers: flags.loadSubscribers,
      subscribeWaitSec: flags.loadSubscribeWait,
      // Always requested here; the dispatcher drops it for `--format json`,
      // where nobody is watching stderr (#2838).
      progressSec: flags.loadProgress ?? DEFAULT_LOAD_PROGRESS_SEC,
    });
  } catch (err) {
    // A stage conflict, or `--load-connections` above the workers: the
    // engine's own message, as a usage error rather than a generic failure.
    // Both only ever throw an `Error`.
    throw usage((err as Error).message);
  }
  assertFitsOneRequest(options);
  // Read last, after every flag conflict has had its say: a bad file is a
  // usage error of its own (`load_baseline_invalid`).
  const baseline = resolveLoadBaseline({
    baseline: flags.loadBaseline,
    maxRegressionPct: flags.loadMaxRegression,
  });
  return {
    options,
    ...(thresholds && { thresholds }),
    ...(baseline && { baseline }),
  };
}

/**
 * Room left in a daemon request line for everything besides the load
 * options: the method, connection name and tool arguments.
 */
export const LOAD_REQUEST_HEADROOM_BYTES = 64 * 1024;

/**
 * The parsed scenario and args-file rows ride to the daemon in ONE request
 * line, which the daemon refuses past {@link MAX_REQUEST_LINE_BYTES}. A file
 * that large would otherwise be accepted here and then fail as an unreachable
 * daemon before any call ran, so it is refused up front with the file's own
 * code and the limit it hit.
 */
function assertFitsOneRequest(options: LoadOptions): void {
  const budget = MAX_REQUEST_LINE_BYTES - LOAD_REQUEST_HEADROOM_BYTES;
  const bytes = Buffer.byteLength(JSON.stringify(options));
  if (bytes <= budget) return;
  const [flag, code] =
    options.argRows !== undefined
      ? ["--load-args-file", LOAD_ARGS_INVALID]
      : ["--load-scenario", LOAD_SCENARIO_INVALID];
  throw usage(
    `${flag} is too large for mcpdo: the run's options encode to ${bytes} bytes, over the ${budget}-byte limit of one daemon request. Use fewer or smaller rows, or the one-shot CLI (mcp-inspector --cli), which has no such limit.`,
    code,
  );
}

function usage(message: string, code = LOAD_FLAG_CONFLICT): CliExitCodeError {
  return new CliExitCodeError(EXIT_CODES.USAGE, message, { code });
}
