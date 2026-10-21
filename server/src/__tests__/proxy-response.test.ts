/**
 * Unit tests for proxy-response.ts
 *
 * Tests cover:
 *  - readCappedBody: bodies under and exactly at the cap are returned intact
 *  - a streamed body that passes the cap is rejected and its stream destroyed
 *  - a Content-Length above the cap is rejected before any chunk is read
 *  - a real node-fetch response from a server that is still sending is
 *    torn down (the server observes the connection close)
 */

import http from "node:http";
import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";
import nodeFetch from "node-fetch";
import { describe, it, expect, vi } from "vitest";

import {
  MAX_PROXY_RESPONSE_BYTES,
  ProxyResponseTooLargeError,
  readCappedBody,
  type CappedReadableResponse,
} from "../proxy-response.js";

function headersOf(
  entries: Record<string, string> = {},
): CappedReadableResponse["headers"] {
  const map = new Map(
    Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return { get: (name) => map.get(name.toLowerCase()) ?? null };
}

function responseOf(
  chunks: Array<Uint8Array | string>,
  headers: Record<string, string> = {},
): { response: CappedReadableResponse; stream: Readable } {
  const stream = Readable.from(chunks, { objectMode: false });
  return { response: { headers: headersOf(headers), body: stream }, stream };
}

describe("MAX_PROXY_RESPONSE_BYTES", () => {
  it("is 5 MiB", () => {
    expect(MAX_PROXY_RESPONSE_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe("readCappedBody", () => {
  it("returns a body under the cap", async () => {
    const { response } = responseOf([Buffer.from("hello "), "world"]);
    await expect(readCappedBody(response, 100)).resolves.toBe("hello world");
  });

  it("returns a body exactly at the cap", async () => {
    const { response } = responseOf([
      Buffer.alloc(6, "a"),
      Buffer.alloc(4, "b"),
    ]);
    await expect(readCappedBody(response, 10)).resolves.toBe("aaaaaabbbb");
  });

  it("accepts a Content-Length exactly at the cap", async () => {
    const { response } = responseOf([Buffer.alloc(10, "a")], {
      "Content-Length": "10",
    });
    await expect(readCappedBody(response, 10)).resolves.toBe("a".repeat(10));
  });

  it("decodes a multi-byte character split across chunks", async () => {
    const euro = Buffer.from("€");
    const { response } = responseOf([euro.subarray(0, 1), euro.subarray(1)]);
    await expect(readCappedBody(response, 100)).resolves.toBe("€");
  });

  it("strips a leading UTF-8 BOM, as response.text() does", async () => {
    const { response } = responseOf([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("{}"),
    ]);
    await expect(readCappedBody(response, 100)).resolves.toBe("{}");
  });

  it("returns an empty string for a null body", async () => {
    await expect(
      readCappedBody({ headers: headersOf(), body: null }, 10),
    ).resolves.toBe("");
  });

  it("uses MAX_PROXY_RESPONSE_BYTES when no cap is given", async () => {
    const { response } = responseOf([], {
      "content-length": String(MAX_PROXY_RESPONSE_BYTES + 1),
    });
    await expect(readCappedBody(response)).rejects.toThrow(
      `exceeds the ${MAX_PROXY_RESPONSE_BYTES}-byte limit`,
    );
  });

  it("rejects a streamed body that passes the cap and destroys the stream", async () => {
    const pulled: number[] = [];
    function* source() {
      for (let i = 0; i < 100; i++) {
        pulled.push(i);
        yield Buffer.alloc(4, "x");
      }
    }
    const stream = Readable.from(source(), { objectMode: false });
    const destroy = vi.spyOn(stream, "destroy");

    await expect(
      readCappedBody({ headers: headersOf(), body: stream }, 10),
    ).rejects.toBeInstanceOf(ProxyResponseTooLargeError);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(stream.destroyed).toBe(true);
    // 3 chunks (12 bytes) pass the 10-byte cap; the stream must not be
    // drained to its end. Allow for a little read-ahead buffering.
    expect(pulled.length).toBeLessThan(100);
  });

  it("counts string chunks by their UTF-8 byte length", async () => {
    // Three characters, nine bytes.
    const { response, stream } = responseOf(["€€€"]);
    await expect(readCappedBody(response, 8)).rejects.toBeInstanceOf(
      ProxyResponseTooLargeError,
    );
    expect(stream.destroyed).toBe(true);
  });

  it("rejects a Content-Length over the cap without reading the body", async () => {
    const next = vi.fn();
    const destroy = vi.fn();
    const body = {
      [Symbol.asyncIterator]: () => ({ next }),
      destroy,
    };

    await expect(
      readCappedBody(
        { headers: headersOf({ "content-length": "11" }), body },
        10,
      ),
    ).rejects.toThrow("Upstream response body exceeds the 10-byte limit");

    expect(next).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("rejects a Content-Length over the cap on a null body", async () => {
    await expect(
      readCappedBody(
        { headers: headersOf({ "content-length": "11" }), body: null },
        10,
      ),
    ).rejects.toBeInstanceOf(ProxyResponseTooLargeError);
  });

  it("ignores a non-numeric Content-Length and still enforces the cap", async () => {
    const { response } = responseOf([Buffer.alloc(11)], {
      "content-length": "bogus",
    });
    await expect(readCappedBody(response, 10)).rejects.toBeInstanceOf(
      ProxyResponseTooLargeError,
    );
  });

  it("does not trust an understated Content-Length", async () => {
    const { response } = responseOf([Buffer.alloc(11)], {
      "content-length": "1",
    });
    await expect(readCappedBody(response, 10)).rejects.toBeInstanceOf(
      ProxyResponseTooLargeError,
    );
  });

  it("does not await the iterator's return() on overflow", async () => {
    // An iterator whose return() never settles: a for-await loop exiting early
    // would hang on it. readCappedBody must reject regardless.
    const returnFn = vi.fn(() => new Promise<never>(() => {}));
    const body = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false as const, value: Buffer.alloc(8) }),
        return: returnFn,
      }),
      destroy: vi.fn(),
    };

    await expect(
      readCappedBody({ headers: headersOf(), body }, 10),
    ).rejects.toBeInstanceOf(ProxyResponseTooLargeError);
    expect(returnFn).not.toHaveBeenCalled();
    expect(body.destroy).toHaveBeenCalledTimes(1);
  });

  it("propagates a stream error that is not an overflow", async () => {
    const stream = new Readable({
      read() {
        this.destroy(new Error("socket hang up"));
      },
    });
    await expect(
      readCappedBody({ headers: headersOf(), body: stream }, 10),
    ).rejects.toThrow("socket hang up");
  });

  it("cancels a real node-fetch stream from a server that is still sending", async () => {
    const cap = 64 * 1024;
    let serverSawClose!: () => void;
    const closed = new Promise<void>((resolve) => {
      serverSawClose = resolve;
    });
    let timer: NodeJS.Timeout | undefined;

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      const chunk = Buffer.alloc(16 * 1024, "y");
      // Bounded at four times the cap, and the response is left open rather
      // than ended: a regression then fails the assertions below (the read
      // would hang until the test timeout) instead of exhausting the worker.
      let written = 0;
      timer = setInterval(() => {
        if (written >= cap * 4) {
          clearInterval(timer);
          return;
        }
        written += chunk.length;
        res.write(chunk);
      }, 1);
      res.on("close", () => {
        clearInterval(timer);
        serverSawClose();
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );

    try {
      const { port } = server.address() as AddressInfo;
      const response = await nodeFetch(`http://127.0.0.1:${port}/`);

      await expect(readCappedBody(response, cap)).rejects.toBeInstanceOf(
        ProxyResponseTooLargeError,
      );
      // The upstream connection is torn down rather than left streaming.
      await closed;
    } finally {
      clearInterval(timer);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
