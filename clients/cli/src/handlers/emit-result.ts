import { CliExitCodeError, EXIT_CODES } from "../error-handler.js";
import { lintListResult, writeSchemaLintReport } from "./schema-lint-report.js";
import { countFindings } from "@inspector/core/json/schemaLint.js";
import type { CliAppInfo, McpResponse, MethodArgs } from "./method-types.js";
import { writeResultFile } from "./output-file.js";
import { awaitableError, awaitableLog } from "../utils/awaitable-log.js";

/**
 * Write the method result (and any app-info) to stdout, honouring `--format`
 * and `--app-info`, then map `isError`/no-app/schema outcomes onto the
 * exit-code map.
 */
export async function emitResult(
  result: McpResponse,
  appInfo: CliAppInfo | undefined,
  args: MethodArgs,
): Promise<void> {
  const json = args.format === "json";

  if (args.appInfo) {
    const info: CliAppInfo = appInfo ?? {
      hasApp: false,
      toolName: args.toolName ?? "",
    };
    await awaitableLog(JSON.stringify(json ? { appInfo: info } : info) + "\n");
    if (!info.hasApp) {
      throw new CliExitCodeError(
        EXIT_CODES.NO_APP,
        `Tool '${args.toolName}' has no MCP App UI resource (_meta.ui.resourceUri).`,
      );
    }
    return;
  }

  // Lint before writing, because `--format json --strict` folds the findings
  // into the same envelope as the result rather than emitting a second
  // document a caller would have to correlate.
  const lint =
    args.method === "tools/list" ? lintListResult(result) : undefined;

  // `--output` (#2431): the result goes to the file INSTEAD of stdout, as with
  // `curl -o`. Under `--format json` stdout still carries exactly one envelope —
  // `{ output }` in place of `{ result }` — so a caller parsing it learns where
  // the result went; in text mode the confirmation goes to stderr, leaving
  // stdout empty.
  const written = args.output
    ? await writeResultFile(
        result,
        args.method ?? "",
        args.output,
        args.outputFormat,
      )
    : undefined;

  if (json) {
    const envelope: Record<string, unknown> = written
      ? { output: written }
      : { result };
    if (appInfo?.hasApp) envelope.appInfo = appInfo;
    if (args.strict && lint && lint.length > 0) envelope.schemaFindings = lint;
    await awaitableLog(JSON.stringify(envelope) + "\n");
  } else if (written) {
    await awaitableError(
      `Wrote ${written.bytes} bytes (${written.format}) to ${written.path}\n`,
    );
  } else {
    await awaitableLog(JSON.stringify(result, null, 2) + "\n");
  }

  // Awaited: the throw below (and the CLI's own exit path) reaches
  // `process.exit()` immediately, which discards anything still buffered on a
  // piped stderr.
  if (lint) {
    await writeSchemaLintReport(
      lint,
      args.strict === true,
      args.quiet === true,
    );
  }

  if ((result as { isError?: unknown }).isError === true) {
    throw new CliExitCodeError(
      EXIT_CODES.TOOL_ERROR,
      `Tool '${args.toolName}' returned isError:true.`,
      { code: "tool_is_error" },
    );
  }

  // Only `--strict` fails the run. Warnings never do: they mark constructs
  // that are handled unevenly rather than refused, so failing on them would
  // make `--strict` unusable as a CI gate on servers that are in fact fine.
  if (args.strict && lint) {
    const { errors } = countFindings(lint);
    if (errors > 0) {
      // "unportable", not "invalid": these schemas are valid JSON Schema and
      // are merely refused by some clients, so an envelope code of
      // `schema_invalid` would tell an automated caller the wrong thing.
      throw new CliExitCodeError(
        EXIT_CODES.SCHEMA_UNPORTABLE,
        `${errors} tool schema portability error${errors === 1 ? "" : "s"} found (--strict).`,
        { code: "schema_unportable" },
      );
    }
  }
}
