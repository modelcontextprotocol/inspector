/**
 * Bounded line length for upstream Server-Sent Event streams.
 *
 * The proxy hands every upstream SSE body to the MCP SDK, which parses it
 * with `eventsource-parser` (through `eventsource` for the `sse` transport and
 * through `EventSourceParserStream` for `streamable-http`). That parser buffers
 * the current line until it sees a line terminator, and neither caller sets its
 * opt-in `maxBufferSize`. An upstream that sends `data: ` followed by an endless
 * run of bytes with no CR or LF therefore grows the proxy's memory without
 * limit until the process runs out of heap, taking every session with it.
 *
 * This module bounds that buffer at the layer the proxy controls: the fetch it
 * passes to the SDK. It counts the bytes since the last line terminator and
 * errors the stream once that count passes a fixed cap, so the one connection
 * fails visibly instead of the whole process falling over.
 */

/**
 * Longest single SSE line the proxy will pass to the SDK, in bytes (16 MiB).
 *
 * A legitimate line can be large: a `data:` line carries a whole JSON-RPC
 * message, so a big tool result (embedded resources, base64 images) arrives as
 * one line. 16 MiB is four times the 4 MB request-body limit the SDK's own
 * reference server transports apply to an incoming message, and holds roughly
 * 12 MiB of binary content after base64 encoding. On the other side it bounds
 * what a hostile upstream can make the parser hold: at most this much per open
 * stream, again on each reconnect, rather than the whole heap.
 */
export const MAX_SSE_LINE_BYTES = 16 * 1024 * 1024;

const LF = 0x0a;
const CR = 0x0d;

/** Thrown (as the stream's error) when an upstream SSE line exceeds the cap. */
export class SseLineTooLongError extends Error {
  constructor(maxBytes: number) {
    super(
      `Upstream SSE line exceeds the ${maxBytes}-byte limit (MAX_SSE_LINE_BYTES) without a line terminator`,
    );
    this.name = "SseLineTooLongError";
  }
}

/** True when `contentType` names an event stream, as the SDK's parsers read it. */
export function isEventStreamContentType(
  contentType: string | null | undefined,
): boolean {
  return (contentType ?? "").toLowerCase().includes("text/event-stream");
}

/**
 * Returns a pass-through TransformStream that errors once more than `maxBytes`
 * arrive without a line terminator. CR and LF each end a line (so CRLF does
 * too), and the count carries across chunk boundaries. Chunks are passed on
 * unchanged.
 */
/**
 * Whether the proxy must line-cap an upstream response body before the SDK
 * parses it as SSE:
 *
 * - any 2xx response whose Content-Type is `text/event-stream`; and
 * - any 2xx GET whose request asked for `text/event-stream`, whatever the
 *   response Content-Type. The SDK's Streamable HTTP standalone GET
 *   (`_startOrAuthSse`) parses a 2xx body as SSE without checking the header,
 *   so a mislabelled stream would otherwise bypass the cap.
 *
 * Error statuses (including the 401 path) and JSON POST replies are left
 * alone.
 */
export function shouldCapSseBody(options: {
  status: number;
  contentType: string | null | undefined;
  method: string | undefined;
  accept: string | null | undefined;
}): boolean {
  if (options.status < 200 || options.status >= 300) {
    return false;
  }
  if (isEventStreamContentType(options.contentType)) {
    return true;
  }
  const method = (options.method ?? "GET").toUpperCase();
  return method === "GET" && isEventStreamContentType(options.accept);
}

export function createSseLineCapTransform(
  maxBytes: number = MAX_SSE_LINE_BYTES,
): TransformStream<Uint8Array | string, Uint8Array> {
  const encoder = new TextEncoder();
  let lineBytes = 0;
  return new TransformStream<Uint8Array | string, Uint8Array>({
    transform(chunk, controller) {
      const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
      for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i];
        if (byte === LF || byte === CR) {
          lineBytes = 0;
        } else if (++lineBytes > maxBytes) {
          controller.error(new SseLineTooLongError(maxBytes));
          return;
        }
      }
      controller.enqueue(bytes);
    },
  });
}
