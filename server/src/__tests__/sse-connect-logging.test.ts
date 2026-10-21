/**
 * Runtime check of the proxy's own connect-time log lines.
 *
 * log-format.test.ts covers the helpers; this file drives a real GET /sse
 * through the proxy and inspects what console.log actually received, so a
 * call site in index.ts that stops using the helpers fails here.
 *
 * index.ts starts listening on import, so the proxy is configured through
 * environment variables before a dynamic import. The upstream answers 404,
 * which ends the connection attempt quickly after the log lines are written.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

const PROXY_TOKEN = "proxy-token-for-test-3e9b";
const AUTH_VALUE = "Bearer upstream-value-7c51";
const API_KEY_VALUE = "api-key-value-91aa";
const ENV_VALUE = "env-value-55c2";

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

describe("GET /sse connect logging", () => {
  const upstream = http.createServer((_req, res) => {
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
    await import("../index.js");
    await waitForProxy(proxyPort);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it("logs header and env names but no values", async () => {
    const logSpy = vi.mocked(console.log);
    logSpy.mockClear();

    const target = new URL(`http://127.0.0.1:${proxyPort}/sse`);
    target.searchParams.set("transportType", "sse");
    target.searchParams.set("url", `http://127.0.0.1:${upstreamPort}/sse`);
    target.searchParams.set("env", JSON.stringify({ API_TOKEN: ENV_VALUE }));

    const response = await fetch(target, {
      headers: {
        "x-mcp-proxy-auth": `Bearer ${PROXY_TOKEN}`,
        authorization: AUTH_VALUE,
        "x-api-key": API_KEY_VALUE,
        "x-custom-auth-headers": JSON.stringify(["X-Api-Key"]),
      },
    });
    await response.body?.cancel();
    expect(response.status).toBe(404);

    const output = logSpy.mock.calls
      .map((args) => args.map(String).join(" "))
      .join("\n");

    // The lines were written, and they name what was forwarded...
    expect(output).toContain("SSE transport:");
    expect(output).toContain("Query parameters:");
    expect(output).toContain("authorization");
    expect(output).toContain("X-Api-Key");
    expect(output).toContain("API_TOKEN");
    // ...without any of the values.
    expect(output).not.toContain(AUTH_VALUE);
    expect(output).not.toContain("upstream-value");
    expect(output).not.toContain(API_KEY_VALUE);
    expect(output).not.toContain(ENV_VALUE);
    expect(output).not.toContain(PROXY_TOKEN);
  });
});
