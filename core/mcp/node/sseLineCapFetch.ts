/**
 * Bound the size of a single line, and of a single event, on every
 * Server-Sent Events body the SDK transports parse.
 *
 * Both SDK SSE paths buffer without limit. The legacy `SSEClientTransport`
 * reads through `eventsource`, and the Streamable HTTP transport pipes its POST
 * replies and its standalone `GET` stream through `EventSourceParserStream`;
 * both sit on `eventsource-parser`, which collects the bytes since the last
 * line terminator, and appends every `data:` line to the pending event until a
 * blank line dispatches it — and never enforces its optional `maxBufferSize`
 * because nothing passes one. So a server that sends `data: ` followed by an
 * endless run of bytes with no CR or LF, or endless short `data:` lines with no
 * blank line, grows the process until V8 aborts it — on the web backend,
 * taking every session on it down with the one that connected to the hostile
 * server.
 *
 * The Inspector supplies the `fetch` those transports use, so the cap is
 * enforced here, below the parser: the body handed back counts the bytes since
 * the last CR or LF and the bytes since the last blank line and, once either
 * exceeds {@link SSE_MAX_LINE_BYTES}, errors the stream with
 * {@link SseLineTooLongError} (its `kind` and message say which bound was
 * crossed) instead of delivering any more. The parser then holds at most about
 * one cap's worth of a line or an event. The error reaches the transport as a
 * stream failure, so it surfaces through the transport's `onerror` (and
 * rejects `start()` when it happens before the connection is up) naming the
 * limit, rather than as a hang or a crash.
 *
 * Which responses are wrapped:
 *
 * - any successful response whose `Content-Type` is `text/event-stream` (the
 *   legacy SSE `GET` and a Streamable HTTP POST answered with a stream); and
 * - any successful `GET` that asked for `text/event-stream`, whatever its
 *   `Content-Type` — the Streamable HTTP transport parses a 2xx body on its
 *   standalone `GET` as SSE without checking the header, so a server could
 *   otherwise dodge the cap by mislabelling the stream.
 *
 * Everything else — a JSON reply, an error status, OAuth traffic — passes
 * through untouched, so this wrapper is invisible to the 401/403 handling and
 * to a legitimately large `application/json` result.
 *
 * Wrapping a body means building a new `Response` around it; the constructor
 * cannot set `url`, `redirected` or `type`, so those are restored as own
 * properties, exactly as `toGlobalResponse` in `proxyFetch.ts` does. The
 * `eventsource` client reads both `redirected` and `url`.
 */

/**
 * The largest single SSE line, and the largest single SSE event, in bytes, the
 * Inspector will hand to the SDK's parser: 16 MiB.
 *
 * It bounds two things, because the parser buffers two things. A line is held
 * until its terminator arrives; an event's `data:` lines are each appended to
 * the pending event and released only at the blank line that dispatches it.
 * Capping the line alone is bypassed by many short, terminated `data:` lines
 * that never reach a blank line, so the same limit applies to the bytes since
 * the last blank line as well.
 *
 * One event carries one whole JSON-RPC message, so this has to sit far above
 * any legitimate message — a tool result with an embedded image or a large
 * resource is a single event, usually on a single line. 16 MiB is four times
 * the 4 MB request-body limit the SDK's own reference server transports apply
 * to an incoming message, and holds roughly 12 MiB of binary content after
 * base64. The cost on the other side is memory: a hostile server can make the
 * parser hold up to about this much (as a one-byte string for ASCII, twice
 * that otherwise) per open stream before the stream is cut, and a reconnecting
 * client can make it do so again on each attempt. That is bounded, which is
 * the property that matters; a raise trades directly against how many
 * concurrent hostile streams a memory-limited backend survives. The recording
 * cap (`TRACKED_BODY_MAX_BYTES`, 1 MiB) is deliberately not reused: it only
 * truncates what the Network log shows, whereas this one ends the connection.
 *
 * The event count includes every byte since the last blank line — comment and
 * `id:`/`event:` lines too, which the parser does not accumulate. That is
 * conservative by design: a stream needs 16 MiB of them with no blank line in
 * between to trip it, which no keepalive pattern comes near.
 */
export const SSE_MAX_LINE_BYTES = 16 * 1024 * 1024;

/** Which bound an over-limit SSE body crossed. */
export type SseLimitKind = "line" | "event";

/** The error a capped SSE body fails with. */
export class SseLineTooLongError extends Error {
  readonly limitBytes: number;
  readonly kind: SseLimitKind;

  constructor(limitBytes: number, kind: SseLimitKind = "line") {
    super(
      kind === "line"
        ? `SSE line exceeded the ${limitBytes}-byte line-length limit ` +
            `without a line terminator; the stream was closed to protect the ` +
            `Inspector's memory. The server sent a single line larger than ` +
            `the Inspector accepts.`
        : `SSE event exceeded the ${limitBytes}-byte event-size limit ` +
            `without a blank line to end it; the stream was closed to protect ` +
            `the Inspector's memory. The server sent a single event larger ` +
            `than the Inspector accepts.`,
    );
    // Not "AbortError": `eventsource` treats that name as an intentional
    // abort and swallows it, which would turn this into a silent stall.
    this.name = "SseLineTooLongError";
    this.limitBytes = limitBytes;
    this.kind = kind;
  }
}

