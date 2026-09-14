import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { InMemorySecretStore } from "@inspector/core/auth/node/secret-store.js";
import {
  buildRunnerClientAuthOptions,
  isOAuthCapableServerConfig,
  loadRunnerClientConfig,
} from "@inspector/core/client/runner.js";
import type { ClientConfig } from "@inspector/core/client/types.js";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";

describe("runner client auth options", () => {
  it("isOAuthCapableServerConfig accepts sse and streamable-http only", () => {
    expect(isOAuthCapableServerConfig({ type: "sse" })).toBe(true);
    expect(isOAuthCapableServerConfig({ type: "streamable-http" })).toBe(true);
    expect(isOAuthCapableServerConfig({ type: "stdio" })).toBe(false);
    expect(isOAuthCapableServerConfig(null)).toBe(false);
  });

  it("buildRunnerClientAuthOptions wires EMA IdP from client.json", () => {
    const clientConfig: ClientConfig = {
      enterpriseManagedAuth: {
        enabled: true,
        idp: {
          issuer: "https://idp.example.com",
          clientId: "cid",
          clientSecret: "secret",
        },
      },
    };
    const opts = buildRunnerClientAuthOptions(clientConfig);
    expect(opts.enterpriseManagedAuth?.idp.issuer).toBe(
      "https://idp.example.com",
    );
    expect(opts.installEnterpriseManagedAuth).toEqual(
      clientConfig.enterpriseManagedAuth,
    );
  });

  it("buildRunnerClientAuthOptions prefers CLI CIMD over client.json", () => {
    const clientConfig: ClientConfig = {
      cimd: {
        enabled: true,
        clientMetadataUrl: "https://example.com/from-config.json",
      },
    };
    const opts = buildRunnerClientAuthOptions(clientConfig, undefined, {
      clientMetadataUrl: "https://example.com/from-cli.json",
    });
    expect(opts.oauth?.clientMetadataUrl).toBe(
      "https://example.com/from-cli.json",
    );
  });

  it("buildRunnerClientAuthOptions uses client.json CIMD when CLI flag absent", () => {
    const clientConfig: ClientConfig = {
      cimd: {
        enabled: true,
        clientMetadataUrl: "https://example.com/from-config.json",
      },
    };
    const opts = buildRunnerClientAuthOptions(clientConfig);
    expect(opts.oauth?.clientMetadataUrl).toBe(
      "https://example.com/from-config.json",
    );
  });

  it("buildRunnerClientAuthOptions includes enterpriseManaged from server settings", () => {
    const settings: InspectorServerSettings = {
      enterpriseManaged: true,
      oauthClientId: "resource-client",
      requestTimeout: 0,
      connectionTimeout: 0,
      taskTtl: 60000,
      maxFetchRequests: 10,
      autoRefreshOnListChanged: false,
      metadata: {},
      headers: [],
      env: [],
      roots: [],
    };
    const opts = buildRunnerClientAuthOptions({}, settings);
    expect(opts.oauth?.enterpriseManaged).toBe(true);
    expect(opts.oauth?.clientId).toBe("resource-client");
  });

  // #2068 — the refresh-token opt-out is a per-server setting, so the CLI/TUI
  // leg honors it exactly as the web leg does.
  it("buildRunnerClientAuthOptions forwards the refresh-token opt-out", () => {
    const base: InspectorServerSettings = {
      requestTimeout: 0,
      connectionTimeout: 0,
      taskTtl: 60000,
      maxFetchRequests: 10,
      metadata: {},
      headers: [],
      env: [],
      roots: [],
    };
    expect(
      buildRunnerClientAuthOptions(
        {},
        {
          ...base,
          oauthRequestRefreshToken: false,
        },
      ).oauth?.requestRefreshToken,
    ).toBe(false);
    // On (the default) forwards nothing, so the provider keeps its own default.
    expect(
      buildRunnerClientAuthOptions({}, base).oauth?.requestRefreshToken,
    ).toBeUndefined();
  });

  // #2018 — the CLI/TUI leg picks the authorization parameters up from the same
  // per-server settings the web leg reads, so all three clients agree.
  it("buildRunnerClientAuthOptions forwards custom authorization params", () => {
    const settings: InspectorServerSettings = {
      oauthAuthorizationParams: [
        { key: "kc_idp_hint", value: "corp" },
        { key: "", value: "dropped" },
      ],
      requestTimeout: 0,
      connectionTimeout: 0,
      taskTtl: 60000,
      maxFetchRequests: 10,
      autoRefreshOnListChanged: false,
      metadata: {},
      headers: [],
      env: [],
      roots: [],
    };
    const opts = buildRunnerClientAuthOptions({}, settings);
    expect(opts.oauth?.authorizationParams).toEqual({ kc_idp_hint: "corp" });
  });

  it("buildRunnerClientAuthOptions ignores all-blank authorization param rows", () => {
    const settings: InspectorServerSettings = {
      oauthAuthorizationParams: [{ key: "  ", value: "x" }],
      requestTimeout: 0,
      connectionTimeout: 0,
      taskTtl: 60000,
      maxFetchRequests: 10,
      autoRefreshOnListChanged: false,
      metadata: {},
      headers: [],
      env: [],
      roots: [],
    };
    expect(buildRunnerClientAuthOptions({}, settings)).toEqual({});
  });

  // #1906 — the CLI/TUI leg reads the endpoint overrides from the same
  // per-server settings the web leg does.
  it("buildRunnerClientAuthOptions forwards the endpoint overrides", () => {
    const settings: InspectorServerSettings = {
      oauthAuthorizationUrl: "https://staging.example.com/authorize",
      oauthTokenUrl: "https://staging.example.com/token",
      requestTimeout: 0,
      connectionTimeout: 0,
      taskTtl: 60000,
      maxFetchRequests: 10,
      autoRefreshOnListChanged: false,
      metadata: {},
      headers: [],
      env: [],
      roots: [],
    };
    const opts = buildRunnerClientAuthOptions({}, settings);
    expect(opts.oauth?.authorizationUrl).toBe(
      "https://staging.example.com/authorize",
    );
    expect(opts.oauth?.tokenUrl).toBe("https://staging.example.com/token");
  });

  it("buildRunnerClientAuthOptions ignores blank endpoint overrides", () => {
    const settings: InspectorServerSettings = {
      oauthAuthorizationUrl: "   ",
      oauthTokenUrl: "",
      requestTimeout: 0,
      connectionTimeout: 0,
      taskTtl: 60000,
      maxFetchRequests: 10,
      autoRefreshOnListChanged: false,
      metadata: {},
      headers: [],
      env: [],
      roots: [],
    };
    expect(buildRunnerClientAuthOptions({}, settings)).toEqual({});
  });

  it("buildRunnerClientAuthOptions returns no oauth when nothing supplies it", () => {
    expect(buildRunnerClientAuthOptions({})).toEqual({});
  });

  it("buildRunnerClientAuthOptions wires CLI client id/secret and marks directAuthRecovery", () => {
    const opts = buildRunnerClientAuthOptions({}, undefined, {
      clientId: "cli-id",
      clientSecret: "cli-secret",
    });
    expect(opts.oauth?.clientId).toBe("cli-id");
    expect(opts.oauth?.clientSecret).toBe("cli-secret");
    expect(opts.directAuthRecovery).toBe(true);
  });

  it("buildRunnerClientAuthOptions carries oauth scopes and client secret from server settings", () => {
    const settings: InspectorServerSettings = {
      oauthClientSecret: "resource-secret",
      oauthScopes: "read write",
      requestTimeout: 0,
      connectionTimeout: 0,
      taskTtl: 60000,
      maxFetchRequests: 10,
      autoRefreshOnListChanged: false,
      metadata: {},
      headers: [],
      env: [],
      roots: [],
    };
    const opts = buildRunnerClientAuthOptions({}, settings);
    expect(opts.oauth?.clientSecret).toBe("resource-secret");
    expect(opts.oauth?.scope).toBe("read write");
  });
});

describe("loadRunnerClientConfig", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
    vi.unstubAllEnvs();
  });

  it("reads client.json from an explicit path (empty when absent)", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "runner-client-"));
    const filePath = path.join(tmpDir, "client.json");
    // No injected store here → exercises the default `new KeyringSecretStore()`
    // path (its get() tolerates keychain unavailability, returning {}).
    expect(
      await loadRunnerClientConfig({ clientConfigPath: filePath }),
    ).toEqual({});
  });

  it("falls back to MCP_CLIENT_CONFIG_PATH and parses a stored config", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "runner-client-"));
    const filePath = path.join(tmpDir, "client.json");
    await fs.writeFile(
      filePath,
      JSON.stringify({
        cimd: {
          enabled: true,
          clientMetadataUrl: "https://example.com/oauth/client.json",
        },
      }),
      "utf-8",
    );
    vi.stubEnv("MCP_CLIENT_CONFIG_PATH", filePath);
    // Inject an in-memory store so the result never depends on the developer's
    // real OS keychain.
    const config = await loadRunnerClientConfig({
      secretStore: new InMemorySecretStore(),
    });
    expect(config.cimd?.clientMetadataUrl).toBe(
      "https://example.com/oauth/client.json",
    );
  });
});
