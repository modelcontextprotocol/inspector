/**
 * Integration tests for /api/servers + /api/servers/:id routes.
 * Spins up createRemoteApp against a per-test tmp mcpConfigPath and
 * exercises the routes via real HTTP.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server.js";
import { DEFAULT_SEED_CONFIG } from "@inspector/core/mcp/serverList.js";
import type { MCPConfig } from "@inspector/core/mcp/types.js";

interface Harness {
  baseUrl: string;
  server: ServerType;
  configPath: string;
  tempDir: string;
}

async function startServer(configPath: string): Promise<{
  baseUrl: string;
  server: ServerType;
}> {
  const { app } = createRemoteApp({
    dangerouslyOmitAuth: true,
    mcpConfigPath: configPath,
    initialConfig: { defaultEnvironment: {} },
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

async function setup(): Promise<Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inspector-servers-route-"));
  const configPath = join(tempDir, "mcp.json");
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

function readConfig(path: string): MCPConfig {
  return JSON.parse(readFileSync(path, "utf-8")) as MCPConfig;
}

describe("/api/servers routes", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await setup();
  });

  afterEach(async () => {
    await teardown(h);
  });

  describe("GET /api/servers", () => {
    it("writes the seed config and returns it on first read (file absent)", async () => {
      expect(existsSync(h.configPath)).toBe(false);

      const res = await fetch(`${h.baseUrl}/api/servers`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as MCPConfig;
      expect(body).toEqual(DEFAULT_SEED_CONFIG);

      // File was created with the same content
      expect(existsSync(h.configPath)).toBe(true);
      expect(readConfig(h.configPath)).toEqual(DEFAULT_SEED_CONFIG);
    });

    it("returns the existing file content when present (no overwrite)", async () => {
      const custom: MCPConfig = {
        mcpServers: {
          custom: { type: "stdio", command: "node", args: ["x.js"] },
        },
      };
      writeFileSync(h.configPath, JSON.stringify(custom, null, 2));

      const res = await fetch(`${h.baseUrl}/api/servers`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(custom);

      // Untouched on disk
      expect(readConfig(h.configPath)).toEqual(custom);
    });

    it("normalizes legacy 'http' and missing type on read", async () => {
      writeFileSync(
        h.configPath,
        JSON.stringify({
          mcpServers: {
            legacy: { command: "node" },
            httpish: { type: "http", url: "https://x.test" },
          },
        }),
      );

      const res = await fetch(`${h.baseUrl}/api/servers`);
      const body = (await res.json()) as MCPConfig;
      expect(body.mcpServers.legacy?.type).toBe("stdio");
      expect(body.mcpServers.httpish?.type).toBe("streamable-http");
    });

    it("treats a valid-JSON file without `mcpServers` as empty", async () => {
      writeFileSync(h.configPath, JSON.stringify({ unrelated: 1 }));

      const res = await fetch(`${h.baseUrl}/api/servers`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ mcpServers: {} });
    });

    it("surfaces a 500 (not silent empty) on invalid-JSON contents", async () => {
      // Surfacing corruption rather than silently presenting "no servers" —
      // the next POST/PUT/DELETE would otherwise read empty and clobber the
      // user's broken-but-recoverable file.
      writeFileSync(h.configPath, "not json {");

      const res = await fetch(`${h.baseUrl}/api/servers`);
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/Failed to read server list/i);
    });
  });

  describe("POST /api/servers", () => {
    it("adds a new server and persists to disk", async () => {
      const res = await fetch(`${h.baseUrl}/api/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "alpha",
          config: { type: "stdio", command: "node" },
        }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      expect(readConfig(h.configPath).mcpServers.alpha).toEqual({
        type: "stdio",
        command: "node",
      });
    });

    it("returns 409 when the id already exists", async () => {
      writeFileSync(
        h.configPath,
        JSON.stringify({
          mcpServers: { alpha: { type: "stdio", command: "node" } },
        }),
      );
      const res = await fetch(`${h.baseUrl}/api/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "alpha",
          config: { type: "stdio", command: "other" },
        }),
      });
      expect(res.status).toBe(409);
    });

    it("rejects an id with path-traversal characters", async () => {
      const res = await fetch(`${h.baseUrl}/api/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "../escape",
          config: { type: "stdio", command: "node" },
        }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects a missing or non-object config", async () => {
      const res = await fetch(`${h.baseUrl}/api/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "alpha" }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects malformed JSON body", async () => {
      const res = await fetch(`${h.baseUrl}/api/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });

    it("returns 500 when the existing file is invalid JSON (matches GET semantics)", async () => {
      writeFileSync(h.configPath, "not json {");
      const res = await fetch(`${h.baseUrl}/api/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "alpha",
          config: { type: "stdio", command: "node" },
        }),
      });
      expect(res.status).toBe(500);
    });

    it("normalizes the incoming config (http → streamable-http)", async () => {
      const res = await fetch(`${h.baseUrl}/api/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "httpish",
          config: { type: "http", url: "https://x.test" },
        }),
      });
      expect(res.status).toBe(200);
      expect(readConfig(h.configPath).mcpServers.httpish?.type).toBe(
        "streamable-http",
      );
    });
  });

  describe("PUT /api/servers/:id", () => {
    beforeEach(() => {
      writeFileSync(
        h.configPath,
        JSON.stringify({
          mcpServers: {
            alpha: { type: "stdio", command: "old" },
            beta: { type: "stdio", command: "beta-cmd" },
          },
        }),
      );
    });

    it("updates config in place without renaming", async () => {
      const res = await fetch(`${h.baseUrl}/api/servers/alpha`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { type: "stdio", command: "new" },
        }),
      });
      expect(res.status).toBe(200);

      const cfg = readConfig(h.configPath);
      expect(cfg.mcpServers.alpha).toEqual({ type: "stdio", command: "new" });
      // Key order preserved
      expect(Object.keys(cfg.mcpServers)).toEqual(["alpha", "beta"]);
    });

    it("renames the key when id is supplied and different", async () => {
      const res = await fetch(`${h.baseUrl}/api/servers/alpha`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "alpha-renamed",
          config: { type: "stdio", command: "new" },
        }),
      });
      expect(res.status).toBe(200);

      const cfg = readConfig(h.configPath);
      expect(cfg.mcpServers).not.toHaveProperty("alpha");
      expect(cfg.mcpServers["alpha-renamed"]).toEqual({
        type: "stdio",
        command: "new",
      });
      // New key replaces the original in its slot, beta stays after
      expect(Object.keys(cfg.mcpServers)).toEqual(["alpha-renamed", "beta"]);
    });

    it("returns 404 when the original id does not exist", async () => {
      const res = await fetch(`${h.baseUrl}/api/servers/nonexistent`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { type: "stdio", command: "x" },
        }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 409 when renaming to a key that already exists", async () => {
      const res = await fetch(`${h.baseUrl}/api/servers/alpha`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "beta",
          config: { type: "stdio", command: "x" },
        }),
      });
      expect(res.status).toBe(409);
    });

    it("rejects invalid original id", async () => {
      // dots fail validateStoreId; using `..` directly would be collapsed by
      // URL normalization before Hono routes the request.
      const res = await fetch(`${h.baseUrl}/api/servers/bad.id`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { type: "stdio", command: "x" },
        }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects an invalid new id", async () => {
      const res = await fetch(`${h.baseUrl}/api/servers/alpha`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "../escape",
          config: { type: "stdio", command: "x" },
        }),
      });
      expect(res.status).toBe(400);
    });

    it("accepts a body with neither config nor settings (no-op patch)", async () => {
      // Both fields are now optional patches. An empty body is a degenerate
      // but valid request — it preserves both config and settings on disk.
      const res = await fetch(`${h.baseUrl}/api/servers/alpha`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "alpha" }),
      });
      expect(res.status).toBe(200);
      expect(readConfig(h.configPath).mcpServers.alpha).toEqual({
        type: "stdio",
        command: "old",
      });
    });

    it("rejects malformed JSON body", async () => {
      const res = await fetch(`${h.baseUrl}/api/servers/alpha`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("settings round-trip", () => {
    it("persists Inspector-extension fields at the top level on POST (post-#1358 flat shape)", async () => {
      const res = await fetch(`${h.baseUrl}/api/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "gamma",
          config: { type: "streamable-http", url: "https://x.test/mcp" },
          // Wire envelope unchanged from #1353: pair-array headers, flat
          // oauth* fields. Backend splats these into the flat disk shape:
          // object headers, nested oauth, plus the inspector-only fields
          // at the top level.
          settings: {
            headers: [{ key: "Authorization", value: "Bearer xyz" }],
            metadata: [{ key: "tenant", value: "acme" }],
            connectionTimeout: 30000,
            requestTimeout: 60000,
            oauthClientId: "client-abc",
            oauthScopes: "read:tools",
          },
        }),
      });
      expect(res.status).toBe(200);
      const stored = readConfig(h.configPath).mcpServers
        .gamma as unknown as Record<string, unknown>;
      // Disk shape: flat, no `settings` wrapper, object headers, nested oauth.
      expect(stored).not.toHaveProperty("settings");
      expect(stored.headers).toEqual({ Authorization: "Bearer xyz" });
      expect(stored.metadata).toEqual([{ key: "tenant", value: "acme" }]);
      expect(stored.connectionTimeout).toBe(30000);
      expect(stored.requestTimeout).toBe(60000);
      expect(stored.oauth).toEqual({
        clientId: "client-abc",
        scopes: "read:tools",
      });
    });

    it("updates Inspector-extension fields at the top level on PUT", async () => {
      writeFileSync(
        h.configPath,
        JSON.stringify({
          mcpServers: {
            delta: { type: "streamable-http", url: "https://x.test/mcp" },
          },
        }),
      );
      const res = await fetch(`${h.baseUrl}/api/servers/delta`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { type: "streamable-http", url: "https://x.test/mcp" },
          settings: {
            headers: [{ key: "X-Tenant", value: "acme" }],
            metadata: [],
            connectionTimeout: 0,
            requestTimeout: 45000,
          },
        }),
      });
      expect(res.status).toBe(200);
      const stored = readConfig(h.configPath).mcpServers
        .delta as unknown as Record<string, unknown>;
      expect(stored).not.toHaveProperty("settings");
      expect(stored.headers).toEqual({ "X-Tenant": "acme" });
      expect(stored.requestTimeout).toBe(45000);
      // Zero/empty values are suppressed on disk to keep the diff minimal.
      expect(stored).not.toHaveProperty("metadata");
      expect(stored).not.toHaveProperty("connectionTimeout");
    });

    it("rejects a non-object settings field", async () => {
      const res = await fetch(`${h.baseUrl}/api/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "bad-settings",
          config: { type: "stdio", command: "node" },
          settings: "not-an-object",
        }),
      });
      expect(res.status).toBe(400);
    });

    it("preserves Inspector-extension fields when PUT omits settings (no clobber on config-only save)", async () => {
      writeFileSync(
        h.configPath,
        JSON.stringify({
          mcpServers: {
            epsilon: {
              type: "streamable-http",
              url: "https://x.test/mcp",
              // Post-#1358 flat shape on disk.
              headers: { "X-Keep": "yes" },
            },
          },
        }),
      );
      // PUT without a settings field: the existing top-level headers must
      // survive. A caller updating only the transport config (e.g. the
      // server config modal) must not silently wipe persisted headers.
      const res = await fetch(`${h.baseUrl}/api/servers/epsilon`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { type: "streamable-http", url: "https://x.test/other" },
        }),
      });
      expect(res.status).toBe(200);
      const stored = readConfig(h.configPath).mcpServers
        .epsilon as unknown as Record<string, unknown>;
      expect(stored.headers).toEqual({ "X-Keep": "yes" });
      // URL update must have applied.
      expect(stored.url).toBe("https://x.test/other");
    });

    it("clears Inspector-extension fields when PUT sends settings: null (explicit intent)", async () => {
      writeFileSync(
        h.configPath,
        JSON.stringify({
          mcpServers: {
            zeta: {
              type: "streamable-http",
              url: "https://x.test/mcp",
              headers: { "X-Tenant": "acme" },
              metadata: [{ key: "trace", value: "abc" }],
              connectionTimeout: 5000,
            },
          },
        }),
      );
      const res = await fetch(`${h.baseUrl}/api/servers/zeta`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { type: "streamable-http", url: "https://x.test/mcp" },
          settings: null,
        }),
      });
      expect(res.status).toBe(200);
      const stored = readConfig(h.configPath).mcpServers
        .zeta as unknown as Record<string, unknown>;
      // All Inspector-extension fields gone.
      expect(stored).not.toHaveProperty("headers");
      expect(stored).not.toHaveProperty("metadata");
      expect(stored).not.toHaveProperty("connectionTimeout");
      expect(stored).not.toHaveProperty("requestTimeout");
      expect(stored).not.toHaveProperty("oauth");
    });

    it("rejects a malformed settings shape with 400", async () => {
      writeFileSync(
        h.configPath,
        JSON.stringify({
          mcpServers: {
            eta: { type: "stdio", command: "node" },
          },
        }),
      );
      const res = await fetch(`${h.baseUrl}/api/servers/eta`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { type: "stdio", command: "node" },
          // headers should be an array of {key, value}; "oops" is a string.
          settings: {
            headers: "oops",
            metadata: [],
            connectionTimeout: 0,
            requestTimeout: 0,
          },
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/settings\.headers/);
    });

    it("accepts a settings-only PUT and preserves config from disk", async () => {
      writeFileSync(
        h.configPath,
        JSON.stringify({
          mcpServers: {
            theta: {
              type: "streamable-http",
              url: "https://x.test/mcp",
            },
          },
        }),
      );
      const res = await fetch(`${h.baseUrl}/api/servers/theta`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // No config — server should preserve the existing one inside its
          // write lock and apply only the settings patch.
          settings: {
            headers: [{ key: "X-Tenant", value: "acme" }],
            metadata: [],
            connectionTimeout: 0,
            requestTimeout: 0,
          },
        }),
      });
      expect(res.status).toBe(200);
      const stored = readConfig(h.configPath).mcpServers
        .theta as unknown as Record<string, unknown>;
      expect(stored.type).toBe("streamable-http");
      expect(stored.url).toBe("https://x.test/mcp");
      expect(stored.headers).toEqual({ "X-Tenant": "acme" });
    });

    it("rejects a non-object config on PUT with 400", async () => {
      writeFileSync(
        h.configPath,
        JSON.stringify({
          mcpServers: {
            iota: { type: "stdio", command: "node" },
          },
        }),
      );
      const res = await fetch(`${h.baseUrl}/api/servers/iota`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: "not-an-object",
        }),
      });
      expect(res.status).toBe(400);
    });

    it("validateSettings coerces empty-string OAuth fields to absent (cleared inputs don't produce an oauth node on disk)", async () => {
      const res = await fetch(`${h.baseUrl}/api/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "empty-oauth",
          config: { type: "streamable-http", url: "https://x.test/mcp" },
          settings: {
            headers: [],
            metadata: [],
            connectionTimeout: 0,
            requestTimeout: 0,
            oauthClientId: "",
            oauthClientSecret: "",
            oauthScopes: "",
          },
        }),
      });
      expect(res.status).toBe(200);
      const stored = readConfig(h.configPath).mcpServers[
        "empty-oauth"
      ] as unknown as Record<string, unknown>;
      // No `oauth` node on disk — every field was empty.
      expect(stored).not.toHaveProperty("oauth");
    });

    it("validateSettings drops unknown keys (explicit pick-and-build, not spread)", async () => {
      const res = await fetch(`${h.baseUrl}/api/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "unknown-keys",
          config: { type: "stdio", command: "node" },
          settings: {
            headers: [{ key: "X-A", value: "1" }],
            metadata: [],
            connectionTimeout: 0,
            requestTimeout: 0,
            // Unknown stowaway — must not survive the validator.
            stowaway: { keep: "me" },
          },
        }),
      });
      expect(res.status).toBe(200);
      const stored = readConfig(h.configPath).mcpServers[
        "unknown-keys"
      ] as unknown as Record<string, unknown>;
      expect(stored).not.toHaveProperty("stowaway");
      expect(stored).not.toHaveProperty("settings");
      // Only the non-empty/non-zero settings field round-tripped to disk.
      expect(stored.headers).toEqual({ "X-A": "1" });
    });

    it("strips smuggled Inspector-extension keys from config on POST (envelope is the only write path)", async () => {
      // `normalizeServerType` spreads unknown keys verbatim. Without the
      // strip in buildStoredEntry, a body that nests Inspector-extension
      // keys inside `config` would land them on the stored entry without
      // ever passing through `validateSettings`. Pin the strip for both
      // the legacy `settings` key and the new flat keys (`headers`,
      // `metadata`, `connectionTimeout`, `requestTimeout`, `oauth`).
      const res = await fetch(`${h.baseUrl}/api/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "smuggle-post",
          config: {
            type: "stdio",
            command: "node",
            settings: { bogus: true },
            headers: { Smuggled: "yes" },
            oauth: { clientId: "smuggled" },
          },
        }),
      });
      expect(res.status).toBe(200);
      const stored = readConfig(h.configPath).mcpServers[
        "smuggle-post"
      ] as unknown as Record<string, unknown>;
      expect(stored).not.toHaveProperty("settings");
      expect(stored).not.toHaveProperty("headers");
      expect(stored).not.toHaveProperty("oauth");
    });

    it("strips smuggled Inspector-extension keys from config on PUT even when settings:null clears the real fields", async () => {
      writeFileSync(
        h.configPath,
        JSON.stringify({
          mcpServers: {
            smuggle: {
              type: "stdio",
              command: "node",
              headers: { "X-Real": "yes" },
            },
          },
        }),
      );
      // settings: null clears the real Inspector-extension fields; the bogus
      // keys nested under config must not re-attach via the spread inside
      // normalizeServerType.
      const res = await fetch(`${h.baseUrl}/api/servers/smuggle`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            type: "stdio",
            command: "node",
            settings: { bogus: true },
            headers: { Smuggled: "yes" },
            connectionTimeout: 9999,
          },
          settings: null,
        }),
      });
      expect(res.status).toBe(200);
      const stored = readConfig(h.configPath).mcpServers
        .smuggle as unknown as Record<string, unknown>;
      expect(stored).not.toHaveProperty("settings");
      expect(stored).not.toHaveProperty("headers");
      expect(stored).not.toHaveProperty("connectionTimeout");
    });

    it("rejects a settings array (not an object) with 400", async () => {
      const res = await fetch(`${h.baseUrl}/api/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "arrays-not-allowed",
          config: { type: "stdio", command: "node" },
          settings: [],
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/object/);
    });

    it("drops a legacy nested `settings` node on read (hard cutover per #1358 decision 4)", async () => {
      // A user upgrading from the one-#1352 v2/main build has a file with a
      // nested `settings` block. Per the hard-cutover decision the persisted
      // headers / metadata / timeouts / OAuth credentials are intentionally
      // lost on first read — users re-enter them through the form or hand-
      // edit the file into the flat shape. GET surfaces the entry with
      // settings dropped, and a subsequent config-only PUT does not
      // re-attach the legacy node via the preserve branch.
      writeFileSync(
        h.configPath,
        JSON.stringify({
          mcpServers: {
            legacy: {
              type: "streamable-http",
              url: "https://x.test/mcp",
              settings: {
                headers: [{ key: "X-Tenant", value: "acme" }],
                metadata: [],
                connectionTimeout: 30000,
                requestTimeout: 0,
                oauthClientId: "client-abc",
              },
            },
          },
        }),
      );

      // GET surfaces the entry with the legacy settings dropped — no flat
      // fields lifted in either (this is hard cutover, not migration).
      const getRes = await fetch(`${h.baseUrl}/api/servers`);
      expect(getRes.status).toBe(200);
      const getBody = (await getRes.json()) as {
        mcpServers: Record<string, Record<string, unknown>>;
      };
      const fetched = getBody.mcpServers.legacy!;
      expect(fetched).toBeDefined();
      expect(fetched).not.toHaveProperty("settings");
      expect(fetched).not.toHaveProperty("headers");
      expect(fetched).not.toHaveProperty("metadata");
      expect(fetched).not.toHaveProperty("connectionTimeout");
      expect(fetched).not.toHaveProperty("oauth");

      // PUT without settings preserves the (now-cleared) absence; the next
      // save persists the flat shape with no `settings` field.
      const putRes = await fetch(`${h.baseUrl}/api/servers/legacy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { type: "streamable-http", url: "https://x.test/other" },
        }),
      });
      expect(putRes.status).toBe(200);
      const stored = readConfig(h.configPath).mcpServers
        .legacy as unknown as Record<string, unknown>;
      expect(stored).not.toHaveProperty("settings");
      expect(stored).not.toHaveProperty("headers");
    });

    it("loads a hand-edited file with top-level Claude Code-style `headers` (interop with `.mcp.json`)", async () => {
      // A user pastes a server entry copied from the Claude Code docs:
      // top-level `headers: { ... }`, no settings wrapper. GET should
      // surface the entry verbatim (flat disk shape) and a subsequent
      // settings-only PUT must preserve the headers when omitted.
      writeFileSync(
        h.configPath,
        JSON.stringify({
          mcpServers: {
            "api-server": {
              type: "streamable-http",
              url: "https://api.example.com/mcp",
              headers: { Authorization: "Bearer the-token" },
            },
          },
        }),
      );

      const getRes = await fetch(`${h.baseUrl}/api/servers`);
      expect(getRes.status).toBe(200);
      const getBody = (await getRes.json()) as {
        mcpServers: Record<string, Record<string, unknown>>;
      };
      expect(getBody.mcpServers["api-server"]!.headers).toEqual({
        Authorization: "Bearer the-token",
      });

      // Settings-only PUT (no `config`) preserves the existing url AND the
      // existing headers per the preserve-on-omit branch.
      const putRes = await fetch(`${h.baseUrl}/api/servers/api-server`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            headers: [
              { key: "Authorization", value: "Bearer the-token" },
              { key: "X-Tenant", value: "acme" },
            ],
            metadata: [],
            connectionTimeout: 0,
            requestTimeout: 0,
          },
        }),
      });
      expect(putRes.status).toBe(200);
      const stored = readConfig(h.configPath).mcpServers[
        "api-server"
      ] as unknown as Record<string, unknown>;
      expect(stored.url).toBe("https://api.example.com/mcp");
      expect(stored.headers).toEqual({
        Authorization: "Bearer the-token",
        "X-Tenant": "acme",
      });
    });
  });

  describe("concurrent mutations", () => {
    it("does not lose updates when many adds fire in parallel (write-lock)", async () => {
      // Without the in-process mutex, concurrent POSTs would all read the
      // empty baseline and the last writer would clobber everyone else's
      // entry. With the mutex, every entry should land on disk.
      const ids = Array.from({ length: 25 }, (_, i) => `concurrent-${i}`);
      const responses = await Promise.all(
        ids.map((id) =>
          fetch(`${h.baseUrl}/api/servers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id,
              config: { type: "stdio", command: `cmd-${id}` },
            }),
          }),
        ),
      );
      for (const res of responses) {
        expect(res.status).toBe(200);
      }
      const cfg = readConfig(h.configPath);
      expect(Object.keys(cfg.mcpServers).sort()).toEqual([...ids].sort());
    });
  });

  describe("DELETE /api/servers/:id", () => {
    beforeEach(() => {
      writeFileSync(
        h.configPath,
        JSON.stringify({
          mcpServers: {
            alpha: { type: "stdio", command: "node" },
            beta: { type: "stdio", command: "node" },
          },
        }),
      );
    });

    it("removes the entry and persists", async () => {
      const res = await fetch(`${h.baseUrl}/api/servers/alpha`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
      const cfg = readConfig(h.configPath);
      expect(cfg.mcpServers).not.toHaveProperty("alpha");
      expect(cfg.mcpServers).toHaveProperty("beta");
    });

    it("is idempotent when the id is not present", async () => {
      const res = await fetch(`${h.baseUrl}/api/servers/nonexistent`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
      // beta untouched
      expect(readConfig(h.configPath).mcpServers).toHaveProperty("beta");
    });

    it("is a 200 no-op when the file does not exist yet", async () => {
      rmSync(h.configPath);
      const res = await fetch(`${h.baseUrl}/api/servers/anything`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
    });

    it("rejects an invalid id", async () => {
      const res = await fetch(`${h.baseUrl}/api/servers/bad.id`, {
        method: "DELETE",
      });
      expect(res.status).toBe(400);
    });
  });
});
