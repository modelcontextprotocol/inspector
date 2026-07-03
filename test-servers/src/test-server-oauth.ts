/**
 * OAuth Test Server Infrastructure
 *
 * Provides OAuth 2.1 authorization server functionality for test servers.
 * Integrates with Express apps to add OAuth endpoints and Bearer token verification.
 */

import crypto from "node:crypto";
import type { Request, Response } from "express";
import express from "express";
import type { ServerConfig } from "./composable-test-server.js";
import { ExternalAccessTokenValidator } from "./test-server-oauth-jwt.js";

type OAuthRequest = Request & {
  oauthToken?: string;
  oauthTokenScopes?: string[];
};

/**
 * OAuth configuration from ServerConfig
 */
export type OAuthConfig = NonNullable<ServerConfig["oauth"]>;

export function getOAuthMode(
  config: OAuthConfig,
): "combined" | "protected-resource" {
  return config.mode ?? "combined";
}

/**
 * Set up OAuth routes on an Express application
 * This adds all OAuth endpoints (authorization, token, metadata, etc.)
 *
 * @param app - Express application
 * @param config - OAuth configuration
 */
export function setupOAuthRoutes(
  app: express.Application,
  config: OAuthConfig,
): void {
  setupMetadataEndpoints(app, config);

  if (getOAuthMode(config) === "combined") {
    setupAuthorizationEndpoint(app, config);
    setupTokenEndpoint(app, config);
    if (config.supportDCR) {
      setupDCREndpoint(app);
    }
  }
}

/**
 * Create Bearer token verification middleware
 * Returns 401 if token is missing or invalid when requireAuth is true
 *
 * @param config - OAuth configuration
 * @returns Express middleware function
 */
export function createBearerTokenMiddleware(
  config: OAuthConfig,
): express.RequestHandler {
  const mode = getOAuthMode(config);
  const externalValidator =
    mode === "protected-resource"
      ? new ExternalAccessTokenValidator(config)
      : undefined;

  return async (req: Request, res: Response, next: express.NextFunction) => {
    if (!config.requireAuth) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      // Return 401 - the SDK's transport should detect this and throw an error
      // For streamable-http, the SDK checks response status and throws StreamableHTTPError with code 401
      res.status(401);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("WWW-Authenticate", "Bearer");
      // Return a JSON-RPC error response format that the SDK will recognize
      res.json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Unauthorized: Missing or invalid Bearer token (401)",
        },
        id: null,
      });
      return;
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    let valid = false;
    let grantedScopes: string[] = [];
    if (mode === "protected-resource") {
      try {
        const validated =
          await externalValidator!.validateAccessTokenWithScopes(token);
        valid = validated.valid;
        grantedScopes = validated.scopes;
      } catch {
        valid = false;
      }
    } else {
      valid = isValidToken(token);
      if (valid) {
        grantedScopes = getAccessTokenScopes(token);
      }
    }

    if (!valid) {
      // Return 401 - the SDK's transport should detect this and throw an error
      res.status(401);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("WWW-Authenticate", "Bearer");
      // Return a JSON-RPC error response format that the SDK will recognize
      res.json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Unauthorized: Invalid or expired token (401)",
        },
        id: null,
      });
      return;
    }

    // Attach token info to request for use in handlers
    const oauthReq = req as OAuthRequest;
    oauthReq.oauthToken = token;
    oauthReq.oauthTokenScopes = grantedScopes;
    next();
  };
}

/**
 * Set up OAuth metadata endpoints (RFC 8414)
 */
