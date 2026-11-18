import { describe, it, expect } from "vitest";

import {
  MAX_SSE_LINE_BYTES,
  SseEventTooLargeError,
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
      run([`event: a\n\n${"x".repeat(20)}\ndata: b\n\n`], 16),
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

  // With one cap for both counts, a line reset is visible through which error
  // fires: lines that each fit, but together pass the cap, must trip the
  // event count rather than the line count.
  it.each([
    ["LF", "\n"],
    ["CR", "\r"],
    ["CRLF", "\r\n"],
  ])("resets the line count on %s", async (_name, eol) => {
    const body = `${"a".repeat(12)}${eol}${"b".repeat(12)}${eol}`;
    await expect(run([body], 16)).rejects.toThrow(SseEventTooLargeError);
  });

  it.each([
    ["LF", "\n"],
    ["CR", "\r"],
  ])("resets the line count on %s at a chunk boundary", async (_name, eol) => {
    const chunks = ["a".repeat(12) + eol, "b".repeat(12), eol];
    await expect(run(chunks, 16)).rejects.toThrow(SseEventTooLargeError);
  });

  it("resets the line count on a CRLF split across chunks", async () => {
    const chunks = ["a".repeat(12) + "\r", "\n" + "b".repeat(12), "\r", "\n"];
    await expect(run(chunks, 16)).rejects.toThrow(SseEventTooLargeError);
  });

  it("errors on many terminated lines with no blank line", async () => {
    // Each line is far under the cap; the event they build is not.
    const chunks = Array.from({ length: 10 }, () => "data: abc\n");
    await expect(run(chunks, 32)).rejects.toThrow(SseEventTooLargeError);
  });

  it("names the event limit distinctly in the error message", async () => {
    await expect(run(["data: abc\n".repeat(10)], 32)).rejects.toThrow(
      /SSE event exceeds the 32-byte limit \(MAX_SSE_LINE_BYTES\) without a blank line/,
    );
  });

  it.each([
    ["LF LF", "\n", "\n\n"],
    ["CR CR", "\r", "\r\r"],
    ["CRLF CRLF", "\r\n", "\r\n\r\n"],
  ])("resets the event count on a blank line (%s)", async (_name, eol, end) => {
    // Three 12-byte lines per event, 36 bytes, would pass the 32-byte cap
    // over two events unless the blank line resets the count.
    const event = `${"a".repeat(12)}${eol}${"b".repeat(12)}${end}`;
    const body = event.repeat(5);
    await expect(run([body], 32)).resolves.toBe(body);
  });

  it.each([
    ["LF LF", ["\n", "\n"]],
    ["CR CR", ["\r", "\r"]],
    ["CRLF CRLF", ["\r\n", "\r\n"]],
    ["CRLF CR|LF", ["\r\n\r", "\n"]],
    ["CR|LF CRLF", ["\r", "\n\r\n"]],
  ] as const)(
    "resets the event count on a blank line split across chunks (%s)",
    async (_name, [first, second]) => {
      const chunks: string[] = [];
      for (let i = 0; i < 5; i++) {
        chunks.push("a".repeat(20) + first, second);
      }
      await expect(run(chunks, 32)).resolves.toBe(chunks.join(""));
    },
  );

  it("does not read a CRLF split across chunks as a blank line", async () => {
    // CR | LF ends one line; it is not CR then an empty LF line, so the event
    // keeps growing and trips the cap.
    const chunks = ["a".repeat(20) + "\r", "\n" + "b".repeat(20) + "\r", "\n"];
    await expect(run(chunks, 32)).rejects.toThrow(SseEventTooLargeError);
  });

  it("passes a legitimate many-event stream under the cap intact", async () => {
    const events = Array.from(
      { length: 200 },
      (_, i) =>
        `id: ${i}\r\nevent: message\r\ndata: {"jsonrpc":"2.0","id":${i}}\r\n\r\n`,
    ).join("");
    // Deliver it in awkward 7-byte pieces so terminators straddle chunks.
    const chunks: string[] = [];
    for (let i = 0; i < events.length; i += 7) {
      chunks.push(events.slice(i, i + 7));
    }
    await expect(run(chunks, 64)).resolves.toBe(events);
  });
  it("does not reset the count when a line is only split, not ended", async () => {
    // The CR of a CRLF ends the line on its own; a line split mid-text does
    // not. The blank line first keeps the event count out of the way.
    const chunks = [
      "a".repeat(12) + "\r\n\r",
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
