/**
 * Integration tests for the /config endpoint's args handling.
 *
 * These tests spawn the real proxy server process and make actual HTTP requests
 * to verify that args containing spaces survive the serialisation round-trip
 * introduced by the start.js → server path.
 */

import { spawn, type ChildProcess } from "child_process";
import { resolve } from "path";

const SERVER_SRC = resolve(__dirname, "../src/index.ts");

// Fixed credentials — the server is bound to localhost only and killed after each test.
const AUTH_TOKEN = "test-token";
const CLIENT_PORT = "17274";
const ORIGIN = `http://localhost:${CLIENT_PORT}`;

// Use a different port per test to avoid EADDRINUSE across sequential runs.
let portSeed = 17280;

interface ServerHandle {
  port: number;
  process: ChildProcess;
}

async function startServer(extraArgs: string[] = []): Promise<ServerHandle> {
  const port = portSeed++;

  const proc = spawn("tsx", [SERVER_SRC, ...extraArgs], {
    env: {
      ...process.env,
      SERVER_PORT: String(port),
      CLIENT_PORT,
      MCP_PROXY_AUTH_TOKEN: AUTH_TOKEN,
      ALLOWED_ORIGINS: ORIGIN,
    },
    stdio: "pipe",
  });

  await waitForHealth(port);
  return { port, process: proc };
}

async function waitForHealth(port: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `Proxy server on port ${port} did not become healthy in ${timeoutMs}ms`,
  );
}

async function fetchConfig(handle: ServerHandle): Promise<{
  defaultArgs: string;
  defaultCommand: string;
}> {
  const res = await fetch(`http://localhost:${handle.port}/config`, {
    headers: {
      Origin: ORIGIN,
      "x-mcp-proxy-auth": `Bearer ${AUTH_TOKEN}`,
    },
  });
  if (!res.ok) throw new Error(`/config returned ${res.status}`);
  return res.json() as Promise<{ defaultArgs: string; defaultCommand: string }>;
}

let currentHandle: ServerHandle | null = null;

afterEach(() => {
  currentHandle?.process.kill();
  currentHandle = null;
});

describe("proxy server /config: args passed from start.js", () => {
  it("converts JSON-array args (new start.js format) to a shell-quoted string", async () => {
    // start.js now does: `--args=${JSON.stringify(mcpServerArgs)}`
    const args = ["--description", "get todays date", "--command", "date"];
    currentHandle = await startServer([`--args=${JSON.stringify(args)}`]);

    const config = await fetchConfig(currentHandle);

    // The /config endpoint must shell-quote the array so the client UI can
    // display it and shellParseArgs can round-trip it correctly.
    expect(config.defaultArgs).toBe(
      "--description 'get todays date' --command date",
    );
  });

  it("passes a legacy plain shell string through unchanged (backward compat)", async () => {
    // Direct invocations of the server binary that pass --args as a plain
    // shell string must continue to work.
    currentHandle = await startServer([
      "--args=--description 'get todays date' --command date",
    ]);

    const config = await fetchConfig(currentHandle);

    expect(config.defaultArgs).toBe(
      "--description 'get todays date' --command date",
    );
  });

  it("returns an empty string when no --args flag is given", async () => {
    currentHandle = await startServer([]);
    const config = await fetchConfig(currentHandle);
    expect(config.defaultArgs).toBe("");
  });

  it("handles args with backslashes", async () => {
    const args = ["--path", "C:\\Users\\foo"];
    currentHandle = await startServer([`--args=${JSON.stringify(args)}`]);
    const config = await fetchConfig(currentHandle);

    // Verify the round-trip: parse the shell-quoted string back into an array
    const { parse } = await import("shell-quote");
    const parsed = parse(config.defaultArgs) as string[];
    expect(parsed).toEqual(args);
  });

  it("handles args that look like JSON themselves", async () => {
    const args = ["--config", '{"key":"val"}'];
    currentHandle = await startServer([`--args=${JSON.stringify(args)}`]);
    const config = await fetchConfig(currentHandle);

    const { parse } = await import("shell-quote");
    const parsed = parse(config.defaultArgs) as string[];
    expect(parsed).toEqual(args);
  });
});