function setupMetadataEndpoints(
  app: express.Application,
  config: OAuthConfig,
): void {
  const scopes = config.scopesSupported || ["mcp"];
  const mode = getOAuthMode(config);

  if (mode === "combined") {
    // OAuth Authorization Server Metadata (local AS)
    app.get(
      "/.well-known/oauth-authorization-server",
      (req: Request, res: Response) => {
        const requestBaseUrl = `${req.protocol}://${req.get("host")}`;
        const actualIssuerUrl = config.issuerUrl ?? new URL(requestBaseUrl);
        const metadata = {
          issuer: actualIssuerUrl.href.replace(/\/$/, "") + "/",
          authorization_endpoint: new URL("/oauth/authorize", actualIssuerUrl)
            .href,
          token_endpoint: new URL("/oauth/token", actualIssuerUrl).href,
          scopes_supported: scopes,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["client_secret_basic", "none"],
          ...(config.supportDCR && {
            registration_endpoint: new URL("/oauth/register", actualIssuerUrl)
              .href,
          }),
          ...(config.supportCIMD && {
            client_id_metadata_document_supported: true,
          }),
        };

        res.json(metadata);
      },
    );
  }

  // OAuth Protected Resource Metadata
  app.get(
    "/.well-known/oauth-protected-resource",
    (req: Request, res: Response) => {
      const requestBaseUrl = `${req.protocol}://${req.get("host")}`;
      const resourceUrl =
        config.resource ?? new URL("/", requestBaseUrl).href;
      const localAsUrl = (config.issuerUrl ?? new URL(requestBaseUrl)).href.replace(
        /\/$/,
        "",
      );
      const authorizationServers =
        mode === "protected-resource"
          ? (config.authorizationServers ?? [])
          : [localAsUrl];
      const metadata = {
        resource: resourceUrl,
        authorization_servers: authorizationServers.map((url) =>
          url.replace(/\/$/, ""),
        ),
        scopes_supported: scopes,
      };

      res.json(metadata);
    },
  );
}

/**
 * Set up OAuth authorization endpoint.
 * Shows a simple consent page so users know they reached the test authorization server.
 */
function setupAuthorizationEndpoint(
  app: express.Application,
  config: OAuthConfig,
): void {
  app.get("/oauth/authorize", async (req: Request, res: Response) => {
    const parsed = await parseAuthorizationRequest(req.query, config);
    if (!parsed.ok) {
      res.status(parsed.status).json(parsed.body);
      return;
    }

    res.type("html").send(renderOAuthConsentPage(parsed.value));
  });

  app.post(
    "/oauth/authorize",
    express.urlencoded({ extended: true }),
    async (req: Request, res: Response) => {
      const parsed = await parseAuthorizationRequest(req.body, config);
      if (!parsed.ok) {
        res.status(parsed.status).json(parsed.body);
        return;
      }

      completeAuthorizationRedirect(res, parsed.value);
    },
  );
}

interface AuthorizationRequestParams {
  clientId: string;
  redirectUri: string;
  responseType: string;
  scope?: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}

type AuthorizationRequestResult =
  | { ok: true; value: AuthorizationRequestParams }
  | { ok: false; status: number; body: Record<string, unknown> };

async function parseAuthorizationRequest(
  input: Record<string, unknown>,
  config: OAuthConfig,
): Promise<AuthorizationRequestResult> {
  const client_id = input.client_id;
  const redirect_uri = input.redirect_uri;
  const response_type = input.response_type;
  const scope = input.scope;
  const state = input.state;
  const code_challenge = input.code_challenge;
  const code_challenge_method = input.code_challenge_method;

  if (
    typeof client_id !== "string" ||
    typeof redirect_uri !== "string" ||
    typeof response_type !== "string"
  ) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "invalid_request",
        error_description: "Missing required parameters",
      },
    };
  }

  if (response_type !== "code") {
    return { ok: false, status: 400, body: { error: "unsupported_response_type" } };
  }

  const client = await findClient(client_id, config);
  if (!client) {
    return { ok: false, status: 400, body: { error: "invalid_client" } };
  }

  if (
    client.redirectUris &&
    !client.redirectUris.includes(redirect_uri)
  ) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "invalid_request",
        error_description: "Invalid redirect_uri",
      },
    };
  }

  if (
    typeof code_challenge_method === "string" &&
    code_challenge_method !== "S256"
  ) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "invalid_request",
        error_description: "Unsupported code_challenge_method",
      },
    };
  }

  return {
    ok: true,
    value: {
      clientId: client_id,
      redirectUri: redirect_uri,
      responseType: response_type,
      ...(typeof scope === "string" ? { scope } : {}),
      ...(typeof state === "string" ? { state } : {}),
      ...(typeof code_challenge === "string"
        ? { codeChallenge: code_challenge }
        : {}),
      ...(typeof code_challenge_method === "string"
        ? { codeChallengeMethod: code_challenge_method }
        : {}),
    },
  };
}

