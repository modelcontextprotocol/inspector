import type { Tool } from "@modelcontextprotocol/client";
import {
  formatSchemaLintReport,
  lintTools,
  summarizeFindings,
  type ToolSchemaFindings,
} from "@inspector/core/json/schemaLint.js";
import { awaitableError } from "../utils/awaitable-log.js";
import type { McpResponse } from "./method-types.js";

/**
 * Read the `tools` array out of a `tools/list` result. The result is typed as
 * an opaque `McpResponse` at this layer, and a server can return anything, so
 * each entry is narrowed to "an object with a string `name`" before it is
 * treated as a {@link Tool}. Everything else is skipped rather than crashing
 * the report — an unlintable entry is not the CLI's problem to surface here.
 */
export function toolsFromResult(result: McpResponse): Tool[] {
  const tools = (result as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return [];
  return tools.filter(
    (t): t is Tool =>
      typeof t === "object" &&
      t !== null &&
      typeof (t as { name?: unknown }).name === "string",
  );
}

/**
 * Lint the tools in a `tools/list` result (#1005).
 *
 * Always run, `--strict` or not — it is a pure in-memory walk over a list the
 * CLI already holds, and the non-strict hint below needs the count. What
 * `--strict` changes is what happens with the result, in
 * {@link writeSchemaLintReport}.
 */
export function lintListResult(result: McpResponse): ToolSchemaFindings[] {
  return lintTools(toolsFromResult(result));
}

/**
 * Write the schema-lint outcome to **stderr**, so it never contaminates the
 * result on stdout that a `--format json` consumer is parsing.
 *
 * Under `--strict` this is the full report from the issue — path, issue,
 * suggestion, one block per finding. Without it, a single line naming the
 * count and how to see the detail: a server author who has not asked for the
 * lint should still learn it found something, but a multi-page report nobody
 * requested would be worse than silence.
 */
export async function writeSchemaLintReport(
  results: readonly ToolSchemaFindings[],
  strict: boolean,
): Promise<void> {
  if (results.length === 0) return;
  if (!strict) {
    await awaitableError(
      `Schema portability: ${summarizeFindings(results)}. Re-run with --strict for details.\n`,
    );
    return;
  }
  await awaitableError(`${formatSchemaLintReport(results)}\n`);
}
