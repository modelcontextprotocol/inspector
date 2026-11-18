/**
 * An authorization server whose metadata names an `issuer` other than the URL
 * the document was fetched for, end to end against a real OAuth test server
 * through the real SDK `auth()` (#2983).
 *
 * This is Microsoft Entra ID's multi-tenant shape: the metadata for
 * `https://login.microsoftonline.com/organizations/v2.0` answers with the
 * literal template `https://login.microsoftonline.com/{tenantid}/v2.0`, sends
 * no `iss` on the authorization response and does not advertise one. The
 * in-repo OAuth server always publishes a matching issuer — that is what makes
 * it a conforming server — so the document is rewritten in flight, at the one
 * seam every OAuth request already passes through.
 *
 * The unit tests pin each hop the setting travels. This file proves the two
 * things only the whole flow can: that the default still refuses, with an error
 * that names the way forward, and that the per-server opt-out carries a real
 * authorization-code flow to a connected client.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  TestServerHttp,
  getDefaultServerConfig,
  createOAuthTestServerConfig,
  clearOAuthTestData,
  waitForOAuthWellKnown,
} from "@modelcontextprotocol/inspector-test-server";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import {
  clearAllOAuthClientState,
  NodeOAuthStorage,
} from "@inspector/core/auth/node/index.js";
import { flushStoreFileWrites } from "@inspector/core/storage/store-io.js";
import { ISSUER_METADATA_MISMATCH_HINT } from "@inspector/core/auth/mcpAuth.js";
import {
  createOAuthClientConfig,
  completeOAuthAuthorization,
} from "../helpers/oauth-client-fixtures.js";

const AS_METADATA_PATH = "/.well-known/oauth-authorization-server";
const REDIRECT_URL = "http://localhost:3001/oauth/callback";
const CLIENT_ID = "test-issuer-mismatch";
const CLIENT_SECRET = "test-secret-issuer-mismatch";

const statePath = path.join(
  os.tmpdir(),
  `mcp-oauth-${process.pid}-issuerMetadataMismatch.json`,
);

/**
 * Rewrites the authorization-server metadata document the way Entra's
 * multi-tenant endpoint publishes it: a template `issuer`, and no RFC 9207
 * `iss` advertised. Every other request passes through untouched.
 */
function withTemplateIssuer(templateIssuer: string): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!response.ok || url.pathname !== AS_METADATA_PATH) return response;
    const document = (await response.json()) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        ...document,
        issuer: templateIssuer,
        authorization_response_iss_parameter_supported: false,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
}

describe("authorization server metadata with a non-matching issuer (#2983)", () => {
  let server: TestServerHttp | null = null;
  let client: InspectorClient | null = null;
  let serverUrl = "";

  beforeEach(async () => {
    clearOAuthTestData();
    await clearAllOAuthClientState();
    server = new TestServerHttp({
      ...getDefaultServerConfig(),
      serverType: "streamable-http" as const,
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
    const port = await server.start();
    serverUrl = `http://localhost:${port}`;
    await waitForOAuthWellKnown(serverUrl);
  });

  afterEach(async () => {
    await client?.disconnect();
    client = null;
    await server?.stop();
    server = null;
  });

  afterAll(async () => {
    await flushStoreFileWrites();
    await fs.rm(statePath, { force: true });
  });

  function createClient(skipIssuerMetadataValidation: boolean): {
    client: InspectorClient;
    templateIssuer: string;
  } {
    const templateIssuer = `${serverUrl}/{tenantid}/v2.0`;
    const oauthConfig = createOAuthClientConfig({
      mode: "static",
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUrl: REDIRECT_URL,
    });
    const created = new InspectorClient(
      { type: "streamable-http", url: `${serverUrl}/mcp` },
      {
        environment: {
          transport: createTransportNode,
          fetch: withTemplateIssuer(templateIssuer),
          oauth: {
            storage: new NodeOAuthStorage(statePath),
            navigation: oauthConfig.navigation,
            redirectUrlProvider: oauthConfig.redirectUrlProvider,
          },
        },
        oauth: {
          clientId: oauthConfig.clientId,
          clientSecret: oauthConfig.clientSecret,
          scope: "mcp",
          ...(skipIssuerMetadataValidation && {
            skipIssuerMetadataValidation: true,
          }),
        },
      },
    );
    client = created;
    return { client: created, templateIssuer };
  }

  it("refuses by default, and the error names the per-server setting", async () => {
    const { client: strict, templateIssuer } = createClient(false);

    const err: unknown = await strict.authenticate().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    // The SDK's own diagnosis survives, issuers and all…
    expect(message).toContain(
      "Issuer mismatch in authorization server metadata (RFC 8414 §3.3)",
    );
    expect(message).toContain(JSON.stringify(serverUrl));
    expect(message).toContain(JSON.stringify(templateIssuer));
    // …and is followed by the way forward.
    expect(message).toContain(ISSUER_METADATA_MISMATCH_HINT);
  });

  it("authorizes and connects when the server opted out of the check", async () => {
    const { client: relaxed } = createClient(true);

    const authUrl = await relaxed.authenticate();
    if (!authUrl) throw new Error("Expected authorization URL");
    const { code } = await completeOAuthAuthorization(authUrl);
    // No `iss`: the rewritten document does not advertise one, as Entra's does
    // not, so the RFC 9207 check has nothing to compare.
    await relaxed.completeOAuthFlow(code);
    await relaxed.connect();

    expect(relaxed.getStatus()).toBe("connected");
    expect((await relaxed.getOAuthTokens())?.access_token).toBeDefined();
  });
});