function completeAuthorizationRedirect(
  res: Response,
  params: AuthorizationRequestParams,
): void {
  const authCode = generateAuthorizationCode();
  storeAuthorizationCode(authCode, {
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    scope: params.scope,
  });

  const redirectUrl = new URL(params.redirectUri);
  redirectUrl.searchParams.set("code", authCode);
  if (params.state) {
    redirectUrl.searchParams.set("state", params.state);
  }
  res.redirect(redirectUrl.href);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderOAuthConsentPage(params: AuthorizationRequestParams): string {
  const scopeList = parseScopeString(params.scope);
  const scopeItems =
    scopeList.length > 0
      ? scopeList
          .map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`)
          .join("")
      : "<li><em>No scopes requested</em></li>";

  const hiddenFields = [
    ["client_id", params.clientId],
    ["redirect_uri", params.redirectUri],
    ["response_type", params.responseType],
    ...(params.scope ? [["scope", params.scope] as const] : []),
    ...(params.state ? [["state", params.state] as const] : []),
    ...(params.codeChallenge
      ? [["code_challenge", params.codeChallenge] as const]
      : []),
    ...(params.codeChallengeMethod
      ? [["code_challenge_method", params.codeChallengeMethod] as const]
      : []),
  ]
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorize — MCP test server</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 32rem; line-height: 1.5; }
    h1 { font-size: 1.25rem; }
    code { background: #f4f4f5; padding: 0.1rem 0.25rem; border-radius: 0.25rem; }
    ul { padding-left: 1.25rem; }
    button { font: inherit; padding: 0.5rem 1rem; margin-right: 0.5rem; cursor: pointer; }
    .primary { background: #228be6; color: white; border: 1px solid #1c7ed6; border-radius: 0.25rem; }
    .muted { color: #666; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>Authorize MCP Inspector</h1>
  <p class="muted">You were redirected to the <strong>local composable test authorization server</strong>.</p>
  <p>Client: <code>${escapeHtml(params.clientId)}</code></p>
  <p>Requested scopes:</p>
  <ul>${scopeItems}</ul>
  <form method="post" action="/oauth/authorize">
    ${hiddenFields}
    <button type="submit" class="primary">Authorize</button>
  </form>
</body>
</html>`;
}

/**
 * Set up OAuth token endpoint
 */
function setupTokenEndpoint(
  app: express.Application,
  config: OAuthConfig,
): void {
  app.post(
    "/oauth/token",
    express.urlencoded({ extended: true }),
    async (req: Request, res: Response) => {
      const {
        grant_type,
        code,
        redirect_uri,
        client_id: bodyClientId,
        code_verifier,
        refresh_token,
      } = req.body;

      // Extract client_id from either body (client_secret_post) or Authorization header (client_secret_basic)
      let client_id = bodyClientId;
      let client_secret: string | undefined;

      // Check Authorization header for client_secret_basic
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Basic ")) {
        const credentials = Buffer.from(authHeader.slice(6), "base64").toString(
          "utf-8",
        );
        const [id, secret] = credentials.split(":", 2);
        client_id = id;
        client_secret = secret;
      }

      if (grant_type === "authorization_code") {
        // Authorization code flow
        if (!code || !redirect_uri || !client_id) {
          res.status(400).json({
            error: "invalid_request",
            error_description: "Missing required parameters",
          });
          return;
        }

        const authCodeData = getAuthorizationCode(code);
        if (!authCodeData) {
          res.status(400).json({
            error: "invalid_grant",
            error_description: "Invalid or expired authorization code",
          });
          return;
        }

        // Verify client
        const client = await findClient(client_id, config);
        if (!client || client.clientId !== authCodeData.clientId) {
          res.status(400).json({ error: "invalid_client" });
          return;
        }

        // Verify client secret if provided (for client_secret_basic)
        if (
          client_secret &&
          client.clientSecret &&
          client.clientSecret !== client_secret
        ) {
          res.status(400).json({ error: "invalid_client" });
          return;
        }

        // Verify redirect_uri
        if (authCodeData.redirectUri !== redirect_uri) {
          res.status(400).json({
            error: "invalid_grant",
            error_description: "Redirect URI mismatch",
          });
          return;
        }

        // Verify PKCE code verifier
        if (authCodeData.codeChallenge) {
          if (!code_verifier) {
            res.status(400).json({
              error: "invalid_request",
              error_description: "code_verifier required",
            });
            return;
          }
          // Proper PKCE verification: code_challenge should be base64url(SHA256(code_verifier))
          const hash = crypto
            .createHash("sha256")
            .update(code_verifier)
            .digest();
          // Convert to base64url (replace + with -, / with _, remove padding)
          const expectedChallenge = hash
            .toString("base64")
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=/g, "");
          if (authCodeData.codeChallenge !== expectedChallenge) {
            res.status(400).json({
              error: "invalid_grant",
              error_description: "Invalid code_verifier",
            });
            return;
          }
        }

        // Generate access token
        const tokenScope =
          authCodeData.scope || config.scopesSupported?.[0] || "mcp";
        const accessToken = generateAccessToken(tokenScope);
        const tokenExpiration = config.tokenExpirationSeconds || 3600;

        const response: {
          access_token: string;
          token_type: string;
          expires_in: number;
          scope: string;
          refresh_token?: string;
        } = {
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: tokenExpiration,
          scope: tokenScope,
        };

        // Add refresh token if supported
        if (config.supportRefreshTokens !== false) {
          const refreshToken = generateRefreshToken();
          response.refresh_token = refreshToken;
          storeRefreshToken(refreshToken, {
            clientId: client_id,
            scope: authCodeData.scope,
          });
        }

        res.json(response);
      } else if (grant_type === "refresh_token") {
        // Refresh token flow
        if (!refresh_token || !client_id) {
          res.status(400).json({ error: "invalid_request" });
          return;
        }

        const refreshTokenData = getRefreshToken(refresh_token);
        if (!refreshTokenData || refreshTokenData.clientId !== client_id) {
          res.status(400).json({ error: "invalid_grant" });
          return;
        }

        const tokenScope =
          refreshTokenData.scope || config.scopesSupported?.[0] || "mcp";
        const accessToken = generateAccessToken(tokenScope);
        const tokenExpiration = config.tokenExpirationSeconds || 3600;

        res.json({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: tokenExpiration,
          scope: tokenScope,
        });
      } else {
        res.status(400).json({ error: "unsupported_grant_type" });
      }
    },
  );
}

