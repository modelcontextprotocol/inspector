/**
 * The SSE line cap (`core/mcp/node/sseLineCapFetch.ts`).
 *
 * A hostile server can stream `data: ` followed by an endless run of bytes
 * with no line terminator; the SDK's SSE parser buffers that line without
 * limit until the process runs out of memory. These cases reproduce the
 * attack in miniature (a small injected cap) at three levels: the transform
 * itself, the fetch wrapper's choice of which responses to cap, and the real
 * SDK transports reached through `createTransportNode` with the shipped cap —
 * which is what proves the wiring covers the legacy SSE `GET`, the Streamable
 * HTTP POST reply stream and the Streamable HTTP standalone `GET`.
 */
import { describe, it, expect, vi } from "vitest";
import type { JSONRPCRequest } from "@modelcontextprotocol/client";
import {
  SSE_MAX_LINE_BYTES,
  SseLineTooLongError,
  createSseLineCapFetch,
  createSseLineCapStream,
} from "@inspector/core/mcp/node/sseLineCapFetch.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * A source stream that yields `chunks` and records whether it was cancelled.
 * An `endless` source never closes after them — the attack's shape, where the
 * server simply keeps the connection open.
 */
function source(chunks: Array<string | Uint8Array>, endless = false) {
  const state = { cancelled: false as boolean, reason: undefined as unknown };
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        if (!endless) controller.close();
        return;
      }
      const chunk = chunks[i++]!;
      controller.enqueue(
        typeof chunk === "string" ? encoder.encode(chunk) : chunk,
      );
    },
    cancel(reason) {
      state.cancelled = true;
      state.reason = reason;
    },
  });
  return { stream, state };
}

/** Read a stream to the end, collecting text and the error it fails with. */
async function drain(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return { text, error: undefined };
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    return { text, error };
  }
}

function capped(
  chunks: Array<string | Uint8Array>,
  cap: number,
  endless = false,
) {
  const src = source(chunks, endless);
  return {
    stream: src.stream.pipeThrough(createSseLineCapStream(cap)),
    state: src.state,
  };
}

