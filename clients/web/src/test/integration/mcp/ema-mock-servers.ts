/**
 * Mock IdP and resource authorization servers for EMA integration tests.
 * Topology mirrors xaa.dev staging (separate IdP + resource AS) — see
 * test-servers/configs/xaa-ema-http.json and specification/v2_auth_ema.md.
 */

import crypto from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  GRANT_TYPE_JWT_BEARER,
  GRANT_TYPE_TOKEN_EXCHANGE,
  TOKEN_TYPE_ID_JAG,
} from "@inspector/core/auth/ema/constants.js";

export const EMA_MOCK_IDP_CLIENT_ID = "ema-mock-idp-client";
export const EMA_MOCK_IDP_CLIENT_SECRET = "ema-mock-idp-secret";
export const EMA_MOCK_RESOURCE_CLIENT_ID = "ema-mock-resource-client";
export const EMA_MOCK_RESOURCE_CLIENT_SECRET = "ema-mock-resource-secret";

/**
 * Fields required by SDK `OAuthMetadataSchema` for discovery in tests.
 *
 * `authorization_response_iss_parameter_supported` mirrors real-world IdPs
 * (e.g. Okta/xaa.dev): once advertised, the SDK enforces RFC 9207 §2.4 and
 * rejects a callback whose `iss` is missing. Keep it on so the mock stays at
 * least as strict as production servers — with it absent the SDK silently takes
 * its lenient path and a dropped `iss` goes unnoticed.
 */
export function minimalOAuthAsMetadata(
  baseUrl: string,
  authorizationEndpoint = `${baseUrl}/authorize`,
) {
  return {
    issuer: baseUrl,
    authorization_endpoint: authorizationEndpoint,
    token_endpoint: `${baseUrl}/token`,
    response_types_supported: ["code"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
    authorization_response_iss_parameter_supported: true,
  };
}

export interface EmaMockKeyMaterial {
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  publicKey: Awaited<ReturnType<typeof generateKeyPair>>["publicKey"];
  kid: string;
}

export async function createEmaMockKeyMaterial(): Promise<EmaMockKeyMaterial> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  return { privateKey, publicKey, kid: "ema-mock-key" };
}

export interface StoppableMockServer {
  baseUrl: string;
  stop: () => Promise<void>;
}

async function readFormBody(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString());
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** RFC 7636 S256: base64url(SHA-256(verifier)) === challenge. */
function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  const expected = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return expected === codeChallenge;
}