/**
 * Set up Dynamic Client Registration endpoint
 */
function setupDCREndpoint(app: express.Application): void {
  app.post("/oauth/register", express.json(), (req: Request, res: Response) => {
    const { redirect_uris, client_name, scope } = req.body;

    if (
      !redirect_uris ||
      !Array.isArray(redirect_uris) ||
      redirect_uris.length === 0
    ) {
      res.status(400).json({ error: "invalid_client_metadata" });
      return;
    }

    dcrRequests.push({ redirect_uris: [...redirect_uris] });

    // Generate client ID and secret
    const clientId = generateClientId();
    const clientSecret = generateClientSecret();

    // Store registered client
    registerClient(clientId, {
      clientSecret,
      redirectUris: redirect_uris,
      clientName: client_name,
      scope,
    });

    res.status(201).json({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris,
      ...(client_name && { client_name }),
      ...(scope && { scope }),
    });
  });
}

// In-memory storage for test server (simplified - not production-ready)
interface AuthorizationCodeData {
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  scope?: string;
  expiresAt: number;
}

interface RefreshTokenData {
  clientId: string;
  scope?: string;
}

interface RegisteredClient {
  clientSecret?: string;
  redirectUris: string[];
  clientName?: string;
  scope?: string;
}

const authorizationCodes = new Map<string, AuthorizationCodeData>();
const accessTokens = new Set<string>();
/** Granted OAuth scope string per access token (space-separated). */
const accessTokenScopes = new Map<string, string>();
const refreshTokens = new Map<string, RefreshTokenData>();
const registeredClients = new Map<string, RegisteredClient>();

/** Recorded DCR request bodies (redirect_uris) for tests that verify both URLs are registered. */
const dcrRequests: Array<{ redirect_uris: string[] }> = [];

/**
 * Check if a string is a valid URL
 */
function isUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch client metadata document from URL (for CIMD)
 */
async function fetchClientMetadata(metadataUrl: string): Promise<{
  redirect_uris: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  client_name?: string;
  client_uri?: string;
  scope?: string;
} | null> {
  try {
    const response = await fetch(metadataUrl);
    if (!response.ok) {
      return null;
    }
    const metadata = await response.json();
    return metadata;
  } catch {
    return null;
  }
}

