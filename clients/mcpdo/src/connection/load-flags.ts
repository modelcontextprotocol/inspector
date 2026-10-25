import {
  CliExitCodeError,
  EXIT_CODES,
} from "@inspector/core/cli/error-handler.js";
import {
  resolveLoadOptions,
  type LoadOptions,
} from "@inspector/core/cli/handlers/load-test.js";

/**
 * `tools/call --load` (#2744): turn mcpdo's flag values into the shared
 * engine's {@link LoadOptions}, refusing the same combinations the one-shot
 * CLI refuses (#2439). Each `--load-*` bound is meaningless without `--load`,
 * and `--app-info` shapes a single result where a load run prints a summary,
 * so both are usage errors rather than silently ignored. Value parsing itself
 * (positive integers, positive numbers) is done by commander through the
 * engine's own parsers, so the two CLIs reject the same inputs.
 *
 * Returns `undefined` when `--load` is not set: an ordinary `tools/call`.
 */
export function resolveLoadFlags(flags: {
  load?: boolean;
  loadConcurrency?: number;
  loadDuration?: number;
  loadRequests?: number;
  loadRate?: number;
  appInfo?: boolean;
  toolName?: string;
}): LoadOptions | undefined {
  const bounds = [
    ["--load-concurrency", flags.loadConcurrency],
    ["--load-duration", flags.loadDuration],
    ["--load-requests", flags.loadRequests],
    ["--load-rate", flags.loadRate],
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
  // Checked here rather than left to the daemon so a missing name fails
  // before a connection is resolved, with the flag a user can act on.
  if (!flags.toolName) {
    throw usage("--load requires a tool name.", "missing_tool_name");
  }
  return resolveLoadOptions({
    concurrency: flags.loadConcurrency,
    durationSec: flags.loadDuration,
    requests: flags.loadRequests,
    rate: flags.loadRate,
  });
}

function usage(message: string, code = "load_flag_conflict"): CliExitCodeError {
  return new CliExitCodeError(EXIT_CODES.USAGE, message, { code });
}
