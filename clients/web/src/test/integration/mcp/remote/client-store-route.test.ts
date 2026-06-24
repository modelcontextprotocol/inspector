/**
 * Integration tests for /api/storage/client IdP secret keychain handling.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server.js";
import { CLIENT_KEYCHAIN_ID } from "@inspector/core/client/secrets.js";
import {
  InMemorySecretStore,
  SECRET_FIELD_IDP_CLIENT_SECRET,
} from "@inspector/core/auth/node/secret-store.js";
import { getStoreFilePath } from "@inspector/core/storage/store-io.js";

interface Harness {
  baseUrl: string;
  server: ServerType;
  storageDir: string;
  clientPath: string;
  tempDir: string;
  secretStore: InMemorySecretStore;
}

async function startHarness(): Promise<Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inspector-client-store-"));
  const storageDir = join(tempDir, "storage");
  mkdirSync(storageDir, { recursive: true });
  const secretStore = new InMemorySecretStore();
  const { app } = createRemoteApp({
    dangerouslyOmitAuth: true,
    storageDir,
    initialConfig: { defaultEnvironment: {} },
    secretStore,
  });
  const { baseUrl, server } = await new Promise<{
    baseUrl: string;
    server: ServerType;
  }>((resolve, reject) => {
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
  return {
    baseUrl,
    server,
    storageDir,
    clientPath: getStoreFilePath(storageDir, "client"),
    tempDir,
    secretStore,
  };
}

async function teardown(h: Harness): Promise<void> {
  await new Promise<void>((resolve) => h.server.close(() => resolve()));
  try {
    rmSync(h.tempDir, { recursive: true });
  } catch {
    /* ignore */
  }
}

const sampleClientConfig = {
  enterpriseManagedAuth: {
    idp: {
      issuer: "https://idp.example.com",
      clientId: "inspector-app",
      clientSecret: "very-secret-idp",
    },
  },
};

describe("/api/storage/client keychain", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await startHarness();
  });

  afterEach(async () => {
    await teardown(h);
  });

  it("POST writes IdP clientSecret to keychain, not client.json", async () => {
    const res = await fetch(`${h.baseUrl}/api/storage/client`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sampleClientConfig),
    });
    expect(res.status).toBe(200);

    const onDisk = JSON.parse(readFileSync(h.clientPath, "utf-8")) as {
      enterpriseManagedAuth?: { idp?: Record<string, string> };
    };
    expect(onDisk.enterpriseManagedAuth?.idp).toEqual({
      issuer: "https://idp.example.com",
      clientId: "inspector-app",
    });
    expect(onDisk.enterpriseManagedAuth?.idp?.clientSecret).toBeUndefined();

    const raw = readFileSync(h.clientPath, "utf-8");
    expect(raw).not.toContain("very-secret-idp");

    expect(
      await h.secretStore.get(
        CLIENT_KEYCHAIN_ID,
        SECRET_FIELD_IDP_CLIENT_SECRET,
      ),
    ).toBe("very-secret-idp");
  });

  it("GET rehydrates IdP clientSecret from keychain", async () => {
    await fetch(`${h.baseUrl}/api/storage/client`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sampleClientConfig),
    });

    const res = await fetch(`${h.baseUrl}/api/storage/client`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as typeof sampleClientConfig;
    expect(json.enterpriseManagedAuth?.idp.clientSecret).toBe(
      "very-secret-idp",
    );
  });

  it("GET migrates legacy plaintext clientSecret into keychain", async () => {
    writeFileSync(
      h.clientPath,
      JSON.stringify(sampleClientConfig, null, 2),
      "utf-8",
    );

    const res = await fetch(`${h.baseUrl}/api/storage/client`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as typeof sampleClientConfig;
    expect(json.enterpriseManagedAuth?.idp.clientSecret).toBe(
      "very-secret-idp",
    );

    const onDisk = JSON.parse(readFileSync(h.clientPath, "utf-8")) as {
      enterpriseManagedAuth?: { idp?: Record<string, string> };
    };
    expect(onDisk.enterpriseManagedAuth?.idp?.clientSecret).toBeUndefined();
    expect(
      await h.secretStore.get(
        CLIENT_KEYCHAIN_ID,
        SECRET_FIELD_IDP_CLIENT_SECRET,
      ),
    ).toBe("very-secret-idp");
  });

  it("DELETE removes client.json and keychain IdP secret", async () => {
    await fetch(`${h.baseUrl}/api/storage/client`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sampleClientConfig),
    });

    const deleteRes = await fetch(`${h.baseUrl}/api/storage/client`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);

    const readRes = await fetch(`${h.baseUrl}/api/storage/client`);
    expect(readRes.status).toBe(200);
    expect(await readRes.json()).toEqual({});

    expect(
      await h.secretStore.get(
        CLIENT_KEYCHAIN_ID,
        SECRET_FIELD_IDP_CLIENT_SECRET,
      ),
    ).toBeNull();
  });
});
