import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";

const TEST_PORT = 16322;
const TEST_TOKEN = "stdio-reconnect-test-token";
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const SERVER_PATH = fileURLToPath(
  new URL("../build/index.js", import.meta.url),
);
const FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/stdio-shutdown-server.mjs", import.meta.url),
);

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForHealth(proxy, logs) {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    if (proxy.exitCode !== null) {
      throw new Error(`Proxy exited before becoming ready:\n${logs.join("")}`);
    }

    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // The proxy may still be binding its listen socket.
    }

    await delay(50);
  }

  throw new Error(`Proxy did not become ready:\n${logs.join("")}`);
}

async function connectStdioSession() {
  const controller = new AbortController();
  const url = new URL(`${BASE_URL}/stdio`);
  url.searchParams.set("transportType", "stdio");
  url.searchParams.set("command", process.execPath);
  url.searchParams.set("args", FIXTURE_PATH);

  const response = await fetch(url, {
    headers: { "X-MCP-Proxy-Auth": `Bearer ${TEST_TOKEN}` },
    signal: controller.signal,
  });

  assert.equal(response.status, 200);
  return controller;
}

test("STDIO session can reconnect after client disconnect", async (t) => {
  const logs = [];
  const proxy = spawn(process.execPath, [SERVER_PATH], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      SERVER_PORT: String(TEST_PORT),
      MCP_PROXY_AUTH_TOKEN: TEST_TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  proxy.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  proxy.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  t.after(async () => {
    if (proxy.exitCode === null) {
      proxy.kill();
      await once(proxy, "exit");
    }
  });

  await waitForHealth(proxy, logs);

  const firstSession = await connectStdioSession();
  firstSession.abort();
  await delay(200);

  assert.equal(proxy.exitCode, null, logs.join(""));
  assert.equal((await fetch(`${BASE_URL}/health`)).status, 200);

  const secondSession = await connectStdioSession();
  secondSession.abort();
  await delay(200);

  assert.equal(proxy.exitCode, null, logs.join(""));
});
