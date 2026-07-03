import { describe, it, expect, afterEach } from "vitest";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TestServerHttp,
  waitForOAuthWellKnown,
  getDefaultServerConfig,
  createOAuthTestServerConfig,
  clearOAuthTestData,
} from "@modelcontextprotocol/inspector-test-server";
import { InspectorClient } from "@inspector/core/mcp/index.js";
import { createTransportNode } from "@inspector/core/mcp/node/index.js";
import {
  CallbackNavigation,
  MutableRedirectUrlProvider,
} from "@inspector/core/auth/index.js";
import { NodeOAuthStorage } from "@inspector/core/auth/node/index.js";
import {
  connectInspectorWithOAuth,
  withCliAuthRecoveryRetry,
} from "../src/cliOAuth.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";

const oauthTestStatePath = join(
  tmpdir(),
  `mcp-oauth-${process.pid}-cli-interactive.json`,
);

async function completeOAuthAuthorization(
  authorizationUrl: URL,
): Promise<string> {
  let response = await fetch(authorizationUrl.toString(), {
    redirect: "manual",
  });

  // Local composable test AS shows an HTML consent page on GET; approve via POST.
  if (response.status === 200) {
    const body = new URLSearchParams(authorizationUrl.searchParams);
    response = await fetch(
      `${authorizationUrl.origin}${authorizationUrl.pathname}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        redirect: "manual",
      },
    );
  }

  if (response.status !== 302 && response.status !== 301) {
    throw new Error(
      `Expected redirect (302/301), got ${response.status}: ${await response.text()}`,
    );
  }
  const location = response.headers.get("location");
  if (!location) {
    throw new Error("Missing Location header");
  }
  const redirect = new URL(location, authorizationUrl.origin);
  const code = redirect.searchParams.get("code");
  if (!code) {
    throw new Error("Missing authorization code");
  }
  return code;
}

function createAutoCompleteNavigation(
  redirectUrlProvider: MutableRedirectUrlProvider,
) {
  return new CallbackNavigation(async (url) => {
    const code = await completeOAuthAuthorization(url);
    const redirect = redirectUrlProvider.redirectUrl;
    if (!redirect) {
      throw new Error("redirectUrl not set");
    }
    await fetch(`${redirect}?code=${encodeURIComponent(code)}`);
  });
}

const callbackUrlConfig = {
  hostname: "127.0.0.1",
  port: 6276,
  pathname: "/oauth/callback",
};
const presetRedirectUrl = "http://127.0.0.1:6276/oauth/callback";

describe("CLI interactive OAuth (integration)", () => {
  let mcpServer: TestServerHttp | null = null;

  afterEach(async () => {
    if (mcpServer) {
      await mcpServer.stop();
      mcpServer = null;
    }
    clearOAuthTestData();
    try {
      rmSync(oauthTestStatePath, { force: true });
    } catch {
      // ignore
    }
  }, 30_000);

  it("connects to an OAuth-protected server via the loopback callback server", async () => {
    const serverConfig = {
      ...getDefaultServerConfig(),
      serverType: "streamable-http" as const,
      ...createOAuthTestServerConfig({
        requireAuth: true,
        supportDCR: true,
      }),
    };

    mcpServer = new TestServerHttp(serverConfig);
    const port = await mcpServer.start();
    const serverUrl = `http://localhost:${port}`;
    await waitForOAuthWellKnown(serverUrl);

    const redirectUrlProvider = new MutableRedirectUrlProvider();
    redirectUrlProvider.redirectUrl = presetRedirectUrl;
    const navigation = createAutoCompleteNavigation(redirectUrlProvider);
    const client = new InspectorClient(
      {
        type: "streamable-http",
        url: `${serverUrl}/mcp`,
      } as MCPServerConfig,
      {
        environment: {
          transport: createTransportNode,
          oauth: {
            storage: new NodeOAuthStorage(oauthTestStatePath),
            navigation,
            redirectUrlProvider,
          },
        },
        directAuthRecovery: true,
        oauth: {},
      },
    );

    await connectInspectorWithOAuth(
      client,
      { type: "streamable-http", url: `${serverUrl}/mcp` },
      redirectUrlProvider,
      callbackUrlConfig,
    );

    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(0);
    await client.disconnect();
  }, 30_000);

  it("retries an RPC after step-up authorization when the user confirms", async () => {
    const baseConfig = getDefaultServerConfig();

    const serverConfig = {
      ...baseConfig,
      serverType: "streamable-http" as const,
      tools: baseConfig.tools!.map((tool) =>
        tool.name === "get_temp"
          ? { ...tool, requiredScopes: ["weather:read"] }
          : tool,
      ),
      ...createOAuthTestServerConfig({
        requireAuth: true,
        supportRefreshTokens: true,
        supportDCR: true,
      }),
    };

    mcpServer = new TestServerHttp(serverConfig);
    const port = await mcpServer.start();
    const serverUrl = `http://localhost:${port}`;
    await waitForOAuthWellKnown(serverUrl);

    const redirectUrlProvider = new MutableRedirectUrlProvider();
    redirectUrlProvider.redirectUrl = presetRedirectUrl;
    const navigation = createAutoCompleteNavigation(redirectUrlProvider);
    const client = new InspectorClient(
      {
        type: "streamable-http",
        url: `${serverUrl}/mcp`,
      } as MCPServerConfig,
      {
        environment: {
          transport: createTransportNode,
          oauth: {
            storage: new NodeOAuthStorage(oauthTestStatePath),
            navigation,
            redirectUrlProvider,
          },
        },
        directAuthRecovery: true,
        oauth: {
          scope: "mcp tools:read",
        },
      },
    );

    await connectInspectorWithOAuth(
      client,
      { type: "streamable-http", url: `${serverUrl}/mcp` },
      redirectUrlProvider,
      callbackUrlConfig,
    );

    const tools = await client.listTools();
    const getTempTool = tools.tools.find((tool) => tool.name === "get_temp");
    expect(getTempTool).toBeDefined();

    let stepUpPrompted = false;
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk, ...rest) => {
      const text = typeof chunk === "string" ? chunk : String(chunk);
      if (text.includes("Proceed with step-up authorization?")) {
        stepUpPrompted = true;
      }
      return originalWrite(chunk, ...rest);
    }) as typeof process.stderr.write;

    try {
      const result = await withCliAuthRecoveryRetry(
        client,
        redirectUrlProvider,
        callbackUrlConfig,
        {},
        () =>
          client.callTool(getTempTool!, {
            city: "NYC",
            units: "C",
          }),
        async () => true,
      );

      expect(stepUpPrompted).toBe(true);
      expect(result.success).toBe(true);
    } finally {
      process.stderr.write = originalWrite;
      await client.disconnect();
    }
  }, 30_000);
});