async function findClient(
  clientId: string,
  config: OAuthConfig,
): Promise<{
  clientId: string;
  clientSecret?: string;
  redirectUris?: string[];
} | null> {
  // Check static clients first
  if (config.staticClients) {
    const staticClient = config.staticClients.find(
      (c) => c.clientId === clientId,
    );
    if (staticClient) {
      return {
        clientId: staticClient.clientId,
        clientSecret: staticClient.clientSecret,
        redirectUris: staticClient.redirectUris,
      };
    }
  }

  // Check registered clients (DCR)
  if (registeredClients.has(clientId)) {
    const client = registeredClients.get(clientId)!;
    return {
      clientId,
      clientSecret: client.clientSecret,
      redirectUris: client.redirectUris,
    };
  }

  // Check CIMD: if client_id is a URL and CIMD is supported, fetch metadata
  if (config.supportCIMD && isUrl(clientId)) {
    const metadata = await fetchClientMetadata(clientId);
    if (
      metadata &&
      metadata.redirect_uris &&
      Array.isArray(metadata.redirect_uris)
    ) {
      // For CIMD, the client_id is the URL itself, and there's no client_secret
      // (CIMD uses token_endpoint_auth_method: "none" typically)
      return {
        clientId, // The URL is the client_id
        clientSecret: undefined, // CIMD typically doesn't use secrets
        redirectUris: metadata.redirect_uris,
      };
    }
  }

  return null;
}

function generateAuthorizationCode(): string {
  return `test_auth_code_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

function storeAuthorizationCode(
  code: string,
  data: Omit<AuthorizationCodeData, "expiresAt">,
): void {
  authorizationCodes.set(code, {
    ...data,
    expiresAt: Date.now() + 60000, // 1 minute expiration
  });
}

function getAuthorizationCode(code: string): AuthorizationCodeData | null {
  const data = authorizationCodes.get(code);
  if (!data) {
    return null;
  }

  // Check expiration
  if (Date.now() > data.expiresAt) {
    authorizationCodes.delete(code);
    return null;
  }

  // Delete after use (authorization codes are single-use)
  authorizationCodes.delete(code);
  return data;
}

function generateAccessToken(scope?: string): string {
  const token = `test_access_token_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  accessTokens.add(token);
  accessTokenScopes.set(token, scope?.trim() || "mcp");
  return token;
}

