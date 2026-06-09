/**
 * Integration tests for PUT /api/servers/order — the reorder route added for
 * #1369. Spins up createRemoteApp against a per-test tmp mcpConfigPath and
 * exercises the route via real HTTP, asserting on the resulting on-disk
 * iteration order and the conflict/validation rejections.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server.js";
import { InMemorySecretStore } from "@inspector/core/auth/node/secret-store.js";
import type { MCPConfig } from "@inspector/core/mcp/types.js";

interface Harness {
  baseUrl: string;
  server: ServerType;
  configPath: string;
  tempDir: string;
}

async function startServer(
  configPath: string,
): Promise<{ baseUrl: string; server: ServerType }> {
  const { app } = createRemoteApp({
    dangerouslyOmitAuth: true,
    mcpConfigPath: configPath,
    initialConfig: { defaultEnvironment: {} },
    secretStore: new InMemorySecretStore(),
  });
  return new Promise((resolve, reject) => {
    const server = serve(
      { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
      (info) => {
        const port =
          info && typeof info === "object" && "port" in info
            ? (info as { port: number }).port
            : 0;
        resolve({ baseUrl: `http://127.0.0.1:${port}`, server });
      },
    );
    server.on("error", reject);
  });
}

async function setup(seed: MCPConfig): Promise<Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inspector-servers-order-"));
  const configPath = join(tempDir, "mcp.json");
  writeFileSync(configPath, JSON.stringify(seed, null, 2));
  const { baseUrl, server } = await startServer(configPath);
  return { baseUrl, server, configPath, tempDir };
}

async function teardown(h: Harness): Promise<void> {
  await new Promise<void>((resolve) => h.server.close(() => resolve()));
  try {
    rmSync(h.tempDir, { recursive: true });
  } catch {
    /* ignore */
  }
}

function readOrder(path: string): string[] {
  const cfg = JSON.parse(readFileSync(path, "utf-8")) as MCPConfig;
  return Object.keys(cfg.mcpServers);
}

const SEED: MCPConfig = {
  mcpServers: {
    alpha: { type: "stdio", command: "a" },
    beta: { type: "stdio", command: "b" },
    gamma: { type: "stdio", command: "g" },
  },
};

async function putOrder(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/servers/order`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/servers/order", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup(SEED);
  });

  afterEach(async () => {
    await teardown(h);
  });

  it("rewrites mcp.json in the supplied order", async () => {
    const res = await putOrder(h.baseUrl, {
      order: ["gamma", "alpha", "beta"],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(readOrder(h.configPath)).toEqual(["gamma", "alpha", "beta"]);
  });

  it("preserves each entry's config when reordering (values untouched)", async () => {
    await putOrder(h.baseUrl, { order: ["beta", "gamma", "alpha"] });
    const cfg = JSON.parse(readFileSync(h.configPath, "utf-8")) as MCPConfig;
    expect(cfg.mcpServers.alpha).toEqual({ type: "stdio", command: "a" });
    expect(cfg.mcpServers.beta).toEqual({ type: "stdio", command: "b" });
    expect(cfg.mcpServers.gamma).toEqual({ type: "stdio", command: "g" });
  });

  it("rejects an order missing an on-disk id (409) and leaves the file unchanged", async () => {
    const res = await putOrder(h.baseUrl, { order: ["alpha", "beta"] });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /does not match/,
    );
    // Original order preserved.
    expect(readOrder(h.configPath)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("rejects an order containing an unknown id (409)", async () => {
    const res = await putOrder(h.baseUrl, {
      order: ["alpha", "beta", "ghost"],
    });
    expect(res.status).toBe(409);
    expect(readOrder(h.configPath)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("rejects duplicate ids in the order (400)", async () => {
    const res = await putOrder(h.baseUrl, {
      order: ["alpha", "alpha", "beta"],
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /duplicate/,
    );
    expect(readOrder(h.configPath)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("rejects a non-array order (400)", async () => {
    const res = await putOrder(h.baseUrl, { order: "alpha,beta,gamma" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /array of strings/,
    );
  });

  it("rejects an order array with a non-string element (400)", async () => {
    const res = await putOrder(h.baseUrl, { order: ["alpha", 2, "gamma"] });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid JSON body (400)", async () => {
    const res = await fetch(`${h.baseUrl}/api/servers/order`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{ not json",
    });
    expect(res.status).toBe(400);
  });

  it("is not captured by the :id route — 'order' is never treated as a server id", async () => {
    // Regression guard for route registration order: a PUT to /order must hit
    // the reorder handler, not PUT /api/servers/:id with id="order".
    const res = await putOrder(h.baseUrl, {
      order: ["gamma", "beta", "alpha"],
    });
    expect(res.status).toBe(200);
    expect(readOrder(h.configPath)).toEqual(["gamma", "beta", "alpha"]);
    // No phantom "order" server was created.
    expect(readOrder(h.configPath)).not.toContain("order");
  });
});
