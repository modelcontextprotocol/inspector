import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:net";
import { request } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHonoServer } from "../../../../server/server.js";
import type { WebServerConfig } from "../../../../server/web-server-config.js";
import type { WebServerHandle } from "../../../../server/types.js";
import { INSPECTOR_API_TOKEN_GLOBAL } from "../../../../../../core/mcp/remote/constants.js";

// See server-token-injection.test.ts for why this pattern.
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

interface RawResponse {
  status: number;
  body: string;
}

/**
 * Issue a GET over a real socket with an explicit `Host` header — `fetch`
 * derives `Host` from the URL, so it cannot send the name a browser would
 * after the name it loaded a page from is pointed at this address.
 */
function getWithHost(
  port: number,
  path: string,
  host: string,
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: { ...headers, host },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const TOKEN = "host-allow-list-token-1234567890";
const INDEX_HTML =
  "<!doctype html><html><head><title>Inspector</title></head>" +
  '<body><div id="root"></div></body></html>';

describe("startHonoServer Host header allow-list", () => {
  let handle: WebServerHandle;
  let port: number;
  let staticRoot: string;

  beforeAll(async () => {
    staticRoot = await mkdtemp(join(tmpdir(), "inspector-host-"));
    await writeFile(join(staticRoot, "index.html"), INDEX_HTML, "utf-8");
    await writeFile(join(staticRoot, "asset.js"), "1;\n", "utf-8");

    port = await findFreePort();
    const config: WebServerConfig = {
      port,
      hostname: "127.0.0.1",
      authToken: TOKEN,
      dangerouslyOmitAuth: false,
      initialMcpConfig: null,
      mcpConfigPath: undefined,
      writable: true,
      initialServers: null,
      storageDir: undefined,
      allowedOrigins: [
        `http://localhost:${port}`,
        `http://127.0.0.1:${port}`,
        `http://[::1]:${port}`,
      ],
      allowedHosts: ["proxy.internal"],
      sandboxPort: 0,
      appOriginPort: 0,
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

  it.each(["/", "/oauth/callback", "/asset.js", "/api/config"])(
    "refuses %s under a foreign Host without serving the token",
    async (path) => {
      const res = await getWithHost(port, path, "evil.example:6274", {
        "x-mcp-remote-auth": `Bearer ${TOKEN}`,
      });
      expect(res.status).toBe(403);
      expect(res.body).not.toContain(TOKEN);
      expect(res.body).not.toContain(INSPECTOR_API_TOKEN_GLOBAL);
    },
  );

  // Hosts without the bound port: it.each runs before beforeAll picks one,
  // and the port is not compared anyway (`:8080` stands in for a remap).
  it.each(["localhost", "127.0.0.1", "[::1]", "localhost:8080"])(
    "serves the token-injected page under Host %s",
    async (host) => {
      const res = await getWithHost(port, "/", host);
      expect(res.status).toBe(200);
      expect(res.body).toContain(TOKEN);
    },
  );

  it("serves the API under a loopback Host", async () => {
    const res = await getWithHost(port, "/api/config", `localhost:${port}`, {
      "x-mcp-remote-auth": `Bearer ${TOKEN}`,
    });
    expect(res.status).toBe(200);
  });

  it("serves a host admitted through allowedHosts", async () => {
    const res = await getWithHost(port, "/", "proxy.internal");
    expect(res.status).toBe(200);
    expect(res.body).toContain(TOKEN);
  });

  it("keeps the health probe answering under any Host", async () => {
    const res = await getWithHost(port, "/healthz", "evil.example");
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"status":"ok"}');
  });
});
