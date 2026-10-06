/**
 * `--output <path>` / `--output-format raw|json`: write a method result to a
 * file instead of stdout (#2431).
 *
 * Kept in its own module, rather than inline in `cli.ts` and `emit-result.ts`,
 * so the parse-time rules, the rendering and the write are one unit with one
 * test file, and the two call sites stay a line each.
 *
 * The two formats mirror what the web client offers for the same result:
 *
 * - `json` (the default) is the whole result, pretty-printed with two-space
 *   indentation — the shape every web export (`useExportActions`) downloads.
 * - `raw` is the result's own payload as a consumer would want it on disk: the
 *   text of its text-bearing blocks (what the web `ContentViewer`'s copy button
 *   copies), or — when the result carries no text and exactly one binary block —
 *   that block's decoded bytes, so an image or audio tool result saves as a
 *   playable file rather than as base64 inside JSON.
 *
 * The output flag name is deliberately not `--format`: that flag already exists
 * and shapes **stdout** (`text` vs the `{ result }` envelope). Overloading it
 * with a file encoding would make `--format json --output x` ambiguous.
 */
import { writeFile } from "node:fs/promises";
import { base64ToBytes } from "@inspector/core/mcp/skills.js";
import { CliExitCodeError, EXIT_CODES } from "../error-handler.js";
import type { McpResponse } from "./method-types.js";

export type OutputFileFormat = "raw" | "json";

export const OUTPUT_FILE_FORMATS: readonly OutputFileFormat[] = ["raw", "json"];

/** Methods whose result has a payload `raw` can extract. */
const RAW_METHODS = ["tools/call", "resources/read"] as const;

/** Commander parser for `--output-format`. */
export function parseOutputFileFormat(value: string): OutputFileFormat {
  if (value !== "raw" && value !== "json") {
    throw new Error(`--output-format must be 'raw' or 'json'.`);
  }
  return value;
}

/** The subset of the parsed CLI options the `--output` rules read. */
export interface OutputOptionsInput {
  output?: string;
  outputFormat?: OutputFileFormat;
  method?: string;
  appInfo?: boolean;
  verify?: boolean;
  listStoredAuth?: boolean;
  printHandoff?: boolean;
}

/**
 * Reject every `--output` combination that would be accepted and then silently
 * do nothing. Called ahead of the CLI's short-circuit returns for the same
 * reason `--strict` is: those paths never reach `emitResult`, so a later
 * check would let them ignore the flag.
 */
export function validateOutputOptions(options: OutputOptionsInput): void {
  if (options.output === undefined) {
    if (options.outputFormat !== undefined) {
      throw new Error("--output-format requires --output <path>.");
    }
    return;
  }
  if (options.output.trim() === "") {
    throw new Error("--output requires a non-empty file path.");
  }
  if (
    options.listStoredAuth ||
    options.printHandoff ||
    options.method === "servers/list" ||
    options.method === "servers/show"
  ) {
    throw new Error(
      "--output requires a method that calls a server; it has no effect with --list-stored-auth, --print-handoff, or --method servers/list / servers/show.",
    );
  }
  if (options.appInfo || options.verify) {
    throw new Error(
      "--output cannot be combined with --app-info or --verify, which emit a report rather than a result.",
    );
  }
  if (
    options.outputFormat === "raw" &&
    !(RAW_METHODS as readonly (string | undefined)[]).includes(options.method)
  ) {
    throw new Error(
      `--output-format raw requires --method ${RAW_METHODS.join(" or ")}; use --output-format json for other methods.`,
    );
  }
}

type Payload = { text?: string; binary?: string };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * One payload per block: its text, or its base64 binary. A `tools/call` block
 * carries text on `text`, binary on `data` (image/audio), and an embedded
 * resource nests either under `resource`; a `resources/read` entry carries
 * `text` or `blob` directly. A `resource_link` carries neither and is skipped.
 */
function blockPayload(block: unknown): Payload | undefined {
  const b = asRecord(block);
  if (!b) return undefined;
  const nested = asRecord(b.resource);
  if (nested) return blockPayload(nested);
  if (typeof b.text === "string") return { text: b.text };
  if (typeof b.data === "string") return { binary: b.data };
  if (typeof b.blob === "string") return { binary: b.blob };
  return undefined;
}

/**
 * Extract the `raw` bytes of a result: the text of its text-bearing blocks
 * joined by newlines, or the decoded bytes of its single binary block when it
 * has no text at all. Anything else (no payload, or several binaries with no
 * text) has no unambiguous raw form and is refused with a pointer to `json`.
 */
export function renderRaw(
  result: McpResponse,
  method: string,
): string | Buffer {
  const list = method === "resources/read" ? result.contents : result.content;
  const payloads = (Array.isArray(list) ? list : [])
    .map(blockPayload)
    .filter((p): p is Payload => p !== undefined);
  const texts = payloads.flatMap((p) => (p.text !== undefined ? [p.text] : []));
  if (texts.length > 0) return texts.join("\n");
  const binaries = payloads.flatMap((p) =>
    p.binary !== undefined ? [p.binary] : [],
  );
  if (binaries.length === 1) {
    // Strict decode: `Buffer.from(…, "base64")` silently drops invalid
    // characters, so a malformed payload would be "written successfully" as
    // unrelated bytes. `base64ToBytes` goes through `atob`, which throws.
    try {
      return Buffer.from(base64ToBytes(binaries[0]!));
    } catch {
      throw new CliExitCodeError(
        EXIT_CODES.USAGE,
        `The ${method} result's binary content is not valid base64, so it has no raw form; use --output-format json.`,
        { code: "output_not_raw" },
      );
    }
  }
  throw new CliExitCodeError(
    EXIT_CODES.USAGE,
    binaries.length === 0
      ? `The ${method} result has no text or binary content to write as raw; use --output-format json.`
      : `The ${method} result has ${binaries.length} binary blocks and no text, so it has no single raw form; use --output-format json.`,
    { code: "output_not_raw" },
  );
}

/** Render a result in the requested file format. */
export function renderResultForFile(
  result: McpResponse,
  method: string,
  format: OutputFileFormat,
): string | Buffer {
  if (format === "raw") return renderRaw(result, method);
  return JSON.stringify(result, null, 2) + "\n";
}

/** What was written, reported back on stdout (`--format json`) or stderr. */
export interface WrittenOutput {
  path: string;
  format: OutputFileFormat;
  bytes: number;
}

/**
 * Render and write a result to `path`. The parent directory must already exist
 * (no implicit `mkdir`, as with `curl -o`), and an existing file is replaced.
 * A failed write is a usage error with its own envelope code, so a script can
 * tell "the tool failed" apart from "your path was wrong".
 */
export async function writeResultFile(
  result: McpResponse,
  method: string,
  path: string,
  format: OutputFileFormat = "json",
): Promise<WrittenOutput> {
  const data = renderResultForFile(result, method, format);
  try {
    await writeFile(path, data);
  } catch (err) {
    throw new CliExitCodeError(
      EXIT_CODES.USAGE,
      `Could not write --output file ${path}: ${err instanceof Error ? err.message : String(err)}`,
      { code: "output_write_failed" },
    );
  }
  return {
    path,
    format,
    bytes: typeof data === "string" ? Buffer.byteLength(data) : data.length,
  };
}
