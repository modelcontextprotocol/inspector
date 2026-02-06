/**
 * Tests for the proxy server's POST /fetch endpoint.
 * Spawns the server and hits it like any other HTTP client would.
 */
import { spawn, type ChildProcess } from "child_process";
import { resolve } from "path";

const TEST_PORT = 16321;
const TEST_TOKEN = "test-proxy-token-12345";
const SERVER_PATH = resolve(__dirname, "../../../server/build/index.js");

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
        url: "https://example.com/",
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
        url: "https://example.com/",
        init: { method: "GET" },
      }),
    });
    expect(res.status).toBe(401);
  });

  it("forwards request when auth token is valid", async () => {
    const res = await fetch(`${baseUrl}/fetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MCP-Proxy-Auth": `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({
        url: "https://example.com/",
        init: { method: "GET" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe(200);
    expect(body.body).toBeDefined();
  });
});
