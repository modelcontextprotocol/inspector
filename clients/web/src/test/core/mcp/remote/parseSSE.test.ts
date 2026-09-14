/**
 * `parseSSE` cross-chunk frame loss.
 *
 * The reproduction needs no browser and no network: `parseSSE` takes a reader,
 * so a test supplies the chunk boundary directly instead of hoping a real
 * transport happens to produce one. That is what makes this defect testable at
 * all — on the wire the split is a function of payload size, TCP segmentation
 * and any proxy in between, none of which a test can steer.
 *
 * The bug: `currentEvent` / `currentData` are declared INSIDE the read loop, so
 * a frame whose `data:` line arrives in one chunk and whose terminating blank
 * line arrives in the next is discarded. `buffer` already carries a partial
 * *line* across reads; nothing carries a partial *frame*.
 */

import { describe, expect, it } from "vitest";
import { parseSSE } from "@inspector/core/mcp/remote/remoteClientTransport";

/** A reader that yields exactly the chunks given, in order. */
function readerFrom(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    read: async () =>
      i < chunks.length
        ? { done: false as const, value: encoder.encode(chunks[i++]!) }
        : { done: true as const, value: undefined },
  } as ReadableStreamDefaultReader<Uint8Array>;
}

async function collect(chunks: string[]) {
  const out: { event: string; data: string }[] = [];
  for await (const frame of parseSSE(readerFrom(chunks))) out.push(frame);
  return out;
}

const FRAME = 'event: message\ndata: {"id":1,"result":"payload"}\n\n';

describe("parseSSE chunk boundaries", () => {
  it("delivers a frame that arrives whole (the case that hides the bug)", async () => {
    // Chromium and Firefox happen to produce this shape at our payload sizes,
    // which is why the defect below has never been observed in practice.
    expect(await collect([FRAME])).toEqual([
      { event: "message", data: '{"id":1,"result":"payload"}' },
    ]);
  });

  it("delivers a frame split between its data line and its terminator", async () => {
    // THE BUG. Chunk 1 ends after the data line's newline; chunk 2 carries only
    // the blank line that closes the frame. Nothing is malformed — this is one
    // valid frame, delivered in two reads.
    const split = ['event: message\ndata: {"id":1,"result":"payload"}\n', "\n"];
    expect(split.join("")).toBe(FRAME); // same bytes as above, different reads
    expect(await collect(split)).toEqual([
      { event: "message", data: '{"id":1,"result":"payload"}' },
    ]);
  });

  it("delivers a frame split mid-payload", async () => {
    const split = ['event: message\ndata: {"id":1,"res', 'ult":"payload"}\n\n'];
    expect(split.join("")).toBe(FRAME);
    expect(await collect(split)).toEqual([
      { event: "message", data: '{"id":1,"result":"payload"}' },
    ]);
  });

  it("delivers every frame when a burst is split at each boundary", async () => {
    // Bytes for three frames, re-cut so each split lands between a data line
    // and its terminator — the shape a large response most plausibly produces.
    const chunks: string[] = [];
    for (const id of [1, 2, 3]) {
      chunks.push(`event: message\ndata: {"id":${id}}\n`, "\n");
    }
    expect(await collect(chunks)).toEqual([
      { event: "message", data: '{"id":1}' },
      { event: "message", data: '{"id":2}' },
      { event: "message", data: '{"id":3}' },
    ]);
  });

  it("flushes a final frame when the stream ends without a blank line", async () => {
    expect(await collect(['event: message\ndata: {"id":9}\n'])).toEqual([
      { event: "message", data: '{"id":9}' },
    ]);
  });
});
