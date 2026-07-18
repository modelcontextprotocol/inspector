import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "../..");

const wait = (ms: number) =>
  new Promise<void>((resolveWait) => setTimeout(resolveWait, ms));

async function getAvailablePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        rejectPort(new Error("Could not allocate a local test port"));
        return;
      }
      server.close((error) => {
        if (error) rejectPort(error);
        else resolvePort(address.port);
      });
    });
  });
}

test("keeps the proxy alive when a closed SSE client receives stdio stderr", async () => {
  const port = await getAvailablePort();
  const proxy = spawn(process.execPath, ["server/build/index.js"], {
    cwd: rootDir,
    env: {
      ...process.env,
      DANGEROUSLY_OMIT_AUTH: "true",
      HOST: "127.0.0.1",
      SERVER_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  proxy.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  proxy.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });

  try {
    for (
      let attempt = 0;
      attempt < 50 && !output.includes("Proxy server listening");
      attempt += 1
    ) {
      await wait(50);
    }
    assert.match(output, /Proxy server listening/);

    const mcpServer = [
      "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';",
      "import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';",
      "const server = new McpServer({ name: 'stderr-repro', version: '1.0.0' });",
      "await server.connect(new StdioServerTransport());",
      "setInterval(() => console.error('stderr after SSE close'), 20);",
    ].join(" ");
    const args = `--input-type=module -e ${JSON.stringify(mcpServer)}`;
    const url = new URL(`http://127.0.0.1:${port}/stdio`);
    url.searchParams.set("transportType", "stdio");
    url.searchParams.set("command", process.execPath);
    url.searchParams.set("args", args);

    const controller = new AbortController();
    const request = fetch(url, {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });
    await wait(250);
    controller.abort();
    await request.catch(() => undefined);
    await wait(500);

    assert.equal(proxy.exitCode, null, output);
  } finally {
    if (proxy.exitCode === null) proxy.kill();
  }
});
