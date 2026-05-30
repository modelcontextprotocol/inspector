import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHonoServer } from "../../../../server/server.js";
import type { WebServerConfig } from "../../../../server/web-server-config.js";
import type { WebServerHandle } from "../../../../server/types.js";
import { INSPECTOR_API_TOKEN_GLOBAL } from "../../../../../../core/mcp/remote/constants.js";

// Ask the OS for an ephemeral port, then release it for the server to claim.
// There's a vanishingly small reuse window between close and re-bind, but it's
// the standard pattern for "start a real server on a free port" in tests and
// far less flaky than hard-coding one.
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("Could not resolve a free port")));
      }
    });
  });
}

// Pull the injected token back out of the served index.html the same way the
// browser would — read `window.__INSPECTOR_API_TOKEN__ = "…"`.
function tokenFromHtml(html: string): string | undefined {
  const match = html.match(
    new RegExp(`window\\.${INSPECTOR_API_TOKEN_GLOBAL} = (.+?);</script>`),
  );
  if (!match) return undefined;
  return JSON.parse(match[1].replace(/\\u003c/g, "<")) as string;
}

const TOKEN = "test-injected-token-1234567890";
const INDEX_HTML =
  "<!doctype html><html><head><title>Inspector</title></head>" +
  '<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';

describe("startHonoServer index.html token injection (/ -> /api/*)", () => {
  let handle: WebServerHandle;
  let baseUrl: string;
  let staticRoot: string;

  beforeAll(async () => {
    staticRoot = await mkdtemp(join(tmpdir(), "inspector-inject-"));
    await writeFile(join(staticRoot, "index.html"), INDEX_HTML, "utf-8");

    const port = await findFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    const config: WebServerConfig = {
      port,
      hostname: "127.0.0.1",
      authToken: TOKEN,
      dangerouslyOmitAuth: false,
      initialMcpConfig: null,
      storageDir: undefined,
      // Allow the same-origin requests the test issues below.
      allowedOrigins: [baseUrl],
      sandboxPort: 0,
      sandboxHost: "127.0.0.1",
      logger: undefined,
      autoOpen: false,
      staticRoot,
    };
    handle = await startHonoServer(config);
  });

  afterAll(async () => {
    await handle?.close();
    if (staticRoot) await rm(staticRoot, { recursive: true, force: true });
  });

  it("embeds the auth token in the page served at /", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(tokenFromHtml(html)).toBe(TOKEN);
  });

  it("the embedded token authenticates a subsequent /api/* request", async () => {
    const indexRes = await fetch(`${baseUrl}/`);
    const token = tokenFromHtml(await indexRes.text());
    expect(token).toBe(TOKEN);

    const apiRes = await fetch(`${baseUrl}/api/config`, {
      headers: { "x-mcp-remote-auth": `Bearer ${token}` },
    });
    expect(apiRes.status).toBe(200);
  });

  it("rejects an /api/* request that omits the token (proving injection is what unblocks the flow)", async () => {
    const apiRes = await fetch(`${baseUrl}/api/config`);
    expect(apiRes.status).toBe(401);
  });
});
