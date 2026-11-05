/**
 * Per-tool run history for the Tools screen (#2830): the record of each
 * `tools/call` the user made this session — the arguments sent, how long it
 * took, and the full outcome — so two runs of the same tool can be re-run and
 * compared without copying JSON out by hand.
 *
 * Pure data + transforms only (this is `utils/`): the state itself is owned by
 * `useResultPanels` and written by `onCallTool` in `useServerCommands`.
 */
import type { CallToolResult } from "@modelcontextprotocol/client";

/** One completed `tools/call`, successful or not. */
export interface ToolRun {
  /** Unique within the session; the React key and the compare-selection id. */
  id: string;
  /**
   * 1-based ordinal of this run among the tool's runs this session. Survives
   * pruning, so "Run #7" keeps its name after the oldest runs are dropped.
   */
  sequence: number;
  /** The protocol name the call was sent with — the history's key. */
  toolName: string;
  /** The arguments exactly as sent. */
  args: Record<string, unknown>;
  /** Wall-clock start, epoch milliseconds. */
  startedAt: number;
  /** Elapsed time from send to settle, milliseconds. */
  durationMs: number;
  /**
   * `ok` for a result with no `isError`; `error` for an `isError` result or a
   * rejected call (which has `error`/`errorCode` and no `result`).
   */
  status: "ok" | "error";
  /** The full result envelope, when the call resolved. */
  result?: CallToolResult;
  /** The rejection message, when the call threw instead of resolving. */
  error?: string;
  /** The JSON-RPC error code of a rejection, when it carried one. */
  errorCode?: number;
}

/** A run before the history assigns its identity. */
export type NewToolRun = Omit<ToolRun, "id" | "sequence">;

/** Runs per tool name, newest first. */
export type ToolRunHistory = Readonly<Record<string, readonly ToolRun[]>>;

/**
 * How many runs each tool keeps. A result envelope can be large, and the
 * history lives in memory for the whole session, so the oldest runs are
 * dropped past this rather than growing without bound.
 */
export const MAX_TOOL_RUNS_PER_TOOL = 20;

export const EMPTY_TOOL_RUN_HISTORY: ToolRunHistory = {};

const NO_RUNS: readonly ToolRun[] = [];

/** The runs recorded for `toolName`, newest first (a stable empty array if none). */
export function runsForTool(
  history: ToolRunHistory,
  toolName: string | undefined,
): readonly ToolRun[] {
  if (toolName === undefined) return NO_RUNS;
  return Object.hasOwn(history, toolName) ? history[toolName] : NO_RUNS;
}

/**
 * Returns a new history with `run` prepended to its tool's list, numbered one
 * past that tool's latest run and capped at `cap` entries.
 */
export function appendToolRun(
  history: ToolRunHistory,
  run: NewToolRun,
  id: string,
  cap: number = MAX_TOOL_RUNS_PER_TOOL,
): ToolRunHistory {
  const previous = runsForTool(history, run.toolName);
  const sequence = (previous[0]?.sequence ?? 0) + 1;
  const next = [{ ...run, id, sequence }, ...previous].slice(0, cap);
  return { ...history, [run.toolName]: next };
}

/**
 * The part of a run that two runs are compared on: what was sent and what came
 * back. Duration and timestamps are left out deliberately — they differ on
 * every run, so including them would put a change in every diff.
 */
export function toolRunEnvelope(run: ToolRun): Record<string, unknown> {
  if (run.result) return { arguments: run.args, result: run.result };
  return {
    arguments: run.args,
    error:
      run.errorCode === undefined
        ? { message: run.error }
        : { code: run.errorCode, message: run.error },
  };
}

/** Human-readable duration: milliseconds under a second, seconds above. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** How many runs can be selected for comparison at once. */
export const COMPARE_LIMIT = 2;

/**
 * Selects `id` for comparison, or deselects it. Past {@link COMPARE_LIMIT} the
 * oldest selection is dropped, so ticking a third run swaps it in rather than
 * refusing the click.
 */
export function toggleCompare(selected: string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter((s) => s !== id);
  return [...selected, id].slice(-COMPARE_LIMIT);
}
