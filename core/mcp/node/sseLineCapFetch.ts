/**
 * Bound the length of a single line on every Server-Sent Events body the SDK
 * transports parse.
 *
 * Both SDK SSE paths buffer an unterminated line without limit. The legacy
 * `SSEClientTransport` reads through `eventsource`, and the Streamable HTTP
 * transport pipes its POST replies and its standalone `GET` stream through
 * `EventSourceParserStream`; both sit on `eventsource-parser`, which collects
 * the bytes since the last line terminator in memory and never enforces its
 * optional `maxBufferSize` because nothing passes one. So a server that sends
 * `data: ` followed by an endless run of bytes with no CR or LF grows the
 * process until V8 aborts it — on the web backend, taking every session on it
 * down with the one that connected to the hostile server.
 *
 * The Inspector supplies the `fetch` those transports use, so the cap is
 * enforced here, below the parser: the body handed back counts the bytes since
 * the last CR or LF and, once that run exceeds {@link SSE_MAX_LINE_BYTES},
 * errors the stream with {@link SseLineTooLongError} instead of delivering any
 * more. The parser then holds at most one cap's worth of a line. The error
 * reaches the transport as a stream failure, so it surfaces through the
 * transport's `onerror` (and rejects `start()` when it happens before the
 * connection is up) naming the limit, rather than as a hang or a crash.
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
 * The longest single SSE line, in bytes, the Inspector will hand to the SDK's
 * parser: 16 MiB.
 *
 * One `data:` line carries one whole JSON-RPC message, so this has to sit far
 * above any legitimate message — a tool result with an embedded image or a
 * large resource is a single line. 16 MiB is four times the 4 MB request-body
 * limit the SDK's own reference server transports apply to an incoming
 * message, and holds roughly 12 MiB of binary content after base64. The cost
 * on the other side is memory: a hostile server can make the parser hold up to
 * this much (as a one-byte string for ASCII, twice that otherwise) per open
 * stream before the stream is cut, and a reconnecting client can make it do so
 * again on each attempt. That is bounded, which is the property that matters;
 * a raise trades directly against how many concurrent hostile streams a
 * memory-limited backend survives. The recording cap (`TRACKED_BODY_MAX_BYTES`,
 * 1 MiB) is deliberately not reused: it only truncates what the Network log
 * shows, whereas this one ends the connection.
 */
export const SSE_MAX_LINE_BYTES = 16 * 1024 * 1024;

/** The error a line-capped SSE body fails with. */
export class SseLineTooLongError extends Error {
  readonly limitBytes: number;

  constructor(limitBytes: number) {
    super(
      `SSE line exceeded the ${limitBytes}-byte limit without a line ` +
        `terminator; the stream was closed to protect the Inspector's memory. ` +
        `The server sent a single event line larger than the Inspector accepts.`,
    );
    // Not "AbortError": `eventsource` treats that name as an intentional
    // abort and swallows it, which would turn this into a silent stall.
    this.name = "SseLineTooLongError";
    this.limitBytes = limitBytes;
  }
}

const LF = 0x0a;
const CR = 0x0d;

/**
 * A pass-through transform that errors once more than `maxLineBytes` bytes
 * arrive without a CR or LF. Every terminator resets the run, so LF, CR and
 * CRLF all count, including when the pair is split across chunks (a CR ends
 * the run on its own; the LF that follows just ends an empty one).
 */
export function createSseLineCapStream(
  maxLineBytes: number = SSE_MAX_LINE_BYTES,
): TransformStream<Uint8Array, Uint8Array> {
  let run = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Native `indexOf` for both terminators, each re-searched only once the
      // scan passes its last hit, so a chunk is scanned in linear time.
      let pos = 0;
      let nextLf = chunk.indexOf(LF);
      let nextCr = chunk.indexOf(CR);
      let exceeded = false;
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
        run += end - pos;
        if (run > maxLineBytes) {
          exceeded = true;
          break;
        }
        if (next === -1) break;
        run = 0;
        pos = next + 1;
      }
      if (exceeded) {
        // Nothing of this chunk is delivered: the parser already holds at most
        // `maxLineBytes` of the line. Erroring the readable side also errors
        // the writable one, which makes the pipe cancel the upstream body and
        // release the connection.
        controller.error(new SseLineTooLongError(maxLineBytes));
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
 * comment for which responses that is). `maxLineBytes` is injectable for tests.
 */
export function createSseLineCapFetch(
  baseFetch: typeof fetch,
  maxLineBytes: number = SSE_MAX_LINE_BYTES,
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
      response.body.pipeThrough(createSseLineCapStream(maxLineBytes)),
    );
  };
}
