/**
 * Read a response body as text, refusing one larger than a byte budget.
 *
 * Exists for the web backend's `POST /api/fetch` route, which buffers the
 * proxied response in full before answering — it returns the body inside a
 * JSON envelope, so it cannot stream it through. `Response.text()` has no
 * bound at all: whatever the upstream sends is held in memory until it ends.
 * This reads chunk by chunk, counts bytes rather than chunks (a stream may hand
 * back one chunk far larger than the budget), and stops at the first byte past
 * the limit.
 *
 * Reject rather than truncate, unlike the 401/403 challenge read in
 * `fetchTracking.ts` (#2297). That one records a body for display, where a
 * prefix is still useful; this one hands the body to an OAuth client that will
 * parse it, and a cut-off discovery document or token response is not a
 * smaller valid one — it is a different, wrong one.
 *
 * Kept separate from the challenge read for the same reason: that helper
 * truncates, reads a clone, and carries its own deadline, none of which apply
 * here. The route already bounds the read in time through its abort signal.
 */

/** Outcome of {@link readCappedText}. */
export type CappedTextRead =
  | { kind: "complete"; text: string }
  | { kind: "overflow" };

/**
 * Read `body` to the end as UTF-8, or stop once it exceeds `maxBytes`.
 *
 * Decodes the way `Response.text()` does (UTF-8, a leading BOM stripped,
 * invalid sequences replaced), so a body under the budget reads identically.
 * A body of exactly `maxBytes` is complete; one byte more is an overflow.
 *
 * On overflow the stream is cancelled so the upstream connection is released.
 * A read that rejects — the route's abort signal firing mid-body, a reset
 * connection — propagates to the caller unchanged.
 */
export async function readCappedText(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<CappedTextRead> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) return { kind: "complete", text: text + decoder.decode() };
    bytes += next.value.byteLength;
    if (bytes > maxBytes) {
      // ⚠️ Started, not awaited. `cancel()` adopts the underlying source's
      // cancel promise, which is permitted never to settle — awaiting it would
      // hold the caller pending on exactly the upstream it is trying to drop.
      // The callee owns its failure through the `catch`.
      void reader.cancel().catch(() => {});
      return { kind: "overflow" };
    }
    text += decoder.decode(next.value, { stream: true });
  }
}

/**
 * Whether a `Content-Length` header already declares more than `maxBytes`.
 *
 * Lets the route refuse before reading a byte. Only ever a shortcut: an absent,
 * malformed or understated length says nothing, and the streamed count in
 * {@link readCappedText} is what actually enforces the budget, and it counts
 * decoded bytes.
 *
 * A compressed body's declared length is its encoded size, which is not a
 * bound on the decoded size in either direction: decoding usually grows it,
 * but gzip of incompressible data is a few bytes larger than the data itself.
 * So a body declared just over the budget might decode to just under it. That
 * edge is accepted rather than read through: the budget is three orders of
 * magnitude above any real OAuth document, so a body that close to it is not
 * one worth relaying, and refusing on the header avoids reading it at all.
 */
export function declaresOversizeBody(
  contentLength: string | null,
  maxBytes: number,
): boolean {
  if (contentLength === null || !/^\s*\d+\s*$/.test(contentLength)) {
    return false;
  }
  return Number(contentLength) > maxBytes;
}
