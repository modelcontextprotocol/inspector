import {
  CliExitCodeError,
  EXIT_CODES,
} from "@inspector/core/cli/error-handler.js";
import {
  LOAD_FLAG_CONFLICT,
  resolveLoadOptions,
  type LoadOptions,
} from "@inspector/core/cli/handlers/load-test.js";
import { readLoadScenarioFile } from "@inspector/core/cli/handlers/load-scenario.js";
import {
  assertLoadArgsTemplate,
  readLoadArgsFile,
} from "@inspector/core/cli/handlers/load-template.js";
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
  loadMaxErrorRate?: number;
  loadMaxP99?: number;
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
    ["--load-max-error-rate", flags.loadMaxErrorRate],
    ["--load-max-p99", flags.loadMaxP99],
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
  } else if (!flags.toolName) {
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
  let options: LoadOptions;
  try {
    options = resolveLoadOptions({
      concurrency: flags.loadConcurrency,
      connections: flags.loadConnections,
      durationSec: flags.loadDuration,
      requests: flags.loadRequests,
      rate: flags.loadRate,
      scenario,
      argRows,
    });
  } catch (err) {
    // `--load-connections` above `--load-concurrency`: the engine's own
    // message, as a usage error rather than a generic failure. It only ever
    // throws an `Error`.
    throw usage((err as Error).message);
  }
  const thresholds = resolveLoadThresholds({
    maxErrorRate: flags.loadMaxErrorRate,
    maxP99Ms: flags.loadMaxP99,
  });
  return { options, ...(thresholds && { thresholds }) };
}

function usage(message: string, code = LOAD_FLAG_CONFLICT): CliExitCodeError {
  return new CliExitCodeError(EXIT_CODES.USAGE, message, { code });
}
