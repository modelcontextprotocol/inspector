/**
 * Overlapping OAuth flows for the same server through the shared remote store
 * (#2726).
 *
 * Each "tab" is what the web client builds per page: its own
 * `RemoteOAuthStorage` view over one backend `oauth.json`, and its own
 * sessionStorage-like area for in-flight PKCE verifiers. Tab A starts a flow,
 * tab B starts and finishes one for the same server, then tab A's callback page
 * (a fresh page, so a fresh client and remote view, but the same tab storage)
 * finishes. The test AS verifies PKCE S256, so A succeeds only if its exchange
 * sends A's own verifier.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createRemoteTransport } from "@inspector/core/mcp/remote/createRemoteTransport.js";
import { createRemoteFetch } from "@inspector/core/mcp/remote/createRemoteFetch.js";
import { RemoteOAuthStorage } from "@inspector/core/auth/remote/storage-remote.js";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server.js";
import {
  createWebStoragePkceFlowStore,
  type PkceFlowStore,
} from "@inspector/core/auth/pkce-flow-store.js";
import { ConsoleNavigation } from "@inspector/core/auth/providers.js";
import {
  TestServerHttp,
  waitForOAuthWellKnown,
  getDefaultServerConfig,
  createOAuthTestServerConfig,
  clearOAuthTestData,
} from "@modelcontextprotocol/inspector-test-server";
import {
  completeOAuthAuthorization,
  createStaticRedirectUrlProvider,
} from "../helpers/oauth-client-fixtures.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";

const REDIRECT_URL = "http://localhost:3001/oauth/callback";
const CLIENT_ID = "concurrent-flows-client";
const CLIENT_SECRET = "concurrent-flows-secret";

/** One tab's sessionStorage stand-in. */
function createTabFlowStore(): PkceFlowStore {
  const items = new Map<string, string>();
  return createWebStoragePkceFlowStore(() => ({
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  }));
}

describe("InspectorClient overlapping OAuth flows to one server (#2726)", () => {
  let mcpServer: TestServerHttp | undefined;
  let remoteServer: ServerType | undefined;
  let tempDir: string | undefined;
  const clients: InspectorClient[] = [];

  beforeEach(() => {
    clearOAuthTestData();
    tempDir = mkdtempSync(join(tmpdir(), "inspector-concurrent-oauth-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      await client.disconnect();
    }
    await mcpServer?.stop();
    mcpServer = undefined;
    if (remoteServer) {
      const server = remoteServer;
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      remoteServer = undefined;
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
    vi.restoreAllMocks();
  });

  async function startBackend(): Promise<{
    baseUrl: string;
    authToken: string;
  }> {
    const { app, authToken } = createRemoteApp({
      storageDir: tempDir,
      initialConfig: { defaultEnvironment: {} },
    });
    return new Promise((resolve, reject) => {
      const server = serve(
        { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
        (info) => {
          resolve({ baseUrl: `http://127.0.0.1:${info.port}`, authToken });
        },
      );
      remoteServer = server;
      server.on("error", reject);
    });
  }

  async function startMcpServer(): Promise<string> {
    mcpServer = new TestServerHttp({
      ...getDefaultServerConfig(),
      serverType: "streamable-http",
      ...createOAuthTestServerConfig({
        requireAuth: true,
        staticClients: [
          {
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
            redirectUris: [REDIRECT_URL],
          },
        ],
      }),
    });
    const port = await mcpServer.start();
    const serverUrl = `http://localhost:${port}`;
    await waitForOAuthWellKnown(serverUrl);
    return serverUrl;
  }

  /** A client as one page load of one tab builds it. */
  function createPageClient(
    backend: { baseUrl: string; authToken: string },
    serverUrl: string,
    flowStore: PkceFlowStore | undefined,
  ): InspectorClient {
    const client = new InspectorClient(
      { type: "streamable-http", url: `${serverUrl}/mcp` } as MCPServerConfig,
      {
        environment: {
          transport: createRemoteTransport(backend),
          fetch: createRemoteFetch(backend),
          oauth: {
            storage: new RemoteOAuthStorage(backend),
            navigation: new ConsoleNavigation(),
            redirectUrlProvider: createStaticRedirectUrlProvider(REDIRECT_URL),
            flowStore,
          },
        },
        oauth: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
      },
    );
    clients.push(client);
    return client;
  }

  /** Tab A starts, tab B starts and finishes, then tab A finishes. */
  async function runOverlappingFlows(withFlowStore: boolean): Promise<{
    finishA: () => Promise<InspectorClient>;
    clientB: InspectorClient;
  }> {
    const backend = await startBackend();
    const serverUrl = await startMcpServer();
    const tabA = withFlowStore ? createTabFlowStore() : undefined;
    const tabB = withFlowStore ? createTabFlowStore() : undefined;

    const urlA = await createPageClient(
      backend,
      serverUrl,
      tabA,
    ).authenticate();
    const urlB = await createPageClient(
      backend,
      serverUrl,
      tabB,
    ).authenticate();
    if (!urlA || !urlB) throw new Error("Expected two authorization URLs");

    const approvedA = await completeOAuthAuthorization(urlA);
    const approvedB = await completeOAuthAuthorization(urlB);

    const clientB = createPageClient(backend, serverUrl, tabB);
    await clientB.completeOAuthFlow(
      approvedB.code,
      approvedB.iss,
      urlB.searchParams.get("state") ?? undefined,
    );
    await clientB.connect();

    const finishA = async () => {
      const clientA = createPageClient(backend, serverUrl, tabA);
      await clientA.completeOAuthFlow(
        approvedA.code,
        approvedA.iss,
        urlA.searchParams.get("state") ?? undefined,
      );
      await clientA.connect();
      return clientA;
    };
    return { finishA, clientB };
  }

  it("completes both flows, each with its own verifier", async () => {
    const { finishA, clientB } = await runOverlappingFlows(true);
    const clientA = await finishA();

    expect(clientB.getStatus()).toBe("connected");
    expect(clientA.getStatus()).toBe("connected");
  });

  it("without a flow store, the earlier flow fails PKCE (the #2726 defect)", async () => {
    const { finishA, clientB } = await runOverlappingFlows(false);

    expect(clientB.getStatus()).toBe("connected");
    // A's exchange sends B's verifier and fails PKCE. The test AS consumes a
    // code on first read, so the SDK's retry after that rejection reports the
    // code as expired instead; either message is the same defect.
    await expect(finishA()).rejects.toThrow(
      /Invalid code_verifier|Invalid or expired authorization code/,
    );
  });

  it("a callback whose state has no stored verifier fails clearly", async () => {
    const backend = await startBackend();
    const serverUrl = await startMcpServer();
    const tab = createTabFlowStore();

    const url = await createPageClient(backend, serverUrl, tab).authenticate();
    if (!url) throw new Error("Expected an authorization URL");
    const approved = await completeOAuthAuthorization(url);

    // The callback lands in a different tab, which never saw this flow.
    const client = createPageClient(backend, serverUrl, createTabFlowStore());
    await expect(
      client.completeOAuthFlow(
        approved.code,
        approved.iss,
        url.searchParams.get("state") ?? undefined,
      ),
    ).rejects.toThrow(/No code verifier saved for this authorization flow/);
  });
});
