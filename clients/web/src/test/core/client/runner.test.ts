import { describe, it, expect } from "vitest";
import {
  buildRunnerClientAuthOptions,
  isOAuthCapableServerConfig,
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
      metadata: [],
      headers: [],
      env: [],
      roots: [],
    };
    const opts = buildRunnerClientAuthOptions({}, settings);
    expect(opts.oauth?.enterpriseManaged).toBe(true);
    expect(opts.oauth?.clientId).toBe("resource-client");
  });
});
