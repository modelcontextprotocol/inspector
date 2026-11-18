import { describe, it, expect } from "vitest";

import {
  MAX_SSE_LINE_BYTES,
  SseLineTooLongError,
  createSseLineCapTransform,
  isEventStreamContentType,
  shouldCapSseBody,
} from "../sse-line-cap.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Pipes `chunks` through a capped transform and collects what comes out. */
async function run(
  chunks: Array<Uint8Array | string>,
  maxBytes: number,
): Promise<string> {
  const source = new ReadableStream<Uint8Array | string>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  const reader = source
    .pipeThrough(createSseLineCapTransform(maxBytes))
    .getReader();
  const out: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    out.push(value);
  }
  return decoder.decode(Buffer.concat(out));
}

describe("MAX_SSE_LINE_BYTES", () => {
  it("is 16 MiB", () => {
    expect(MAX_SSE_LINE_BYTES).toBe(16 * 1024 * 1024);
  });
});

describe("createSseLineCapTransform", () => {
  it("errors the stream on an unterminated line over the cap", async () => {
    await expect(run(["data: ", "x".repeat(20)], 16)).rejects.toThrow(
      SseLineTooLongError,
    );
  });

  it("names the cap in the error message", async () => {
    await expect(run(["data: " + "x".repeat(20)], 16)).rejects.toThrow(
      /16-byte limit \(MAX_SSE_LINE_BYTES\)/,
    );
  });

  it("counts an unterminated line across chunk boundaries", async () => {
    // Each chunk is under the cap; together they are over it.
    await expect(run(["data: xxxx", "xxxx", "xxxx"], 16)).rejects.toThrow(
      SseLineTooLongError,
    );
  });

  it("errors on a long line between terminators inside one chunk", async () => {
    await expect(
      run([`event: a\n${"x".repeat(20)}\ndata: b\n\n`], 16),
    ).rejects.toThrow(SseLineTooLongError);
  });

  it("passes a long line under the cap through intact", async () => {
    const line = `data: ${"y".repeat(1000)}\n\n`;
    const chunks = [line.slice(0, 300), line.slice(300, 700), line.slice(700)];
    // The cap counts the 1006-byte data line; terminators are not counted.
    await expect(run(chunks, 1006)).resolves.toBe(line);
  });

  it("allows a line of exactly the cap", async () => {
    await expect(run(["x".repeat(16) + "\n"], 16)).resolves.toBe(
      "x".repeat(16) + "\n",
    );
  });

  it("passes binary chunks through unchanged", async () => {
    const bytes = encoder.encode("data: héllo\n\n");
    await expect(run([bytes], 64)).resolves.toBe("data: héllo\n\n");
  });

  it.each([
    ["LF", "\n"],
    ["CR", "\r"],
    ["CRLF", "\r\n"],
  ])("resets the count on %s", async (_name, eol) => {
    // Three 12-byte lines would total 36 bytes, far over the 16-byte cap,
    // unless the terminator resets the count.
    const body = `${"a".repeat(12)}${eol}${"b".repeat(12)}${eol}${"c".repeat(12)}${eol}`;
    await expect(run([body], 16)).resolves.toBe(body);
  });

  it.each([
    ["LF", "\n"],
    ["CR", "\r"],
  ])("resets the count on %s at a chunk boundary", async (_name, eol) => {
    const chunks = [
      "a".repeat(12) + eol,
      "b".repeat(12),
      eol + "c".repeat(12),
      eol,
    ];
    await expect(run(chunks, 16)).resolves.toBe(chunks.join(""));
  });

  it("resets the count on a CRLF split across chunks", async () => {
    const chunks = ["a".repeat(12) + "\r", "\n" + "b".repeat(12), "\r", "\n"];
    await expect(run(chunks, 16)).resolves.toBe(chunks.join(""));
  });

  it("does not reset the count when a line is only split, not ended", async () => {
    // The CR of a CRLF ends the line on its own; a line split mid-text does not.
    const chunks = [
      "a".repeat(12) + "\r",
      "\n" + "b".repeat(10),
      "b".repeat(10),
    ];
    await expect(run(chunks, 16)).rejects.toThrow(SseLineTooLongError);
  });
});

describe("isEventStreamContentType", () => {
  it.each([
    ["text/event-stream", true],
    ["text/event-stream; charset=utf-8", true],
    ["Text/Event-Stream", true],
    ["application/json", false],
    [null, false],
    [undefined, false],
  ])("%s -> %s", (contentType, expected) => {
    expect(isEventStreamContentType(contentType)).toBe(expected);
  });
});

describe("shouldCapSseBody", () => {
  const SSE = "text/event-stream";
  const BOTH = "application/json, text/event-stream";
  it.each([
    // 2xx event streams are capped whatever the method.
    [200, SSE, "GET", SSE, true],
    [200, "text/event-stream; charset=utf-8", "POST", BOTH, true],
    // A GET that asked for SSE is capped even when mislabelled.
    [200, "text/plain", "GET", SSE, true],
    [200, "application/octet-stream", undefined, SSE, true],
    [200, null, "get", SSE, true],
    // JSON POST replies are left alone.
    [200, "application/json", "POST", BOTH, false],
    // A GET that did not ask for SSE is left alone.
    [200, "text/plain", "GET", "application/json", false],
    // Error statuses are left alone, even with an SSE content type.
    [401, SSE, "GET", SSE, false],
    [404, "text/plain", "GET", SSE, false],
    [199, SSE, "GET", SSE, false],
  ] as const)(
    "status %s, content-type %s, %s accepting %s -> %s",
    (status, contentType, method, accept, expected) => {
      expect(shouldCapSseBody({ status, contentType, method, accept })).toBe(
        expected,
      );
    },
  );
});
