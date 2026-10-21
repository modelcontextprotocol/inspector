/**
 * `readCappedText` / `declaresOversizeBody` — the byte budget `/api/fetch`
 * applies to a proxied response body.
 *
 * Driven with hand-built streams so the chunk boundaries, and the cancel the
 * overflow path must start, are observable directly.
 */

import { describe, expect, it } from "vitest";
import {
  declaresOversizeBody,
  readCappedText,
} from "@inspector/core/mcp/remote/node/cappedBody.js";

const encoder = new TextEncoder();

interface TrackedStream {
  stream: ReadableStream<Uint8Array>;
  /** Number of chunks the source handed out. */
  pulled: () => number;
  /** Whether the consumer cancelled the stream. */
  cancelled: () => boolean;
}

/** A stream yielding `chunks` in order, then ending (or, with `endless`, never). */
function streamOf(
  chunks: Uint8Array[],
  opts: { endless?: boolean; cancelNeverSettles?: boolean } = {},
): TrackedStream {
  let index = 0;
  let wasCancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(chunks[index++]);
          return;
        }
        if (opts.endless) {
          index++;
          controller.enqueue(new Uint8Array(1024));
          return;
        }
        controller.close();
      },
      cancel() {
        wasCancelled = true;
        if (opts.cancelNeverSettles) return new Promise<void>(() => {});
        return undefined;
      },
    },
    { highWaterMark: 0 },
  );
  return {
    stream,
    pulled: () => index,
    cancelled: () => wasCancelled,
  };
}

describe("readCappedText", () => {
  it("reads a body under the budget, decoding across chunk boundaries", async () => {
    // "é" is two bytes in UTF-8; split it between chunks so a decoder that is
    // not run in streaming mode would emit replacement characters.
    const bytes = encoder.encode("café ok");
    const { stream, cancelled } = streamOf([
      bytes.subarray(0, 4),
      bytes.subarray(4),
    ]);

    const read = await readCappedText(stream, 1024);

    expect(read).toEqual({ kind: "complete", text: "café ok" });
    expect(cancelled()).toBe(false);
  });

  it("strips a leading BOM the way Response.text() does", async () => {
    const { stream } = streamOf([
      new Uint8Array([0xef, 0xbb, 0xbf]),
      encoder.encode("{}"),
    ]);

    expect(await readCappedText(stream, 1024)).toEqual({
      kind: "complete",
      text: "{}",
    });
  });

  it("accepts a body of exactly the budget", async () => {
    const { stream, cancelled } = streamOf([
      encoder.encode("abcd"),
      encoder.encode("efgh"),
    ]);

    expect(await readCappedText(stream, 8)).toEqual({
      kind: "complete",
      text: "abcdefgh",
    });
    expect(cancelled()).toBe(false);
  });

  it("refuses one byte past the budget and cancels the stream", async () => {
    const { stream, cancelled } = streamOf([
      encoder.encode("abcd"),
      encoder.encode("efghi"),
    ]);

    expect(await readCappedText(stream, 8)).toEqual({ kind: "overflow" });
    expect(cancelled()).toBe(true);
  });

  it("counts bytes, not chunks, so one oversized chunk overflows", async () => {
    const { stream, cancelled } = streamOf([new Uint8Array(64)]);

    expect(await readCappedText(stream, 16)).toEqual({ kind: "overflow" });
    expect(cancelled()).toBe(true);
  });

  it("stops reading a body that never ends once it passes the budget", async () => {
    const { stream, pulled, cancelled } = streamOf([], { endless: true });

    expect(await readCappedText(stream, 4096)).toEqual({ kind: "overflow" });
    // 1 KiB per pull: the fifth crosses 4 KiB, and nothing is pulled after it.
    expect(pulled()).toBe(5);
    expect(cancelled()).toBe(true);
  });

  it("returns on overflow without waiting for a cancel that never settles", async () => {
    const { stream, cancelled } = streamOf([new Uint8Array(32)], {
      cancelNeverSettles: true,
    });

    // Would hang (and time the test out) if the cancel were awaited.
    expect(await readCappedText(stream, 8)).toEqual({ kind: "overflow" });
    expect(cancelled()).toBe(true);
  });

  it("swallows a cancel that rejects", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(32));
      },
      cancel() {
        return Promise.reject(new Error("cancel failed"));
      },
    });

    expect(await readCappedText(stream, 8)).toEqual({ kind: "overflow" });
  });

  it("propagates a read that fails mid-body", async () => {
    const failure = new Error("connection reset");
    let first = true;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (first) {
          first = false;
          controller.enqueue(encoder.encode("partial"));
          return;
        }
        controller.error(failure);
      },
    });

    await expect(readCappedText(stream, 1024)).rejects.toBe(failure);
  });
});

describe("declaresOversizeBody", () => {
  it("is false with no Content-Length", () => {
    expect(declaresOversizeBody(null, 10)).toBe(false);
  });

  it("is false for a length at or under the budget", () => {
    expect(declaresOversizeBody("10", 10)).toBe(false);
    expect(declaresOversizeBody(" 3 ", 10)).toBe(false);
  });

  it("is true for a length over the budget", () => {
    expect(declaresOversizeBody("11", 10)).toBe(true);
    expect(declaresOversizeBody("99999999999999999999", 10)).toBe(true);
  });

  it("ignores a malformed length and leaves enforcement to the read", () => {
    expect(declaresOversizeBody("", 10)).toBe(false);
    expect(declaresOversizeBody("12abc", 10)).toBe(false);
    expect(declaresOversizeBody("-50", 10)).toBe(false);
    expect(declaresOversizeBody("11, 11", 10)).toBe(false);
  });
});
