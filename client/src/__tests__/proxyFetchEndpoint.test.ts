/**
 * Tests for the proxy server's POST /fetch endpoint.
 * Spawns the server and hits it like any other HTTP client would.
 */
import { spawn, type ChildProcess } from "child_process";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "http";
import { resolve } from "path";

const TEST_PORT = 16321;
const TEST_TOKEN = "test-proxy-token-12345";
const SERVER_PATH = resolve(__dirname, "../../../server/build/index.js");

/** Placeholder URL for tests where auth fails before the proxy fetches (no network). */
const UNUSED_UPSTREAM_URL = "http://127.0.0.1:1/unused";

async function waitForServer(baseUrl: string, maxWaitMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error("Server did not become ready");
}

/**
 * Runs `fn` with a local HTTP server on 127.0.0.1:ephemeral-port.
 * `origin` is `http://127.0.0.1:<port>` (no trailing path).
 */
async function withLocalUpstream(
  onRequest: (req: IncomingMessage, res: ServerResponse) => void,
  fn: (origin: string) => Promise<void>,
): Promise<void> {
  const upstream: Server = createServer(onRequest);

  await new Promise<void>((resolve, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = upstream.address();
  if (!addr || typeof addr === "string") {
    upstream.close();
    throw new Error("Expected TCP listen address");
  }

  const origin = `http://127.0.0.1:${addr.port}`;

  try {
    await fn(origin);
  } finally {
    await new Promise<void>((r) => upstream.close(() => r()));
  }
}

describe("POST /fetch endpoint", () => {
  let server: ChildProcess;
  const baseUrl = `http://localhost:${TEST_PORT}`;

  beforeAll(async () => {
    server = spawn("node", [SERVER_PATH], {
      env: {
        ...process.env,
        SERVER_PORT: String(TEST_PORT),
        MCP_PROXY_AUTH_TOKEN: TEST_TOKEN,
      },
      stdio: "ignore",
    });
    await waitForServer(baseUrl);
  }, 10000);

  afterAll(() => {
    server.kill();
  });

  it("returns 401 when no auth header", async () => {
    const res = await fetch(`${baseUrl}/fetch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: UNUSED_UPSTREAM_URL,
        init: { method: "GET" },
      }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when auth token is invalid", async () => {
    const res = await fetch(`${baseUrl}/fetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MCP-Proxy-Auth": "Bearer wrong-token",
      },
      body: JSON.stringify({
        url: UNUSED_UPSTREAM_URL,
        init: { method: "GET" },
      }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for non-http(s) URL when auth token is valid", async () => {
    const res = await fetch(`${baseUrl}/fetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MCP-Proxy-Auth": `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({
        url: "file:///etc/passwd",
        init: { method: "GET" },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Only http/https URLs are allowed");
  });

  it("returns 400 for invalid URL string when auth token is valid", async () => {
    const res = await fetch(`${baseUrl}/fetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MCP-Proxy-Auth": `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({
        url: "not a valid url",
        init: { method: "GET" },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid URL");
  });

  it("returns 400 when url is missing when auth token is valid", async () => {
    const res = await fetch(`${baseUrl}/fetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MCP-Proxy-Auth": `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({ init: { method: "GET" } }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Missing or invalid url");
  });

  it("forwards request when auth token is valid", async () => {
    const upstreamPayload = JSON.stringify({ hello: "proxy-fetch-test" });

    await withLocalUpstream(
      (req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(upstreamPayload);
      },
      async (origin) => {
        const upstreamUrl = `${origin}/ok`;

        const res = await fetch(`${baseUrl}/fetch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-MCP-Proxy-Auth": `Bearer ${TEST_TOKEN}`,
          },
          body: JSON.stringify({
            url: upstreamUrl,
            init: { method: "GET" },
          }),
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          ok: boolean;
          status: number;
          statusText: string;
          body: string;
          headers: Record<string, string>;
        };
        expect(body.ok).toBe(true);
        expect(body.status).toBe(200);
        expect(body.statusText).toBe("OK");
        expect(body.body).toBe(upstreamPayload);
        expect(body.headers["content-type"]).toMatch(/application\/json/i);
      },
    );
  });

  it("mirrors upstream 404 (non-2xx) when auth token is valid", async () => {
    await withLocalUpstream(
      (req, res) => {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"not_found"}');
      },
      async (origin) => {
        const upstreamUrl = `${origin}/missing`;

        const res = await fetch(`${baseUrl}/fetch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-MCP-Proxy-Auth": `Bearer ${TEST_TOKEN}`,
          },
          body: JSON.stringify({
            url: upstreamUrl,
            init: { method: "GET" },
          }),
        });

        expect(res.status).toBe(404);
        const body = (await res.json()) as {
          ok: boolean;
          status: number;
          body: string;
        };
        expect(body.ok).toBe(false);
        expect(body.status).toBe(404);
        expect(JSON.parse(body.body)).toEqual({ error: "not_found" });
      },
    );
  });
});
