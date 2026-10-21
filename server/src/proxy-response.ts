/**
 * Bounded body reading for the /fetch reverse proxy.
 *
 * Extracted from index.ts so it can be unit-tested independently, alongside
 * proxy-security.ts.
 *
 * /fetch buffers the upstream response in full, because it hands the body back
 * to the browser inside a JSON envelope. Reading it with `response.text()`
 * puts no ceiling on that buffer, so an upstream that streams (or announces)
 * an arbitrarily large body grows the proxy's memory without limit. This
 * module reads the body through its stream instead and stops at a fixed cap.
 */

/**
 * Largest upstream response body /fetch will buffer, in bytes (5 MiB).
 *
 * The proxy exists to carry OAuth traffic past browser CORS restrictions:
 * protected-resource and authorization-server metadata, client registration
 * and token responses. Those documents are a few kilobytes at most, so 5 MiB
 * leaves three orders of magnitude of headroom for any legitimate response
 * while keeping the per-request buffer small enough that concurrent requests
 * cannot exhaust the process.
 */
export const MAX_PROXY_RESPONSE_BYTES = 5 * 1024 * 1024;

/** Thrown when an upstream response body exceeds the configured cap. */
export class ProxyResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Upstream response body exceeds the ${maxBytes}-byte limit`);
    this.name = "ProxyResponseTooLargeError";
  }
}

/**
 * The subset of a node-fetch Response this module reads. node-fetch exposes
 * the body as a Node Readable, which is async-iterable and has `destroy()`.
 */
export interface CappedReadableResponse {
  headers: { get(name: string): string | null };
  body:
    | (AsyncIterable<Uint8Array | string> & {
        destroy?: (error?: Error) => void;
      })
    | null;
}

/**
 * Reads `response`'s body as UTF-8 text, refusing to buffer more than
 * `maxBytes`.
 *
 * - A `Content-Length` larger than the cap is rejected before any of the body
 *   is read.
 * - Otherwise the body is accumulated chunk by chunk, and the moment the
 *   running total passes the cap the stream is destroyed and the read fails.
 *   `destroy()` is synchronous and is deliberately not awaited on anything:
 *   waiting for a stream to acknowledge teardown can block indefinitely if the
 *   source never settles.
 *
 * Throws {@link ProxyResponseTooLargeError} in both cases.
 */
export async function readCappedBody(
  response: CappedReadableResponse,
  maxBytes: number = MAX_PROXY_RESPONSE_BYTES,
): Promise<string> {
  const { body } = response;

  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      body?.destroy?.();
      throw new ProxyResponseTooLargeError(maxBytes);
    }
  }

  if (body === null) {
    return "";
  }

  // Iterate by hand rather than with `for await`: leaving a `for await` loop
  // early awaits the iterator's `return()`, which is exactly the teardown wait
  // described above. On overflow we destroy the stream and walk away.
  const iterator = body[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await iterator.next();
    if (done) {
      break;
    }
    const chunk = typeof value === "string" ? Buffer.from(value) : value;
    total += chunk.byteLength;
    if (total > maxBytes) {
      body.destroy?.();
      throw new ProxyResponseTooLargeError(maxBytes);
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}
