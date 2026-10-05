import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HEALTH_BODY,
  HEALTH_PATH,
  healthResponse,
  isHealthRequest,
} from "../../../../server/health.js";
import { startHonoServer } from "../../../../server/server.js";
import type { WebServerConfig } from "../../../../server/web-server-config.js";
import type { WebServerHandle } from "../../../../server/types.js";
import { INSPECTOR_API_TOKEN_GLOBAL } from "../../../../../../core/mcp/remote/constants.js";

// Ask the OS for an ephemeral port, then release it for the server to claim
// (same pattern as server-token-injection.test.ts).
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

describe("isHealthRequest", () => {
  it("matches GET and HEAD on the health path, case-insensitively by method", () => {
    expect(isHealthRequest("GET", HEALTH_PATH)).toBe(true);
    expect(isHealthRequest("HEAD", HEALTH_PATH)).toBe(true);
    expect(isHealthRequest("get", HEALTH_PATH)).toBe(true);
  });

  it("ignores a query string or fragment", () => {
    expect(isHealthRequest("GET", `${HEALTH_PATH}?t=123`)).toBe(true);
    expect(isHealthRequest("GET", `${HEALTH_PATH}#x`)).toBe(true);
  });

  it("rejects other methods", () => {
    expect(isHealthRequest("POST", HEALTH_PATH)).toBe(false);
    expect(isHealthRequest(undefined, HEALTH_PATH)).toBe(false);
  });

  it("rejects other paths, including a trailing slash, a sub-path and a missing url", () => {
    expect(isHealthRequest("GET", `${HEALTH_PATH}/`)).toBe(false);
    expect(isHealthRequest("GET", `${HEALTH_PATH}/x`)).toBe(false);
    expect(isHealthRequest("GET", "/api/healthz")).toBe(false);
    expect(isHealthRequest("GET", "/")).toBe(false);
    expect(isHealthRequest("GET", undefined)).toBe(false);
  });
});

describe("healthResponse", () => {
  it("answers GET with 200, the fixed body, and no-store", async () => {
    const res = healthResponse("GET");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("defaults to GET", async () => {
    expect(await healthResponse().json()).toEqual(HEALTH_BODY);
  });

  it("answers HEAD with the same status and headers but no body", async () => {
    const res = healthResponse("head");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");
  });

  it("keeps the shared body immutable", () => {
    expect(Object.isFrozen(HEALTH_BODY)).toBe(true);
  });
});

const TOKEN = "test-health-token-1234567890";

describe("startHonoServer GET /healthz", () => {
  let handle: WebServerHandle;
  let baseUrl: string;
  let staticRoot: string;

  beforeAll(async () => {
    staticRoot = await mkdtemp(join(tmpdir(), "inspector-health-"));
    await writeFile(
      join(staticRoot, "index.html"),
      "<!doctype html><html><head></head><body></body></html>",
      "utf-8",
    );
    const port = await findFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
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
      allowedOrigins: [baseUrl],
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

  it("answers 200 with only the fixed status body and no auth token", async () => {
    const res = await fetch(`${baseUrl}${HEALTH_PATH}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: "ok" });
    // Unauthenticated, so it must not leak the token the way `/` embeds it.
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(INSPECTOR_API_TOKEN_GLOBAL);
  });

  it("answers HEAD with 200 and no body", async () => {
    const res = await fetch(`${baseUrl}${HEALTH_PATH}`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("is answered from any Origin, since it sits outside the /api allow-list", async () => {
    const res = await fetch(`${baseUrl}${HEALTH_PATH}`, {
      headers: { origin: "http://not-allowed.example" },
    });
    expect(res.status).toBe(200);
  });

  it("leaves /api/* authenticated", async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(401);
  });
});