describe("createSseLineCapStream", () => {
  it("errors an unterminated line that exceeds the cap, naming the limit, and cancels the upstream body", async () => {
    // The reporter's shape in miniature: `data: ` then chunk after chunk with
    // no terminator.
    const { stream, state } = capped(
      ["data: /m\n\n", "data: ", "a".repeat(10), "a".repeat(10)],
      16,
      true,
    );
    const { text, error } = await drain(stream);
    expect(error).toBeInstanceOf(SseLineTooLongError);
    expect((error as SseLineTooLongError).limitBytes).toBe(16);
    expect((error as SseLineTooLongError).kind).toBe("line");
    expect((error as Error).message).toContain("16-byte line-length limit");
    // Everything before the overflowing chunk was delivered, the chunk that
    // crossed the cap was not.
    expect(text).toBe("data: /m\n\ndata: " + "a".repeat(10));
    // The pipe releases the connection: the source is cancelled with the
    // same error.
    await vi.waitFor(() => expect(state.cancelled).toBe(true));
    expect(state.reason).toBe(error);
  });

  it("errors when one chunk alone holds an overlong line after a complete one", async () => {
    const { error } = await drain(capped(["ok\n" + "b".repeat(17)], 16).stream);
    expect(error).toBeInstanceOf(SseLineTooLongError);
  });

  it("errors when an overlong line sits between terminators inside one chunk", async () => {
    const { error } = await drain(
      capped(["ok\n" + "b".repeat(17) + "\nok\n"], 16).stream,
    );
    expect(error).toBeInstanceOf(SseLineTooLongError);
  });

  it("passes a long but legitimate line under the cap through intact", async () => {
    const line = "data: " + "x".repeat(1000);
    const chunks = [line.slice(0, 300), line.slice(300, 700), line.slice(700)];
    const { text, error } = await drain(
      capped([...chunks, "\n\n"], line.length).stream,
    );
    expect(error).toBeUndefined();
    expect(text).toBe(line + "\n\n");
  });

  it.each([
    ["LF", "\n"],
    ["CR", "\r"],
    ["CRLF", "\r\n"],
  ])("resets the line count on %s", async (_name, eol) => {
    // Each line is at the cap and ends its own event; together they far
    // exceed it.
    const line = "c".repeat(16);
    const body = Array.from({ length: 5 }, () => line + eol + eol).join("");
    const { text, error } = await drain(capped([body], 16).stream);
    expect(error).toBeUndefined();
    expect(text).toBe(body);
  });

  it.each([
    ["LF", ["d".repeat(10), "d".repeat(6) + "\n", "\n" + "d".repeat(16), "\n"]],
    ["CR", ["d".repeat(16), "\r", "\r", "d".repeat(16), "\r"]],
    [
      "CRLF split across chunks",
      ["d".repeat(16) + "\r", "\n\r", "\n" + "d".repeat(16) + "\r", "\n"],
    ],
    ["many short lines in short events", ["a\nb\n\nc\r\rd\r\n\r\n".repeat(20)]],
  ])(
    "resets on a terminator arriving in a later chunk (%s)",
    async (_name, chunks) => {
      const { text, error } = await drain(capped(chunks, 16).stream);
      expect(error).toBeUndefined();
      expect(text).toBe(chunks.join(""));
    },
  );

  it("errors on many terminated data lines with no blank line, naming the event-size limit", async () => {
    // The bypass of a line-only cap: every line is short and terminated, but
    // the parser appends each `data:` line to the pending event until a blank
    // line arrives.
    const { stream, state } = capped(
      ["data: /m\n\n", "data: aa\n", "data: bb\n", "data: cc\n"],
      16,
      true,
    );
    const { text, error } = await drain(stream);
    expect(error).toBeInstanceOf(SseLineTooLongError);
    expect((error as SseLineTooLongError).kind).toBe("event");
    expect((error as Error).message).toContain("16-byte event-size limit");
    expect(text).toBe("data: /m\n\ndata: aa\n");
    await vi.waitFor(() => expect(state.cancelled).toBe(true));
  });

  it.each([
    ["LF LF", ["data: aaaaaa\n\n", "data: bbbbbb\n\n", "data: cccccc\n\n"]],
    ["CR CR", ["data: aaaaaa\r\r", "data: bbbbbb\r\r", "data: cccccc\r\r"]],
    [
      "CRLF CRLF",
      ["data: aaaaaa\r\n\r\n", "data: bbbbbb\r\n\r\n", "data: cccccc\r\n\r\n"],
    ],
    [
      "LF LF split across chunks",
      ["data: aaaaaa\n", "\ndata: bbbbbb\n", "\ndata: cccccc\n", "\n"],
    ],
    [
      "CR CR split across chunks",
      ["data: aaaaaa\r", "\rdata: bbbbbb\r", "\rdata: cccccc\r", "\r"],
    ],
    [
      "CRLF CRLF split at every byte boundary",
      ["data: aaaaaa\r", "\n", "\r", "\ndata: bbbbbb\r", "\n\r", "\n"],
    ],
  ])("resets the event count on a blank line (%s)", async (_name, chunks) => {
    // Each event is 15 bytes with its terminators; three of them are 45.
    const { text, error } = await drain(capped(chunks, 16).stream);
    expect(error).toBeUndefined();
    expect(text).toBe(chunks.join(""));
  });

  it("does not read a CRLF split across chunks as a blank line", async () => {
    // `\r` | `\n` is one terminator, so the event keeps growing and errors.
    const { error } = await drain(
      capped(["data: aaa\r", "\ndata: bbb\r", "\ndata: ccc\r", "\n"], 16)
        .stream,
    );
    expect(error).toBeInstanceOf(SseLineTooLongError);
    expect((error as SseLineTooLongError).kind).toBe("event");
  });

  it("treats a terminator as the stream's first byte as a blank line", async () => {
    const chunks = ["\n", "data: aaaaaa\n\n"];
    const { text, error } = await drain(capped(chunks, 16).stream);
    expect(error).toBeUndefined();
    expect(text).toBe(chunks.join(""));
  });

  it("passes a legitimate many-event stream under the cap through intact", async () => {
    const events = Array.from(
      { length: 200 },
      (_, i) => `id: ${i}\nevent: message\ndata: {"n":${i}}\n\n`,
    ).join("");
    const chunks = [
      events.slice(0, 1000),
      events.slice(1000, 3001),
      events.slice(3001),
    ];
    const { text, error } = await drain(capped(chunks, 64).stream);
    expect(error).toBeUndefined();
    expect(text).toBe(events);
  });

  it("counts a run continued across chunks against the cap", async () => {
    const { error } = await drain(
      capped(
        ["e".repeat(10), "e".repeat(5) + "\n", "e".repeat(9), "e".repeat(8)],
        16,
      ).stream,
    );
    expect(error).toBeInstanceOf(SseLineTooLongError);
  });

  it("defaults to the shipped cap", async () => {
    const { text, error } = await drain(
      source(["data: x\n\n"]).stream.pipeThrough(createSseLineCapStream()),
    );
    expect(error).toBeUndefined();
    expect(text).toBe("data: x\n\n");
    expect(SSE_MAX_LINE_BYTES).toBe(16 * 1024 * 1024);
  });
});

