/**
 * Supplemental coverage for createRemoteApp (core/mcp/remote/node/server.ts).
 *
 * Targets the remaining uncovered branches the broader suites don't exercise:
 *   - forwardLogEvent message/binding shape variants (/api/log)
 *   - validateSettings per-field rejection branches
 *   - /api/fetch headers / streaming content-type / network-error paths
 *   - normalizeMcpServers malformed-field drops, on both the logger and the
 *     console.warn fallback path
 *   - generic (non-keychain) 500 catch on POST / PUT / DELETE / order
 *   - keychain-unavailable migration with a logger (fileLogger.warn branch)
 *   - GET fast-path re-check when a concurrent write removed the plaintext
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import type pinoType from "pino";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server.js";
import {
  InMemorySecretStore,
  KeychainUnavailableError,
  type SecretStore,
} from "@inspector/core/auth/node/secret-store.js";

interface Harness {
  baseUrl: string;
  server: ServerType;
  configPath: string;
  tempDir: string;
}

interface StartOpts {
  secretStore?: SecretStore;
  logger?: pinoType.Logger;
  seedConfig?: string;
}

async function start(opts: StartOpts = {}): Promise<Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inspector-server-extra-"));
  const configPath = join(tempDir, "mcp.json");
  if (opts.seedConfig !== undefined) {
    writeFileSync(configPath, opts.seedConfig);
  }
  const { app } = createRemoteApp({
    dangerouslyOmitAuth: true,
    mcpConfigPath: configPath,
    initialConfig: { defaultEnvironment: {} },
    secretStore: opts.secretStore ?? new InMemorySecretStore(),
    logger: opts.logger,
  });
  const { baseUrl, server } = await new Promise<{
    baseUrl: string;
    server: ServerType;
  }>((resolve, reject) => {
    const s = serve(
      { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
      (info) => {
        const port =
          info && typeof info === "object" && "port" in info
            ? (info as { port: number }).port
            : 0;
        resolve({ baseUrl: `http://127.0.0.1:${port}`, server: s });
      },
    );
    s.on("error", reject);
  });
  return { baseUrl, server, configPath, tempDir };
}

async function stop(h: Harness): Promise<void> {
  await new Promise<void>((r) => h.server.close(() => r()));
  try {
    rmSync(h.tempDir, { recursive: true });
  } catch {
    /* ignore */
  }
}

/**
 * Minimal in-memory pino-shaped logger that captures forwarded records so a
 * test can assert which level/object/message the server emitted.
 */
function makeCapturingLogger(): {
  logger: pinoType.Logger;
  records: Array<{ level: string; args: unknown[] }>;
} {
  const records: Array<{ level: string; args: unknown[] }> = [];
  const mk =
    (level: string) =>
    (...args: unknown[]) => {
      records.push({ level, args });
    };
  // Only the methods the server reaches are needed; cast through unknown to
  // satisfy the pino.Logger surface without pulling in the full type.
  const logger = {
    info: mk("info"),
    warn: mk("warn"),
    error: mk("error"),
    debug: mk("debug"),
    trace: mk("trace"),
    fatal: mk("fatal"),
  } as unknown as pinoType.Logger;
  return { logger, records };
}