const LF = 0x0a;
const CR = 0x0d;

/**
 * A pass-through transform that bounds both a line and an event. It errors
 * once more than `maxBytes` bytes arrive without a CR or LF (a line), or
 * without a blank line (an event).
 *
 * LF, CR and CRLF each end a line, and CRLF is ONE terminator even when the CR
 * ends one chunk and the LF starts the next — so that split is never read as
 * an empty line. A blank line is a terminator that ends an empty line, i.e. a
 * terminator immediately following another (`\n\n`, `\r\r`, `\r\n\r\n`);
 * it dispatches the pending event, so it resets the event count. The stream's
 * very first byte being a terminator is also an empty line, as for the parser.
 */
export function createSseLineCapStream(
  maxBytes: number = SSE_MAX_LINE_BYTES,
): TransformStream<Uint8Array, Uint8Array> {
  // Bytes since the last terminator, and since the last blank line.
  let line = 0;
  let event = 0;
  // Whether the last byte seen — in this chunk or the previous one — was a CR,
  // so an LF right after it is the second half of a CRLF, not a new line end.
  let afterCr = false;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Native `indexOf` for both terminators, each re-searched only once the
      // scan passes its last hit, so a chunk is scanned in linear time.
      let pos = 0;
      let nextLf = chunk.indexOf(LF);
      let nextCr = chunk.indexOf(CR);
      let exceeded: SseLimitKind | undefined;
      for (;;) {
        if (nextLf !== -1 && nextLf < pos) nextLf = chunk.indexOf(LF, pos);
        if (nextCr !== -1 && nextCr < pos) nextCr = chunk.indexOf(CR, pos);
        const next =
          nextLf === -1
            ? nextCr
            : nextCr === -1
              ? nextLf
              : Math.min(nextLf, nextCr);
        const end = next === -1 ? chunk.length : next;
        const segment = end - pos;
        if (segment > 0) afterCr = false;
        line += segment;
        event += segment;
        if (line > maxBytes) {
          exceeded = "line";
          break;
        }
        // Checked only when content arrives: a terminator that takes the
        // count over the cap may be followed by the blank line that resets
        // it, and the parser holds nothing more until content does arrive.
        if (segment > 0 && event > maxBytes) {
          exceeded = "event";
          break;
        }
        if (next === -1) break;
        if (chunk[next] === LF && afterCr) {
          // The LF of a CRLF: the CR already ended the line.
          afterCr = false;
        } else {
          // An empty line ending here is a blank line: the event dispatches.
          // Otherwise the terminator joins the pending event.
          event = line === 0 ? 0 : event + 1;
          line = 0;
          afterCr = chunk[next] === CR;
        }
        pos = next + 1;
      }
      if (exceeded) {
        // Nothing of this chunk is delivered: the parser already holds at most
        // `maxBytes` of the line or event. Erroring the readable side also
        // errors the writable one, which makes the pipe cancel the upstream
        // body and release the connection.
        controller.error(new SseLineTooLongError(maxBytes, exceeded));
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function isEventStreamContentType(contentType: string | null): boolean {
  // `eventsource` accepts any value that starts with the media type, and the
  // SDK compares the essence case-insensitively; this covers both.
  return (
    contentType?.trim().toLowerCase().startsWith("text/event-stream") === true
  );
}

function isEventStreamGet(input: FetchInput, init: FetchInit): boolean {
  const request = input instanceof Request ? input : undefined;
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  if (method !== "GET") return false;
  const headers = new Headers(init?.headers ?? request?.headers);
  return (
    headers.get("accept")?.toLowerCase().includes("text/event-stream") === true
  );
}

/** Rebuild `response` around `body`, keeping what the constructor cannot set. */
function withBody(
  response: Response,
  body: ReadableStream<Uint8Array>,
): Response {
  const out = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  for (const [key, value] of [
    ["url", response.url],
    ["redirected", response.redirected],
    ["type", response.type],
  ] as const) {
    Object.defineProperty(out, key, {
      value,
      configurable: true,
      enumerable: false,
    });
  }
  return out;
}

/**
 * Wrap `baseFetch` so every SSE body it returns is line-capped (see the module
 * comment for which responses that is). `maxBytes` is injectable for tests.
 */
export function createSseLineCapFetch(
  baseFetch: typeof fetch,
  maxBytes: number = SSE_MAX_LINE_BYTES,
): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (
      !response.ok ||
      !response.body ||
      !(
        isEventStreamContentType(response.headers.get("content-type")) ||
        isEventStreamGet(input, init)
      )
    ) {
      return response;
    }
    return withBody(
      response,
      response.body.pipeThrough(createSseLineCapStream(maxBytes)),
    );
  };
}