describe("createSseLineCapFetch", () => {
  const URL_ = "https://mcp.example.com/mcp";

  function upstream(body: BodyInit | null, init: ResponseInit) {
    const response = new Response(body, init);
    Object.defineProperty(response, "url", { value: URL_ + "?final" });
    Object.defineProperty(response, "redirected", { value: true });
    return response;
  }

  it("caps a text/event-stream response and keeps its status, headers, url and redirected", async () => {
    const base = vi.fn<typeof fetch>(async () =>
      upstream("data: " + "a".repeat(40), {
        status: 200,
        statusText: "OK",
        headers: {
          "content-type": "Text/Event-Stream; charset=utf-8",
          "x-a": "1",
        },
      }),
    );
    const res = await createSseLineCapFetch(base, 16)(URL_, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.statusText).toBe("OK");
    expect(res.headers.get("x-a")).toBe("1");
    expect(res.url).toBe(URL_ + "?final");
    expect(res.redirected).toBe(true);
    expect(typeof res.type).toBe("string");
    expect((await drain(res.body!)).error).toBeInstanceOf(SseLineTooLongError);
  });

  it("caps a GET that asked for an event stream even when the server mislabels the reply", async () => {
    // The Streamable HTTP transport parses a 2xx standalone-GET body as SSE
    // without checking its Content-Type.
    const base = vi.fn<typeof fetch>(async () =>
      upstream("a".repeat(40), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const fetchFn = createSseLineCapFetch(base, 16);
    const viaInit = await fetchFn(URL_, {
      headers: { accept: "text/event-stream" },
    });
    expect((await drain(viaInit.body!)).error).toBeInstanceOf(
      SseLineTooLongError,
    );
    const viaRequest = await fetchFn(
      new Request(URL_, { headers: { accept: "text/event-stream" } }),
    );
    expect((await drain(viaRequest.body!)).error).toBeInstanceOf(
      SseLineTooLongError,
    );
  });

  it.each([
    [
      "a JSON reply to a POST",
      {
        method: "POST",
        headers: { accept: "application/json, text/event-stream" },
      },
      { status: 200, headers: { "content-type": "application/json" } },
    ],
    [
      "a GET that did not ask for an event stream",
      { headers: { accept: "application/json" } },
      { status: 200, headers: { "content-type": "application/json" } },
    ],
    ["a GET with no Accept and no Content-Type", undefined, { status: 200 }],
    [
      "an error status, even on an event stream",
      { headers: { accept: "text/event-stream" } },
      { status: 401, headers: { "content-type": "text/event-stream" } },
    ],
  ] as Array<[string, RequestInit | undefined, ResponseInit]>)(
    "leaves %s untouched",
    async (_name, init, responseInit) => {
      const original = new Response("a".repeat(40), responseInit);
      const fetchFn = createSseLineCapFetch(async () => original, 16);
      expect(await fetchFn(URL_, init)).toBe(original);
    },
  );

  it("leaves a bodiless event-stream response untouched", async () => {
    const original = new Response(null, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const fetchFn = createSseLineCapFetch(async () => original, 16);
    expect(await fetchFn(URL_)).toBe(original);
  });
});

/**
 * The real SDK transports, built by `createTransportNode` with the shipped
 * cap. One over-cap chunk is enough to cross it, and since the chunk that
 * crosses the cap is never delivered, the parser never sees it.
 */
describe("createTransportNode applies the SSE line cap", () => {
  const URL_ = "https://mcp.example.com/mcp";
  const OVERSIZED = new Uint8Array(SSE_MAX_LINE_BYTES + 1).fill(0x61);
  const REQUEST: JSONRPCRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  };

  function sseResponse(chunks: Array<string | Uint8Array>): Response {
    return new Response(source(chunks).stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  function errorsOf(transport: { onerror?: (error: Error) => void }) {
    const errors: Error[] = [];
    transport.onerror = (error) => errors.push(error);
    return errors;
  }

  it("errors the legacy SSE GET stream with the named limit", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      sseResponse([
        "event: endpoint\ndata: /messages\n\n",
        "data: ",
        OVERSIZED,
      ]),
    );
    const { transport } = createTransportNode(
      { type: "sse", url: URL_ },
      { fetchFn },
    );
    const errors = errorsOf(transport);
    await transport.start();
    await vi.waitFor(() =>
      expect(errors.map((e) => e.message).join("\n")).toContain(
        `${SSE_MAX_LINE_BYTES}-byte line-length limit`,
      ),
    );
    await transport.close();
  });

  it("errors the legacy SSE GET stream on terminated lines with no blank line, naming the event-size limit", async () => {
    // 17 terminated 1 MiB `data:` lines: each is under the line cap, together
    // they exceed the event cap.
    const MIB_LINE = new Uint8Array(1024 * 1024).fill(0x61);
    MIB_LINE.set(encoder.encode("data: "), 0);
    MIB_LINE[MIB_LINE.length - 1] = 0x0a;
    const fetchFn = vi.fn<typeof fetch>(async () =>
      sseResponse([
        "event: endpoint\ndata: /messages\n\n",
        ...Array.from({ length: 17 }, () => MIB_LINE),
      ]),
    );
    const { transport } = createTransportNode(
      { type: "sse", url: URL_ },
      { fetchFn },
    );
    const errors = errorsOf(transport);
    await transport.start();
    await vi.waitFor(() =>
      expect(errors.map((e) => e.message).join("\n")).toContain(
        `${SSE_MAX_LINE_BYTES}-byte event-size limit`,
      ),
    );
    await transport.close();
  });

  it("errors a Streamable HTTP POST reply stream on terminated lines with no blank line, naming the event-size limit", async () => {
    const MIB_LINE = new Uint8Array(1024 * 1024).fill(0x61);
    MIB_LINE.set(encoder.encode("data: "), 0);
    MIB_LINE[MIB_LINE.length - 1] = 0x0a;
    const fetchFn = vi.fn<typeof fetch>(async () =>
      sseResponse(Array.from({ length: 17 }, () => MIB_LINE)),
    );
    const { transport } = createTransportNode(
      { type: "streamable-http", url: URL_ },
      { fetchFn },
    );
    const errors = errorsOf(transport);
    await transport.start();
    await transport.send(REQUEST);
    await vi.waitFor(() =>
      expect(errors.map((e) => e.message).join("\n")).toContain(
        `${SSE_MAX_LINE_BYTES}-byte event-size limit`,
      ),
    );
    await transport.close();
  });

  it("errors a Streamable HTTP POST reply stream with the named limit", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      sseResponse(["data: ", OVERSIZED]),
    );
    const { transport } = createTransportNode(
      { type: "streamable-http", url: URL_ },
      { fetchFn },
    );
    const errors = errorsOf(transport);
    await transport.start();
    await transport.send(REQUEST);
    await vi.waitFor(() =>
      expect(errors.map((e) => e.message).join("\n")).toContain(
        `${SSE_MAX_LINE_BYTES}-byte line-length limit`,
      ),
    );
    await transport.close();
  });

  it("errors the Streamable HTTP standalone GET stream, even mislabelled, with the named limit", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      if ((init?.method ?? "GET") === "GET") {
        // No event-stream Content-Type: the SDK parses it as SSE anyway.
        return new Response(source(["data: ", OVERSIZED]).stream, {
          status: 200,
        });
      }
      return new Response(null, { status: 202 });
    });
    const { transport } = createTransportNode(
      { type: "streamable-http", url: URL_ },
      { fetchFn },
    );
    const errors = errorsOf(transport);
    await transport.start();
    // Accepting `notifications/initialized` is what opens the standalone GET.
    await transport.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    await vi.waitFor(() =>
      expect(errors.map((e) => e.message).join("\n")).toContain(
        `${SSE_MAX_LINE_BYTES}-byte line-length limit`,
      ),
    );
    await transport.close();
  });

  it("caps a caller-supplied eventSourceInit.fetch on the legacy SSE path", async () => {
    const sseFetch = vi.fn<typeof fetch>(async () =>
      sseResponse([
        "event: endpoint\ndata: /messages\n\n",
        "data: ",
        OVERSIZED,
      ]),
    );
    const { transport } = createTransportNode({
      type: "sse",
      url: URL_,
      eventSourceInit: { fetch: sseFetch },
    });
    const errors = errorsOf(transport);
    await transport.start();
    await vi.waitFor(() =>
      expect(errors.map((e) => e.message).join("\n")).toContain(
        `${SSE_MAX_LINE_BYTES}-byte line-length limit`,
      ),
    );
    expect(sseFetch).toHaveBeenCalled();
    await transport.close();
  });
});
