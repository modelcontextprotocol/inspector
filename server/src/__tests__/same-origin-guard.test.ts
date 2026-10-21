/**
 * Runtime check that the proxy's API routes refuse same-origin browser
 * requests, and that DANGEROUSLY_ALLOW_SAME_ORIGIN_API turns that off.
 *
 * fetch-metadata.test.ts covers the helpers; this file imports the real
 * index.ts and sends real requests, so a middleware that stops calling the
 * check, or a flag that is no longer read from the environment, fails here.
 *
 * index.ts reads its configuration and starts listening on import, so each
 * configuration is set through environment variables before a fresh dynamic
 * import (vi.resetModules) on its own port.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";

const PROXY_TOKEN = "proxy-token-for-test-4d21";

async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
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

async function startProxy(env: Record<string, string>): Promise<number> {
  const port = await freePort();
  vi.stubEnv("SERVER_PORT", String(port));
  vi.stubEnv("HOST", "127.0.0.1");
  vi.stubEnv("MCP_PROXY_AUTH_TOKEN", PROXY_TOKEN);
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
  vi.resetModules();
  await import("../index.js");
  await waitForProxy(port);
  return port;
}

/** GET /config (an authenticated route) with an optional Sec-Fetch-Site. */
async function getConfig(port: number, secFetchSite?: string) {
  const headers: Record<string, string> = {
    "x-mcp-proxy-auth": `Bearer ${PROXY_TOKEN}`,
  };
  if (secFetchSite !== undefined) {
    headers["sec-fetch-site"] = secFetchSite;
  }
  const response = await fetch(`http://127.0.0.1:${port}/config`, {
    headers,
  });
  return { status: response.status, body: await response.text() };
}

beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("same-origin API requests (default)", () => {
  let port = 0;

  beforeAll(async () => {
    // Unset, regardless of the ambient environment.
    vi.stubEnv("DANGEROUSLY_ALLOW_SAME_ORIGIN_API", undefined);
    port = await startProxy({});
  });

  it("rejects Sec-Fetch-Site: same-origin with 403", async () => {
    const { status, body } = await getConfig(port, "same-origin");
    expect(status).toBe(403);
    expect(body).toContain("same-origin");
  });

  it.each([undefined, "none", "same-site", "cross-site"])(
    "lets Sec-Fetch-Site %p through to the route",
    async (site) => {
      const { status } = await getConfig(port, site);
      expect(status).toBe(200);
    },
  );
});

describe.each(["", "false", "0", "on"])(
  "DANGEROUSLY_ALLOW_SAME_ORIGIN_API=%p",
  (value) => {
    let port = 0;

    beforeAll(async () => {
      port = await startProxy({ DANGEROUSLY_ALLOW_SAME_ORIGIN_API: value });
    });

    it("keeps rejecting same-origin requests", async () => {
      expect((await getConfig(port, "same-origin")).status).toBe(403);
    });
  },
);

describe.each(["true", "1", "YES"])(
  "DANGEROUSLY_ALLOW_SAME_ORIGIN_API=%p",
  (value) => {
    let port = 0;

    beforeAll(async () => {
      port = await startProxy({ DANGEROUSLY_ALLOW_SAME_ORIGIN_API: value });
    });

    it("allows same-origin requests", async () => {
      expect((await getConfig(port, "same-origin")).status).toBe(200);
    });
  },
);
