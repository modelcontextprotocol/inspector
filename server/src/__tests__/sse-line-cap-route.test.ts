/**
 * Runtime check that the proxy applies the SSE line cap to every upstream
 * event stream it hands the SDK.
 *
 * sse-line-cap.test.ts covers the transform itself; this file connects the
 * real proxy to an upstream that opens an event stream and then sends one line
 * longer than MAX_SSE_LINE_BYTES with no terminator, once over the `sse`
 * transport (GET stream, parsed by `eventsource`) and once over
 * `streamable-http` (an SSE response to a POST, parsed by
 * `EventSourceParserStream`). Without the cap neither parser ever reports an
 * error, so a call site that stops applying it fails here by timing out. The
 * upstream sends a bounded amount and then idles, so a regression cannot
 * exhaust the test worker.
 *
 * index.ts starts listening on import, so the proxy is configured through
 * environment variables before a dynamic import.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

import { MAX_SSE_LINE_BYTES } from "../sse-line-cap.js";

const PROXY_TOKEN = "proxy-token-for-test-6d2f";
// The default allowed origin when CLIENT_PORT and ALLOWED_ORIGINS are unset.
const ALLOWED_ORIGIN = "http://localhost:6274";
const CHUNK = Buffer.alloc(64 * 1024, "x");
// Over the cap by a margin, and bounded.
const OVERSIZE_LINE_BYTES = MAX_SSE_LINE_BYTES + 1024 * 1024;
const TEST_TIMEOUT_MS = 30_000;
const WAIT_TIMEOUT_MS = 20_000;

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

async function freePort(): Promise<number> {
  const probe = http.createServer();
  const port = await listen(probe);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function waitForProxy(port: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/health`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`proxy did not start listening on port ${port}`);
}

// Writes `total` unterminated bytes in CHUNK-sized pieces, honoring
// backpressure, then leaves the response open.
function writeUnterminated(res: http.ServerResponse, total: number): void {
  let remaining = total;
  const pump = () => {
    while (remaining > 0) {
      const piece = CHUNK.subarray(0, Math.min(CHUNK.length, remaining));
      remaining -= piece.length;
      if (!res.write(piece)) {
        res.once("drain", pump);
        return;
      }
    }
  };
  pump();
}

describe("upstream SSE line cap", () => {
  // Paths whose oversize stream the proxy has torn down.
  const closedStreams = new Set<string>();

  const upstream = http.createServer((req, res) => {
    const path = req.url ?? "";
    if (req.method === "GET" && path.startsWith("/sse")) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("event: endpoint\ndata: /message?sessionId=s1\n\n");
      res.write("data: ");
      writeUnterminated(res, OVERSIZE_LINE_BYTES);
      res.on("close", () => closedStreams.add("/sse"));
      return;
    }
    if (req.method === "POST" && path.startsWith("/mcp")) {
      req.resume();
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: ");
      writeUnterminated(res, OVERSIZE_LINE_BYTES);
      res.on("close", () => closedStreams.add("/mcp"));
      return;
    }
    if (req.method === "POST") {
      req.resume();
      res.writeHead(202).end();
      return;
    }
    res.writeHead(405).end();
  });
  let upstreamPort = 0;
  let proxyPort = 0;

  beforeAll(async () => {
    upstreamPort = await listen(upstream);
    proxyPort = await freePort();
    vi.stubEnv("SERVER_PORT", String(proxyPort));
    vi.stubEnv("HOST", "127.0.0.1");
    vi.stubEnv("MCP_PROXY_AUTH_TOKEN", PROXY_TOKEN);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    await import("../index.js");
    await waitForProxy(proxyPort);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  function errorOutput(): string {
    return vi
      .mocked(console.error)
      .mock.calls.map((args) => args.map(String).join(" "))
      .join("\n");
  }

  const proxyHeaders = {
    origin: ALLOWED_ORIGIN,
    "x-mcp-proxy-auth": `Bearer ${PROXY_TOKEN}`,
  };

  it(
    "fails an sse-transport stream whose line exceeds the cap",
    async () => {
      vi.mocked(console.error).mockClear();
      const controller = new AbortController();
      const target = new URL(`http://127.0.0.1:${proxyPort}/sse`);
      target.searchParams.set("transportType", "sse");
      target.searchParams.set("url", `http://127.0.0.1:${upstreamPort}/sse`);

      try {
        const response = await fetch(target, {
          headers: proxyHeaders,
          signal: controller.signal,
        });
        expect(response.status).toBe(200);

        await vi.waitFor(
          () => {
            expect(errorOutput()).toContain(
              `exceeds the ${MAX_SSE_LINE_BYTES}-byte limit (MAX_SSE_LINE_BYTES)`,
            );
            // The proxy also releases the upstream connection.
            expect(closedStreams.has("/sse")).toBe(true);
          },
          { timeout: WAIT_TIMEOUT_MS, interval: 100 },
        );
      } finally {
        controller.abort();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "fails a streamable-http SSE response whose line exceeds the cap",
    async () => {
      vi.mocked(console.error).mockClear();
      const controller = new AbortController();
      const target = new URL(`http://127.0.0.1:${proxyPort}/mcp`);
      target.searchParams.set("transportType", "streamable-http");
      target.searchParams.set("url", `http://127.0.0.1:${upstreamPort}/mcp`);

      // The proxy's answer to the browser never completes here, so the request
      // is left pending and aborted once the proxy has logged the failure.
      const pending = fetch(target, {
        method: "POST",
        headers: {
          ...proxyHeaders,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "test", version: "0.0.0" },
          },
        }),
        signal: controller.signal,
      }).catch(() => undefined);

      try {
        await vi.waitFor(
          () => {
            expect(errorOutput()).toContain(
              `exceeds the ${MAX_SSE_LINE_BYTES}-byte limit (MAX_SSE_LINE_BYTES)`,
            );
            expect(closedStreams.has("/mcp")).toBe(true);
          },
          { timeout: WAIT_TIMEOUT_MS, interval: 100 },
        );
      } finally {
        controller.abort();
        await pending;
      }
    },
    TEST_TIMEOUT_MS,
  );
});
