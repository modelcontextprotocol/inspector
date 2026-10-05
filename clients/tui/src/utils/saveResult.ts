/**
 * Writing a tool call result to a file from the TUI's result view — the `w`
 * keybinding (#2571).
 *
 * The bytes come from core's `renderResultForFile`: the `raw` / `json`
 * encodings planned for the CLI's `--output` (#2431), kept in `core/` so that
 * once it lands both clients render a result through the same code. What lives here is the TUI-only half: the default
 * filename the prompt opens with, and the write itself, which resolves a
 * relative path against the working directory the TUI was launched from and
 * reports a failure as a message rather than letting it reach Ink.
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  renderResultForFile,
  renderedByteLength,
  type ResultFileFormat,
} from "@inspector/core/mcp/resultFile.js";

/** What a successful save wrote, for the confirmation line. */
export interface SavedResult {
  path: string;
  format: ResultFileFormat;
  bytes: number;
}

/**
 * A tool name made safe as a bare filename: anything outside a conservative
 * portable set becomes `_`, so a name like `fs/read` cannot point the default
 * at a subdirectory.
 */
function fileSafe(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "_");
  return safe === "" ? "tool" : safe;
}

/**
 * The filename the save prompt opens with: `<tool-name>-result.json` for
 * `json`, and for `raw` `.txt` when the result renders as text or `.bin` when
 * it renders as a single decoded binary block (an image or audio result).
 */
export function defaultResultFileName(
  toolName: string,
  format: ResultFileFormat,
  result: unknown,
): string {
  const base = `${fileSafe(toolName)}-result`;
  if (format === "json") return `${base}.json`;
  try {
    const data = renderResultForFile(result, "tools/call", "raw");
    return `${base}.${typeof data === "string" ? "txt" : "bin"}`;
  } catch {
    // No raw form; the save itself reports why. The name only needs to be
    // plausible.
    return `${base}.txt`;
  }
}

/**
 * Render `result` in `format` and write it to `path` (relative paths resolve
 * against `cwd`). An existing file is replaced and the parent directory must
 * already exist, as with the CLI's `--output`. Any failure — a result with no
 * raw form, or the write itself — rejects with an `Error` whose message is fit
 * to show in the TUI.
 */
export async function saveResultToFile(
  result: unknown,
  path: string,
  format: ResultFileFormat,
  cwd: string = process.cwd(),
): Promise<SavedResult> {
  const trimmed = path.trim();
  if (trimmed === "") throw new Error("Enter a file path to save to.");
  const target = resolve(cwd, trimmed);
  let data: string | Uint8Array;
  try {
    data = renderResultForFile(result, "tools/call", format);
  } catch (err) {
    throw new Error(
      `${errorMessage(err)} Save it as json instead (w, then Tab).`,
      { cause: err },
    );
  }
  try {
    await writeFile(target, data);
  } catch (err) {
    throw new Error(`Could not write ${target}: ${errorMessage(err)}`, {
      cause: err,
    });
  }
  return { path: target, format, bytes: renderedByteLength(data) };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