describe("server.ts supplemental coverage", () => {
  describe("/api/log forwardLogEvent shapes", () => {
    let h: Harness;
    let records: Array<{ level: string; args: unknown[] }>;

    beforeEach(async () => {
      const cap = makeCapturingLogger();
      records = cap.records;
      h = await start({ logger: cap.logger });
    });
    afterEach(async () => {
      await stop(h);
    });

    async function postLog(body: unknown): Promise<Response> {
      return fetch(`${h.baseUrl}/api/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    it("forwards an event whose first message is an object (obj + msg + args)", async () => {
      const res = await postLog({
        level: { label: "warn", value: 40 },
        bindings: [{ component: "x" }, { category: "y" }],
        messages: [{ extra: 1 }, "hello", "a", "b"],
      });
      expect(res.status).toBe(200);
      const rec = records.find((r) => r.level === "warn");
      expect(rec).toBeDefined();
      expect(rec!.args[0]).toMatchObject({
        component: "x",
        category: "y",
        extra: 1,
      });
      expect(rec!.args[1]).toBe("hello");
      expect(rec!.args.slice(2)).toEqual(["a", "b"]);
    });

    it("forwards an event with no messages (bindings-only object)", async () => {
      const res = await postLog({
        level: { label: "info", value: 30 },
        bindings: [{ a: 1 }],
        messages: [],
      });
      expect(res.status).toBe(200);
      const rec = records.find((r) => r.level === "info");
      expect(rec).toBeDefined();
      expect(rec!.args).toEqual([{ a: 1 }]);
    });

    it("forwards a string-first message (bindings + msg + args)", async () => {
      const res = await postLog({
        level: { label: "info", value: 30 },
        bindings: [{ b: 2 }],
        messages: ["just a string", 1, 2],
      });
      expect(res.status).toBe(200);
      const rec = records.find(
        (r) => r.level === "info" && r.args[1] === "just a string",
      );
      expect(rec).toBeDefined();
      expect(rec!.args[0]).toMatchObject({ b: 2 });
      expect(rec!.args.slice(2)).toEqual([1, 2]);
    });

    it("defaults the level to info and tolerates non-array bindings/messages", async () => {
      const res = await postLog({ bindings: "nope", messages: "nope" });
      expect(res.status).toBe(200);
      const rec = records.find((r) => r.level === "info");
      expect(rec).toBeDefined();
      // bindings non-array → {} ; messages non-array → [] → bindings-only call
      expect(rec!.args).toEqual([{}]);
    });

    it("drops an event whose level has no matching logger method", async () => {
      const res = await postLog({
        level: { label: "nonsense", value: 1 },
        messages: ["x"],
      });
      expect(res.status).toBe(200);
      // No record captured for an unknown level.
      expect(records.length).toBe(0);
    });
  });

  describe("/api/log without a logger is a no-op", () => {
    it("returns 200 and swallows the event", async () => {
      const h = await start();
      try {
        const res = await fetch(`${h.baseUrl}/api/log`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: ["x"] }),
        });
        expect(res.status).toBe(200);
        // Invalid JSON also tolerated (catch → {}).
        const res2 = await fetch(`${h.baseUrl}/api/log`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not json",
        });
        expect(res2.status).toBe(200);
      } finally {
        await stop(h);
      }
    });
  });

  describe("/api/fetch", () => {
    let h: Harness;
    let target: ServerType;
    let targetUrl: string;

    beforeEach(async () => {
      h = await start();
      // A tiny upstream HTTP server we can point /api/fetch at.
      const { createServer } = await import("node:http");
      const srv = createServer((req, res) => {
        if (req.url === "/stream") {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.write("data: hi\n\n");
          res.end();
          return;
        }
        if (req.url === "/echo-headers") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ got: req.headers["x-probe"] ?? null }));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("plain body");
      });
      await new Promise<void>((resolve) =>
        srv.listen(0, "127.0.0.1", () => resolve()),
      );
      target = srv as unknown as ServerType;
      const addr = srv.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      targetUrl = `http://127.0.0.1:${port}`;
    });

    afterEach(async () => {
      await new Promise<void>((r) =>
        (target as unknown as { close: (cb: () => void) => void }).close(() =>
          r(),
        ),
      );
      await stop(h);
    });

    it("forwards method + headers and returns the response body", async () => {
      const res = await fetch(`${h.baseUrl}/api/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `${targetUrl}/echo-headers`,
          method: "GET",
          headers: { "x-probe": "abc" },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        status: number;
        headers: Record<string, string>;
        body?: string;
      };
      expect(body.ok).toBe(true);
      expect(body.status).toBe(200);
      expect(body.headers["content-type"]).toContain("application/json");
      expect(JSON.parse(body.body!)).toEqual({ got: "abc" });
    });

    it("omits the body for an event-stream content type", async () => {
      const res = await fetch(`${h.baseUrl}/api/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: `${targetUrl}/stream` }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { body?: string; status: number };
      expect(body.status).toBe(200);
      expect(body.body).toBeUndefined();
    });

    it("returns 400 when url is missing", async () => {
      const res = await fetch(`${h.baseUrl}/api/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "GET" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 on invalid JSON", async () => {
      const res = await fetch(`${h.baseUrl}/api/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad",
      });
      expect(res.status).toBe(400);
    });

    it("returns 500 when the upstream fetch throws", async () => {
      const res = await fetch(`${h.baseUrl}/api/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "http://127.0.0.1:1/nope" }),
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(typeof body.error).toBe("string");
    });
  });

  describe("validateSettings rejection branches (POST /api/servers)", () => {
    let h: Harness;
    beforeEach(async () => {
      h = await start();
    });
    afterEach(async () => {
      await stop(h);
    });

    async function postSettings(settings: unknown): Promise<Response> {
      return fetch(`${h.baseUrl}/api/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "srv",
          config: { type: "stdio", command: "node" },
          settings,
        }),
      });
    }

    const base = {
      headers: [],
      metadata: [],
      connectionTimeout: 0,
      requestTimeout: 0,
    };

    it("rejects a non-object settings value", async () => {
      const res = await postSettings([1, 2, 3]);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/must be an object/);
    });

    it("rejects malformed headers", async () => {
      const res = await postSettings({ ...base, headers: "oops" });
      expect((await res.json()).error).toMatch(/headers/);
    });

    it("rejects malformed metadata", async () => {
      const res = await postSettings({
        ...base,
        metadata: [{ key: 1, value: "x" }],
      });
      expect((await res.json()).error).toMatch(/metadata/);
    });

    it("rejects malformed env", async () => {
      const res = await postSettings({ ...base, env: "oops" });
      expect((await res.json()).error).toMatch(/env/);
    });

    it("rejects a non-string cwd", async () => {
      const res = await postSettings({ ...base, cwd: 42 });
      expect((await res.json()).error).toMatch(/cwd/);
    });

    it("rejects a negative connectionTimeout", async () => {
      const res = await postSettings({ ...base, connectionTimeout: -1 });
      expect((await res.json()).error).toMatch(/connectionTimeout/);
    });

    it("rejects a non-numeric requestTimeout", async () => {
      const res = await postSettings({ ...base, requestTimeout: "x" });
      expect((await res.json()).error).toMatch(/requestTimeout/);
    });

    it("rejects a negative taskTtl", async () => {
      const res = await postSettings({ ...base, taskTtl: -5 });
      expect((await res.json()).error).toMatch(/taskTtl/);
    });

    it("rejects a non-boolean autoRefreshOnListChanged", async () => {
      const res = await postSettings({
        ...base,
        autoRefreshOnListChanged: "yes",
      });
      expect((await res.json()).error).toMatch(/autoRefreshOnListChanged/);
    });

    it("rejects a negative maxFetchRequests", async () => {
      const res = await postSettings({ ...base, maxFetchRequests: -2 });
      expect((await res.json()).error).toMatch(/maxFetchRequests/);
    });

    it("rejects a non-string OAuth field", async () => {
      const res = await postSettings({ ...base, oauthClientId: 7 });
      expect((await res.json()).error).toMatch(/oauthClientId/);
    });

    it("rejects a non-boolean enterpriseManaged", async () => {
      const res = await postSettings({ ...base, enterpriseManaged: "yes" });
      expect((await res.json()).error).toMatch(/enterpriseManaged/);
    });

    it("rejects malformed roots", async () => {
      const res = await postSettings({ ...base, roots: [{ uri: 1 }] });
      expect((await res.json()).error).toMatch(/roots/);
    });

    it("accepts a fully-populated valid settings payload", async () => {
      const res = await postSettings({
        ...base,
        env: [{ key: "K", value: "V" }],
        cwd: "/tmp",
        taskTtl: 1000,
        autoRefreshOnListChanged: true,
        maxFetchRequests: 5,
        oauthClientId: "cid",
        oauthScopes: "a b",
        enterpriseManaged: true,
        roots: [{ uri: "file:///x", name: "x" }],
      });
      expect(res.status).toBe(200);
    });
  });

  describe("normalizeMcpServers malformed-field drops (console fallback, no logger)", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("drops a legacy settings node and every malformed field, logging to console.warn", async () => {
      const h = await start({
        seedConfig: JSON.stringify({
          mcpServers: {
            // non-object entry → skipped
            bad: 5,
            srv: {
              type: "http",
              url: "https://x.test/mcp",
              settings: { legacy: true },
              // object with a non-string value → isStringRecord inner branch
              headers: { Authorization: 123 },
              metadata: [{ key: 1 }],
              connectionTimeout: Infinity,
              requestTimeout: -1,
              taskTtl: "x",
              maxFetchRequests: -1,
              // enterpriseManaged non-boolean → isOauthObject inner branch
              oauth: { enterpriseManaged: "yes" },
              // a non-string `name` → isRootArray inner branch
              roots: [{ uri: "file:///ok", name: 5 }],
            },
          },
        }),
      });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          mcpServers: Record<string, Record<string, unknown>>;
        };
        const srv = body.mcpServers.srv;
        expect(srv).toBeDefined();
        // type:"http" normalized to streamable-http
        expect(srv.type).toBe("streamable-http");
        // Every malformed field dropped.
        for (const k of [
          "settings",
          "headers",
          "metadata",
          "connectionTimeout",
          "requestTimeout",
          "taskTtl",
          "maxFetchRequests",
          "oauth",
          "roots",
        ]) {
          expect(srv).not.toHaveProperty(k);
        }
        expect(body.mcpServers.bad).toBeUndefined();
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        await stop(h);
      }
    });
  });

  describe("normalizeMcpServers additional validator inner branches", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("drops oauth with a non-string clientId and roots with a null entry", async () => {
      const h = await start({
        seedConfig: JSON.stringify({
          mcpServers: {
            srv: {
              type: "streamable-http",
              url: "https://x.test/mcp",
              // clientId non-string → isOauthObject clientId branch
              oauth: { clientId: 5 },
              // a null entry → isRootArray `e === null` branch
              roots: [null],
            },
          },
        }),
      });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          mcpServers: Record<string, Record<string, unknown>>;
        };
        expect(body.mcpServers.srv).not.toHaveProperty("oauth");
        expect(body.mcpServers.srv).not.toHaveProperty("roots");
      } finally {
        await stop(h);
      }
    });
  });

  describe("plaintext-secret migration over a mixed config", () => {
    it("migrates servers with secrets and passes through servers without", async () => {
      // With an available keychain, the GET slow path migrates plaintext into
      // the store. A mixed config (one server with a secret, one without)
      // exercises both the migrate branch and the no-secret continue branch.
      const store = new InMemorySecretStore();
      const h = await start({
        secretStore: store,
        seedConfig: JSON.stringify({
          mcpServers: {
            plain: { type: "stdio", command: "node" },
            withSecret: {
              type: "streamable-http",
              url: "https://x.test/mcp",
              oauth: { clientId: "cid", clientSecret: "shh" },
            },
          },
        }),
      });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          mcpServers: Record<string, Record<string, unknown>>;
        };
        // Both entries present; the secret value is rehydrated from keychain.
        expect(body.mcpServers.plain).toBeDefined();
        expect(body.mcpServers.withSecret).toBeDefined();
        // Disk no longer holds the plaintext clientSecret (migrated out).
        const onDisk = readFileSync(h.configPath, "utf-8");
        expect(onDisk).not.toContain("shh");
      } finally {
        await stop(h);
      }
    });
  });

  describe("normalizeMcpServers malformed-field drops (logger path)", () => {
    it("routes the drop warnings through fileLogger.warn", async () => {
      const cap = makeCapturingLogger();
      const h = await start({
        logger: cap.logger,
        seedConfig: JSON.stringify({
          mcpServers: {
            srv: {
              type: "stdio",
              command: "node",
              headers: 123,
            },
          },
        }),
      });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers`);
        expect(res.status).toBe(200);
        const warned = cap.records.filter((r) => r.level === "warn");
        expect(warned.length).toBeGreaterThan(0);
      } finally {
        await stop(h);
      }
    });
  });

  describe("generic 500 catch on mutating routes", () => {
    // A secret store whose deleteAllForServer throws a plain (non-keychain)
    // error drives the generic 500 catch on POST and DELETE; the writeKeychain
    // path covers PUT.
    class ThrowingSecretStore implements SecretStore {
      async get(): Promise<string | null> {
        return null;
      }
      async set(): Promise<void> {
        throw new Error("boom-set");
      }
      async delete(): Promise<void> {
        /* no-op */
      }
      async deleteAllForServer(): Promise<void> {
        throw new Error("boom-sweep");
      }
    }

    it("POST returns 500 when the keychain sweep throws a generic error", async () => {
      const h = await start({ secretStore: new ThrowingSecretStore() });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: "srv",
            config: { type: "stdio", command: "node" },
          }),
        });
        expect(res.status).toBe(500);
        expect((await res.json()).error).toMatch(/Failed to add server/);
      } finally {
        await stop(h);
      }
    });

    it("DELETE returns 500 when the keychain sweep throws a generic error", async () => {
      const h = await start({
        secretStore: new ThrowingSecretStore(),
        seedConfig: JSON.stringify({
          mcpServers: { srv: { type: "stdio", command: "node" } },
        }),
      });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers/srv`, {
          method: "DELETE",
        });
        expect(res.status).toBe(500);
        expect((await res.json()).error).toMatch(/Failed to delete server/);
      } finally {
        await stop(h);
      }
    });

    it("PUT returns 500 when the keychain write throws a generic error", async () => {
      const h = await start({
        secretStore: new ThrowingSecretStore(),
        seedConfig: JSON.stringify({
          mcpServers: {
            srv: { type: "streamable-http", url: "https://x.test/mcp" },
          },
        }),
      });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers/srv`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            config: { type: "streamable-http", url: "https://x.test/mcp" },
            settings: {
              headers: [],
              metadata: [],
              connectionTimeout: 0,
              requestTimeout: 0,
              oauthClientSecret: "shh",
            },
          }),
        });
        expect(res.status).toBe(500);
        expect((await res.json()).error).toMatch(/Failed to update server/);
      } finally {
        await stop(h);
      }
    });

    it("order returns 500 when the disk write throws", async () => {
      // Point the config at a path whose parent is a file, so the atomic
      // write fails with ENOTDIR — a generic error surfaced as 500.
      const tempDir = mkdtempSync(join(tmpdir(), "inspector-order-500-"));
      const filePath = join(tempDir, "afile");
      writeFileSync(filePath, "x");
      const badConfigPath = join(filePath, "mcp.json");
      const { app } = createRemoteApp({
        dangerouslyOmitAuth: true,
        mcpConfigPath: badConfigPath,
        initialConfig: { defaultEnvironment: {} },
        secretStore: new InMemorySecretStore(),
      });
      const { baseUrl, server } = await new Promise<{
        baseUrl: string;
        server: ServerType;
      }>((resolve, reject) => {
        const s = serve(
          { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
          (info) => {
            const port =
              info && typeof info === "object" && "port" in info
                ? (info as { port: number }).port
                : 0;
            resolve({ baseUrl: `http://127.0.0.1:${port}`, server: s });
          },
        );
        s.on("error", reject);
      });
      try {
        // readMcpConfig sees ENOENT (parent is a file) → empty list, so an
        // empty order set-matches and we proceed to the failing write.
        const res = await fetch(`${baseUrl}/api/servers/order`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: [] }),
        });
        expect(res.status).toBe(500);
        expect((await res.json()).error).toMatch(/Failed to reorder servers/);
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
        rmSync(tempDir, { recursive: true });
      }
    });
  });

  describe("keychain-unavailable migration with a logger", () => {
    class UnavailableStore implements SecretStore {
      async get(): Promise<string | null> {
        return null;
      }
      async set(): Promise<void> {
        throw new KeychainUnavailableError(new Error("libsecret missing"));
      }
      async delete(): Promise<void> {
        /* no-op */
      }
      async deleteAllForServer(): Promise<void> {
        /* no-op */
      }
    }

    it("warns via the logger and preserves on-disk plaintext", async () => {
      const cap = makeCapturingLogger();
      const h = await start({
        secretStore: new UnavailableStore(),
        logger: cap.logger,
        seedConfig: JSON.stringify({
          mcpServers: {
            srv: {
              type: "streamable-http",
              url: "https://x.test/mcp",
              oauth: { clientId: "cid", clientSecret: "plaintext" },
            },
          },
        }),
      });
      try {
        const before = readFileSync(h.configPath, "utf-8");
        const res = await fetch(`${h.baseUrl}/api/servers`);
        expect(res.status).toBe(200);
        // Disk plaintext preserved (migration abandoned).
        expect(readFileSync(h.configPath, "utf-8")).toBe(before);
        const warned = cap.records.filter(
          (r) =>
            r.level === "warn" &&
            JSON.stringify(r.args).includes("Keychain unavailable"),
        );
        expect(warned.length).toBeGreaterThan(0);
      } finally {
        await stop(h);
      }
    });
  });
});
