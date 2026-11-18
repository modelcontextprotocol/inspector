/**
 * Bounded line and event size for upstream Server-Sent Event streams.
 *
 * The proxy hands every upstream SSE body to the MCP SDK, which parses it
 * with `eventsource-parser` (through `eventsource` for the `sse` transport and
 * through `EventSourceParserStream` for `streamable-http`). That parser buffers
 * without limit in two places, and neither caller sets its opt-in
 * `maxBufferSize`:
 *
 * - the current line, until it sees a line terminator, so `data: ` followed
 *   by an endless run of bytes with no CR or LF grows it forever; and
 * - the pending event, which every `data:` line is appended to and which is
 *   only released at a blank line, so an endless run of short, terminated
 *   `data:` lines with no blank line grows it forever.
 *
 * Either way the proxy's memory grows until the process runs out of heap,
 * taking every session with it. This module bounds both at the layer the proxy
 * controls: the fetch it passes to the SDK. It counts the bytes since the last
 * line terminator and since the last blank line, and errors the stream once
 * either count passes a fixed cap, so the one connection fails visibly instead
 * of the whole process falling over.
 */

/**
 * Largest single SSE line, and largest single SSE event, the proxy will pass
 * to the SDK, in bytes (16 MiB). Both are counted against the same cap.
 *
 * A legitimate line or event can be large: a `data:` line carries a whole
 * JSON-RPC message, so a big tool result (embedded resources, base64 images)
 * arrives as one line, in one event. 16 MiB is four times the 4 MB
 * request-body limit the SDK's own reference server transports apply to an
 * incoming message, and holds roughly 12 MiB of binary content after base64
 * encoding. On the other side it bounds what a hostile upstream can make the
 * parser hold: at most this much per open stream, again on each reconnect,
 * rather than the whole heap.
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

/**
 * Thrown (as the stream's error) when an upstream SSE event, made of
 * individually terminated lines, exceeds the cap without a blank line ending
 * it.
 */
export class SseEventTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(
      `Upstream SSE event exceeds the ${maxBytes}-byte limit (MAX_SSE_LINE_BYTES) without a blank line ending it`,
    );
    this.name = "SseEventTooLargeError";
  }
}

/** True when `contentType` names an event stream, as the SDK's parsers read it. */
export function isEventStreamContentType(
  contentType: string | null | undefined,
): boolean {
  return (contentType ?? "").toLowerCase().includes("text/event-stream");
}

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

/**
 * Returns a pass-through TransformStream that errors once either:
 *
 * - more than `maxBytes` arrive without a line terminator
 *   ({@link SseLineTooLongError}); or
 * - more than `maxBytes` of non-terminator bytes arrive without a blank line
 *   ending the event ({@link SseEventTooLargeError}).
 *
 * CR, LF and CRLF each end a line, and CRLF counts as one terminator even
 * when the CR and LF arrive in different chunks, so a CRLF split across chunks
 * is never mistaken for a blank line. A blank line is a terminator that
 * immediately follows another. Every count carries across chunk boundaries.
 * Chunks are passed on unchanged.
 *
 * The parser holds at most one character per non-terminator byte of an event
 * (plus a newline per line, which needs a non-terminator byte to exist), so
 * counting non-terminator bytes bounds what it can buffer.
 */
export function createSseLineCapTransform(
  maxBytes: number = MAX_SSE_LINE_BYTES,
): TransformStream<Uint8Array | string, Uint8Array> {
  const encoder = new TextEncoder();
  // Non-terminator bytes since the last line terminator.
  let lineBytes = 0;
  // Non-terminator bytes since the last blank line.
  let eventBytes = 0;
  // The previous byte was a CR, so an LF now completes that CRLF rather than
  // ending another (empty) line.
  let afterCr = false;
  return new TransformStream<Uint8Array | string, Uint8Array>({
    transform(chunk, controller) {
      const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
      for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i];
        if (byte === LF && afterCr) {
          afterCr = false;
        } else if (byte === LF || byte === CR) {
          if (lineBytes === 0) {
            // An empty line ends the event.
            eventBytes = 0;
          }
          lineBytes = 0;
          afterCr = byte === CR;
        } else {
          afterCr = false;
          lineBytes++;
          eventBytes++;
          if (lineBytes > maxBytes) {
            controller.error(new SseLineTooLongError(maxBytes));
            return;
          }
          if (eventBytes > maxBytes) {
            controller.error(new SseEventTooLargeError(maxBytes));
            return;
          }
        }
      }
      controller.enqueue(bytes);
    },
  });
}