function startHttpServer(
  createHandler: (
    baseUrl: string,
  ) => (req: IncomingMessage, res: ServerResponse) => Promise<void> | void,
): Promise<StoppableMockServer> {
  return new Promise((resolve, reject) => {
    let baseUrl = "";
    const server = createServer((req, res) => {
      void Promise.resolve(createHandler(baseUrl)(req, res)).catch((err) => {
        if (!res.headersSent) {
          sendJson(res, 500, {
            error: "server_error",
            error_description: err instanceof Error ? err.message : String(err),
          });
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port =
        addr && typeof addr === "object" && "port" in addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        baseUrl,
        stop: () =>
          new Promise<void>((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
    server.on("error", reject);
  });
}

interface IdpAuthCode {
  redirectUri: string;
  codeChallenge?: string;
}

/**
 * Mock enterprise IdP — OIDC discovery, interactive authorization-code login
 * (leg 1), RFC 8693 token exchange (leg 2), and refresh_token grant.
 */
export async function startMockIdpServer(): Promise<StoppableMockServer> {
  // Interactive leg-1 authorization codes minted by GET /authorize, redeemed by
  // the authorization_code branch of POST /token (single-use).
  const authCodes = new Map<string, IdpAuthCode>();

  return startHttpServer((baseUrl) => async (req, res) => {
    const url = new URL(req.url ?? "/", baseUrl);

    if (
      req.method === "GET" &&
      (url.pathname === "/.well-known/oauth-authorization-server" ||
        url.pathname === "/.well-known/openid-configuration")
    ) {
      sendJson(
        res,
        200,
        minimalOAuthAsMetadata(baseUrl, `${baseUrl}/authorize`),
      );
      return;
    }

    // Interactive leg-1 authorization endpoint. Real IdPs render a login/consent
    // page; the mock auto-approves and immediately redirects back to the client
    // with `code`, echoed `state`, and RFC 9207 `iss` (the SDK rejects the later
    // code exchange if `iss` is missing, since the metadata advertises
    // `authorization_response_iss_parameter_supported`).
    if (req.method === "GET" && url.pathname === "/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri");
      if (!redirectUri) {
        sendJson(res, 400, {
          error: "invalid_request",
          error_description: "Missing redirect_uri",
        });
        return;
      }
      const codeChallengeMethod = url.searchParams.get("code_challenge_method");
      if (codeChallengeMethod && codeChallengeMethod !== "S256") {
        sendJson(res, 400, {
          error: "invalid_request",
          error_description: "Unsupported code_challenge_method",
        });
        return;
      }
      const code = `mock-idp-auth-code.${crypto.randomBytes(16).toString("hex")}`;
      const codeChallenge = url.searchParams.get("code_challenge");
      authCodes.set(code, {
        redirectUri,
        ...(codeChallenge ? { codeChallenge } : {}),
      });
      const location = new URL(redirectUri);
      location.searchParams.set("code", code);
      const state = url.searchParams.get("state");
      if (state) {
        location.searchParams.set("state", state);
      }
      location.searchParams.set("iss", baseUrl);
      res.writeHead(302, { Location: location.href });
      res.end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/token") {
      const body = await readFormBody(req);
      if (body.get("grant_type") === "authorization_code") {
        if (
          body.get("client_id") !== EMA_MOCK_IDP_CLIENT_ID ||
          body.get("client_secret") !== EMA_MOCK_IDP_CLIENT_SECRET
        ) {
          sendJson(res, 401, { error: "invalid_client" });
          return;
        }
        const code = body.get("code");
        const stored = code ? authCodes.get(code) : undefined;
        if (!code || !stored) {
          sendJson(res, 400, {
            error: "invalid_grant",
            error_description: "Invalid or expired authorization code",
          });
          return;
        }
        authCodes.delete(code); // single-use
        if (stored.redirectUri !== body.get("redirect_uri")) {
          sendJson(res, 400, {
            error: "invalid_grant",
            error_description: "redirect_uri mismatch",
          });
          return;
        }
        if (stored.codeChallenge) {
          const verifier = body.get("code_verifier");
          if (!verifier || !verifyPkceS256(verifier, stored.codeChallenge)) {
            sendJson(res, 400, {
              error: "invalid_grant",
              error_description: "Invalid code_verifier",
            });
            return;
          }
        }
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const idToken = await createMockIdToken(baseUrl, exp);
        sendJson(res, 200, {
          // OAuthTokensSchema requires access_token + token_type; the EMA IdP leg
          // consumes id_token, but the SDK's exchangeAuthorization still parses
          // the full token response, so include a (dummy) access_token.
          access_token: `mock-idp-access.${crypto.randomBytes(8).toString("hex")}`,
          token_type: "Bearer",
          expires_in: 3600,
          id_token: idToken,
          refresh_token: `mock-idp-refresh.${crypto.randomBytes(8).toString("hex")}`,
        });
        return;
      }
      if (body.get("grant_type") === "refresh_token") {
        if (
          body.get("client_id") !== EMA_MOCK_IDP_CLIENT_ID ||
          body.get("client_secret") !== EMA_MOCK_IDP_CLIENT_SECRET
        ) {
          sendJson(res, 401, { error: "invalid_client" });
          return;
        }
        if (!body.get("refresh_token")) {
          sendJson(res, 400, { error: "invalid_request" });
          return;
        }
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const refreshedIdToken = await createMockIdToken(baseUrl, exp);
        sendJson(res, 200, {
          id_token: refreshedIdToken,
          refresh_token: body.get("refresh_token"),
          token_type: "Bearer",
        });
        return;
      }
      if (body.get("grant_type") !== GRANT_TYPE_TOKEN_EXCHANGE) {
        sendJson(res, 400, {
          error: "unsupported_grant_type",
          error_description: `expected ${GRANT_TYPE_TOKEN_EXCHANGE}`,
        });
        return;
      }
      if (
        body.get("client_id") !== EMA_MOCK_IDP_CLIENT_ID ||
        body.get("client_secret") !== EMA_MOCK_IDP_CLIENT_SECRET
      ) {
        sendJson(res, 401, { error: "invalid_client" });
        return;
      }
      if (!body.get("subject_token")) {
        sendJson(res, 400, { error: "invalid_request" });
        return;
      }
      const idJag = `mock-id-jag.${Buffer.from(body.get("audience") ?? "").toString("base64url")}`;
      sendJson(res, 200, {
        access_token: idJag,
        issued_token_type: TOKEN_TYPE_ID_JAG,
        token_type: "Bearer",
      });
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  });
}

export interface MockResourceAsOptions {
  keys: EmaMockKeyMaterial;
  /** Resource identifier echoed in access-token `aud` when set. */
  resourceAudience?: string;
}

/** Mock resource authorization server — AS discovery, JWKS, JWT bearer grant (leg 3). */
export async function startMockResourceAsServer(
  options: MockResourceAsOptions,
): Promise<StoppableMockServer> {
  const { keys, resourceAudience } = options;
  const jwk = await exportJWK(keys.publicKey);

  return startHttpServer((baseUrl) => async (req, res) => {
    const url = new URL(req.url ?? "/", baseUrl);
    const issuer = baseUrl;

    if (
      req.method === "GET" &&
      url.pathname === "/.well-known/oauth-authorization-server"
    ) {
      sendJson(res, 200, {
        ...minimalOAuthAsMetadata(baseUrl),
        jwks_uri: `${baseUrl}/jwks`,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/jwks") {
      sendJson(res, 200, {
        keys: [{ ...jwk, kid: keys.kid, alg: "RS256", use: "sig" }],
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/token") {
      const body = await readFormBody(req);
      if (body.get("grant_type") !== GRANT_TYPE_JWT_BEARER) {
        sendJson(res, 400, {
          error: "unsupported_grant_type",
          error_description: `expected ${GRANT_TYPE_JWT_BEARER}`,
        });
        return;
      }
      if (
        body.get("client_id") !== EMA_MOCK_RESOURCE_CLIENT_ID ||
        body.get("client_secret") !== EMA_MOCK_RESOURCE_CLIENT_SECRET
      ) {
        sendJson(res, 401, { error: "invalid_client" });
        return;
      }
      if (!body.get("assertion")) {
        sendJson(res, 400, { error: "invalid_request" });
        return;
      }

      const exp = Math.floor(Date.now() / 1000) + 3600;
      const accessToken = await new SignJWT({
        scope: body.get("scope") ?? "mcp",
        ...(resourceAudience ? { aud: resourceAudience } : {}),
      })
        .setProtectedHeader({ alg: "RS256", kid: keys.kid })
        .setIssuer(issuer)
        .setExpirationTime(exp)
        .sign(keys.privateKey);

      sendJson(res, 200, {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 3600,
        scope: body.get("scope") ?? "mcp",
      });
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  });
}

/** Non-expired ID Token JWT for seeding IdP session in storage (leg 1 shortcut). */
export async function createMockIdToken(
  issuer: string,
  expSec?: number,
): Promise<string> {
  const { privateKey } = await generateKeyPair("RS256");
  const exp = expSec ?? Math.floor(Date.now() / 1000) + 3600;
  return new SignJWT({ sub: "ema-test-user" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(issuer.replace(/\/$/, ""))
    .setExpirationTime(exp)
    .sign(privateKey);
}
