/**
 * Rendering an MCP result for a file on disk — the pure half of "save this
 * result to a file", shared so every client writes the same bytes for the same
 * result (#2571).
 *
 * The two encodings are the ones designed for the CLI's planned `--output` /
 * `--output-format raw|json` (#2431), whose issue said the rendering should
 * move here once a second client needed it. The TUI's `w` keybinding on its
 * tool result view (#2571) is, for now, the only in-tree consumer; #2431 is
 * expected to render through this module when it lands rather than carry its
 * own copy. Only the rendering lives in `core/`: the write itself is
 * client-owned, because each client reports a failed write its own way (a CLI
 * exit code, a TUI status line) and the web client downloads rather than writes.
 *
 * - `json` is the whole result, pretty-printed with two-space indentation and a
 *   trailing newline.
 * - `raw` is the result's payload as a consumer would want it on disk: the text
 *   of its text-bearing blocks joined by newlines, or — when it carries no text
 *   and exactly one binary block — that block's decoded bytes, so an image or
 *   audio result saves as a playable file rather than as base64 inside JSON.
 *
 * Browser-safe on purpose (no `Buffer`): `core/mcp` is consumed by the web
 * client too, so binary payloads decode through `atob` into a `Uint8Array`,
 * which Node's `fs.writeFile` accepts as readily as a `Buffer`.
 */

export type ResultFileFormat = "raw" | "json";

export const RESULT_FILE_FORMATS: readonly ResultFileFormat[] = ["raw", "json"];

/** The two result shapes `raw` knows how to extract a payload from. */
export type ResultFileMethod = "tools/call" | "resources/read";

/**
 * `raw` was asked of a result that has no single raw form: no text and either
 * no binary block or several of them. Callers add their own remedy (the CLI
 * points at `--output-format json`; the TUI offers the json format).
 */
export class RawResultUnavailableError extends Error {
  readonly method: ResultFileMethod;
  readonly binaryCount: number;

  constructor(method: ResultFileMethod, binaryCount: number) {
    super(
      binaryCount === 0
        ? `The ${method} result has no text or binary content to write as raw.`
        : `The ${method} result has ${binaryCount} binary blocks and no text, so it has no single raw form.`,
    );
    this.name = "RawResultUnavailableError";
    this.method = method;
    this.binaryCount = binaryCount;
  }
}

type Payload = { text: string } | { binary: string };

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

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The `raw` form of a result: its texts joined by newlines, or the decoded
 * bytes of its single binary block when it has no text at all. Throws
 * {@link RawResultUnavailableError} when neither applies.
 */
export function renderRawResult(
  result: unknown,
  method: ResultFileMethod,
): string | Uint8Array {
  const record = asRecord(result);
  const list = method === "resources/read" ? record?.contents : record?.content;
  const payloads = (Array.isArray(list) ? list : [])
    .map(blockPayload)
    .filter((p): p is Payload => p !== undefined);
  const texts = payloads.flatMap((p) => ("text" in p ? [p.text] : []));
  if (texts.length > 0) return texts.join("\n");
  const binaries = payloads.flatMap((p) => ("binary" in p ? [p.binary] : []));
  if (binaries.length === 1) return decodeBase64(binaries[0]!);
  throw new RawResultUnavailableError(method, binaries.length);
}

/** Render a result in the requested file format. */
export function renderResultForFile(
  result: unknown,
  method: ResultFileMethod,
  format: ResultFileFormat,
): string | Uint8Array {
  if (format === "raw") return renderRawResult(result, method);
  return JSON.stringify(result, null, 2) + "\n";
}

/** Byte length of rendered output, for a "wrote N bytes" confirmation. */
export function renderedByteLength(data: string | Uint8Array): number {
  return typeof data === "string"
    ? new TextEncoder().encode(data).length
    : data.length;
}
