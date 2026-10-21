/**
 * Runtime check of the /fetch route's response-body cap.
 *
 * proxy-response.test.ts covers readCappedBody itself; this file drives a real
 * POST /fetch through the proxy at a local upstream, so a route that stops
 * reading the body through the cap (for example by going back to
 * response.text()) fails here.
 *
 * index.ts starts listening on import, so the proxy is configured through
 * environment variables before a dynamic import.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

import { MAX_PROXY_RESPONSE_BYTES } from "../proxy-response.js";

const PROXY_TOKEN = "proxy-token-for-test-a41c";
// The default allowed origin when CLIENT_PORT and ALLOWED_ORIGINS are unset.
const ALLOWED_ORIGIN = "http://localhost:6274";
const CHUNK = Buffer.alloc(64 * 1024, "z");

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

// Writes `total` bytes of body in CHUNK-sized pieces, honoring backpressure.
function writeBody(res: http.ServerResponse, total: number): void {
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
    res.end();
  };
  pump();
}

describe("POST /fetch response-body cap", () => {
  const upstream = http.createServer((req, res) => {
    if (req.url === "/at-cap") {
      res.writeHead(200, { "content-type": "text/plain" });
      writeBody(res, MAX_PROXY_RESPONSE_BYTES);
      return;
    }
    if (req.url === "/over-cap-streamed") {
      // No Content-Length, so only the streaming check can stop it. Bounded
      // at four times the cap so a regression fails an assertion rather than
      // exhausting the test worker.
      res.writeHead(200, { "content-type": "text/plain" });
      writeBody(res, MAX_PROXY_RESPONSE_BYTES * 4);
      return;
    }
    if (req.url === "/over-cap-declared") {
      const size = MAX_PROXY_RESPONSE_BYTES + 1;
      res.writeHead(200, {
        "content-type": "text/plain",
        "content-length": String(size),
      });
      writeBody(res, size);
      return;
    }
    res.statusCode = 404;
    res.end();
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

  async function proxyFetch(path: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${proxyPort}/fetch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ALLOWED_ORIGIN,
        "x-mcp-proxy-auth": `Bearer ${PROXY_TOKEN}`,
      },
      body: JSON.stringify({ url: `http://127.0.0.1:${upstreamPort}${path}` }),
    });
  }

  it("mirrors a body exactly at the cap", async () => {
    const response = await proxyFetch("/at-cap");
    expect(response.status).toBe(200);
    const data = (await response.json()) as { status: number; body: string };
    expect(data.status).toBe(200);
    expect(data.body.length).toBe(MAX_PROXY_RESPONSE_BYTES);
  });

  it("returns 502 with an error for a streamed body over the cap", async () => {
    const response = await proxyFetch("/over-cap-streamed");
    expect(response.status).toBe(502);
    const data = (await response.json()) as Record<string, unknown>;
    // { error } with no `status` key is the shape the client's proxyFetch
    // treats as a proxy-side failure.
    expect(data).toEqual({
      error: `Upstream response body exceeds the ${MAX_PROXY_RESPONSE_BYTES}-byte limit`,
    });
  });

  it("returns 502 with an error for a Content-Length over the cap", async () => {
    const response = await proxyFetch("/over-cap-declared");
    expect(response.status).toBe(502);
    const data = (await response.json()) as Record<string, unknown>;
    expect(data).toEqual({
      error: `Upstream response body exceeds the ${MAX_PROXY_RESPONSE_BYTES}-byte limit`,
    });
  });
});