function generateRefreshToken(): string {
  return `test_refresh_token_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

function storeRefreshToken(token: string, data: RefreshTokenData): void {
  refreshTokens.set(token, data);
}

function getRefreshToken(token: string): RefreshTokenData | null {
  return refreshTokens.get(token) || null;
}

function generateClientId(): string {
  return `test_client_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

function generateClientSecret(): string {
  return `test_secret_${Math.random().toString(36).substring(2, 15)}`;
}

function registerClient(clientId: string, client: RegisteredClient): void {
  registeredClients.set(clientId, client);
}

function isValidToken(token: string): boolean {
  // Simplified token validation for test server
  // In production, verify JWT signature, expiration, etc.
  return accessTokens.has(token);
}

function parseScopeString(scope: string | undefined): string[] {
  if (!scope?.trim()) {
    return [];
  }
  return scope.trim().split(/\s+/).filter(Boolean);
}

/** Test helper: mint an access token with the given granted scopes. */
export function mintTestAccessToken(scope: string): string {
  return generateAccessToken(scope);
}

/** Granted scopes for a test-server access token (empty when unknown). */
export function getAccessTokenScopes(token: string): string[] {
  return parseScopeString(accessTokenScopes.get(token));
}

export interface ScopeRequirementRegistry {
  tools: Map<string, string[]>;
  resources: Map<string, string[]>;
  prompts: Map<string, string[]>;
  resourceTemplates: Map<string, string[]>;
}

function resourceUriMatchesTemplate(uri: string, uriTemplate: string): boolean {
  const brace = uriTemplate.indexOf("{");
  const prefix = brace >= 0 ? uriTemplate.slice(0, brace) : uriTemplate;
  return uri.startsWith(prefix);
}

/** Build lookup tables from merged ServerConfig capability definitions. */
export function buildScopeRequirementRegistry(
  config: ServerConfig,
): ScopeRequirementRegistry {
  const registry: ScopeRequirementRegistry = {
    tools: new Map(),
    resources: new Map(),
    prompts: new Map(),
    resourceTemplates: new Map(),
  };

  for (const tool of config.tools ?? []) {
    if (tool.requiredScopes?.length) {
      registry.tools.set(tool.name, tool.requiredScopes);
    }
  }
  for (const resource of config.resources ?? []) {
    if (resource.requiredScopes?.length) {
      registry.resources.set(resource.uri, resource.requiredScopes);
    }
  }
  for (const prompt of config.prompts ?? []) {
    if (prompt.requiredScopes?.length) {
      registry.prompts.set(prompt.name, prompt.requiredScopes);
    }
  }
  for (const template of config.resourceTemplates ?? []) {
    if (template.requiredScopes?.length) {
      registry.resourceTemplates.set(template.uriTemplate, template.requiredScopes);
    }
  }

  return registry;
}

export function scopeRequirementRegistryHasEntries(
  registry: ScopeRequirementRegistry,
): boolean {
  return (
    registry.tools.size > 0 ||
    registry.resources.size > 0 ||
    registry.prompts.size > 0 ||
    registry.resourceTemplates.size > 0
  );
}

function parseMcpOperation(body: unknown): {
  method?: string;
  target?: string;
} {
  if (!body || typeof body !== "object") {
    return {};
  }
  const rpc = body as Record<string, unknown>;
  const method = typeof rpc.method === "string" ? rpc.method : undefined;
  const params =
    rpc.params && typeof rpc.params === "object"
      ? (rpc.params as Record<string, unknown>)
      : undefined;

  if (method === "tools/call" && typeof params?.name === "string") {
    return { method, target: params.name };
  }
  if (method === "resources/read" && typeof params?.uri === "string") {
    return { method, target: params.uri };
  }
  if (method === "prompts/get" && typeof params?.name === "string") {
    return { method, target: params.name };
  }

  return { method };
}

function tokenHasRequiredScopes(
  granted: string[],
  required: string[],
): boolean {
  const grantedSet = new Set(granted);
  return required.every((scope) => grantedSet.has(scope));
}

/**
 * Enforce per-capability OAuth scopes after bearer validation.
 * Returns 403 + insufficient_scope when the token is valid but lacks scope.
 */
export function createScopeCheckMiddleware(
  registry: ScopeRequirementRegistry,
): express.RequestHandler {
  return (req: Request, res: Response, next: express.NextFunction) => {
    const oauthReq = req as OAuthRequest;
    const token = oauthReq.oauthToken;
    if (!token) {
      return next();
    }

    const { method, target } = parseMcpOperation(req.body);
    if (!method || !target) {
      return next();
    }

    let requiredScopes: string[] | undefined;
    if (method === "tools/call") {
      requiredScopes = registry.tools.get(target);
    } else if (method === "resources/read") {
      requiredScopes = registry.resources.get(target);
      if (!requiredScopes?.length) {
        for (const [uriTemplate, scopes] of registry.resourceTemplates) {
          if (resourceUriMatchesTemplate(target, uriTemplate)) {
            requiredScopes = scopes;
            break;
          }
        }
      }
    } else if (method === "prompts/get") {
      requiredScopes = registry.prompts.get(target);
    }

    if (!requiredScopes?.length) {
      return next();
    }

    const granted =
      oauthReq.oauthTokenScopes ?? getAccessTokenScopes(token);
    if (tokenHasRequiredScopes(granted, requiredScopes)) {
      return next();
    }

    const grantedSet = new Set(granted);
    const missingScopes = requiredScopes.filter((scope) => !grantedSet.has(scope));
    const scopeHeader = missingScopes.join(" ") || requiredScopes.join(" ");
    res.status(403);
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "WWW-Authenticate",
      `Bearer error="insufficient_scope", scope="${scopeHeader}"`,
    );
    res.json({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: `Forbidden: insufficient scope (403). Required: ${scopeHeader}`,
      },
      id: null,
    });
    return;
  };
}

/**
 * Clear all OAuth test data (useful for test cleanup)
 */
export function clearOAuthTestData(): void {
  authorizationCodes.clear();
  accessTokens.clear();
  accessTokenScopes.clear();
  refreshTokens.clear();
  registeredClients.clear();
  dcrRequests.length = 0;
}

/**
 * Returns recorded DCR request bodies (redirect_uris) for tests that verify
 * redirect URI registration.
 */
export function getDCRRequests(): Array<{ redirect_uris: string[] }> {
  return dcrRequests;
}

/**
 * Invalidate a single access token (remove from valid set).
 * Used by E2E tests to simulate expired/revoked access token while keeping
 * refresh_token valid, so 401 → auth() → refresh → retry can be exercised.
 */
export function invalidateAccessToken(token: string): void {
  accessTokens.delete(token);
  accessTokenScopes.delete(token);
}
