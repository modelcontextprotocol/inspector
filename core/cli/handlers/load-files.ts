import { readFileSync } from "node:fs";
import {
  loadScenarioError,
  parseLoadScenario,
  type LoadScenario,
} from "./load-scenario.js";
import {
  loadArgsError,
  parseLoadArgsRows,
  type LoadArgsRow,
} from "./load-template.js";

/**
 * The `--load` file readers: the Node-only half of `load-scenario.ts` and
 * `load-template.ts`, split out (#2911) so the engine those two modules feed
 * imports no `node:` builtin and the web client can run it in the browser.
 * Both CLIs read the files themselves, before connecting; the web client takes
 * scenario JSON as text and calls {@link parseLoadScenario} directly.
 */

/**
 * Read and validate `--load-scenario <path>`. Every failure — a missing file,
 * bad JSON, an invalid step — is a usage error (exit 1) under
 * `LOAD_SCENARIO_INVALID`, raised before anything connects.
 */
export function readLoadScenarioFile(path: string): LoadScenario {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw loadScenarioError(
      path,
      `cannot be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return parseLoadScenario(text, path);
}

/**
 * Read `--load-args-file <path>`. Any failure is a usage error (exit 1) under
 * `LOAD_ARGS_INVALID`, raised before anything connects. Read by the front end,
 * like a scenario file, so a relative path means the caller's working
 * directory.
 */
export function readLoadArgsFile(path: string): LoadArgsRow[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw loadArgsError(
      `--load-args-file ${path}: cannot be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    return parseLoadArgsRows(text);
  } catch (err) {
    throw loadArgsError(`--load-args-file ${path}: ${(err as Error).message}`);
  }
}
