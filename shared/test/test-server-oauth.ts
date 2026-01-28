/**
 * OAuth Test Server Infrastructure
 *
 * Provides OAuth 2.1 authorization server functionality for test servers.
 * Integrates with Express apps to add OAuth endpoints and Bearer token verification.
 */

import type { Request, Response } from "express";
import express from "express";
import type { ServerConfig } from "./composable-test-server.js";

/**
 * OAuth configuration from ServerConfig
 */
export type OAuthConfig = NonNullable<ServerConfig["oauth"]>;

/**
 * Set up OAuth routes on an Express application
 * This adds all OAuth endpoints (authorization, token, metadata, etc.)
 *
 * @param app - Express application
 * @param config - OAuth configuration
 * @param baseUrl - Base URL of the test server (for constructing issuer URL)
 */
export function setupOAuthRoutes(
  app: express.Application,
  config: OAuthConfig,
  baseUrl: string,
): void {
  const issuerUrl = config.issuerUrl || new URL(baseUrl);

  // OAuth metadata endpoints (RFC 8414)
  setupMetadataEndpoints(app, config, issuerUrl);

  // OAuth authorization endpoint
  setupAuthorizationEndpoint(app, config, issuerUrl);

  // OAuth token endpoint
  setupTokenEndpoint(app, config, issuerUrl);

  // Dynamic Client Registration endpoint (if enabled)
  if (config.supportDCR) {
    setupDCREndpoint(app, config, issuerUrl);
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

    // Verify token (simplified for test server - in production, use proper JWT verification)
    if (!isValidToken(token, config)) {
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
    (req as any).oauthToken = token;
    next();
  };
}

/**
 * Set up OAuth metadata endpoints (RFC 8414)
 */
function setupMetadataEndpoints(
  app: express.Application,
  config: OAuthConfig,
  issuerUrl: URL,
): void {
  const scopes = config.scopesSupported || ["mcp"];

  // OAuth Authorization Server Metadata
  app.get(
    "/.well-known/oauth-authorization-server",
    (req: Request, res: Response) => {
      // Use request's host to get actual server URL (since port is assigned dynamically)
      const requestBaseUrl = `${req.protocol}://${req.get("host")}`;
      const actualIssuerUrl = new URL(requestBaseUrl);
      const metadata = {
        issuer: actualIssuerUrl.href,
        authorization_endpoint: new URL("/oauth/authorize", actualIssuerUrl)
          .href,
        token_endpoint: new URL("/oauth/token", actualIssuerUrl).href,
        scopes_supported: scopes,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"], // PKCE support
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

  // OAuth Protected Resource Metadata
  app.get(
    "/.well-known/oauth-protected-resource",
    (req: Request, res: Response) => {
      // Use request's host so resource matches actual server URL (port 0 → assigned port)
      const requestBaseUrl = `${req.protocol}://${req.get("host")}`;
      const actualResourceUrl = new URL("/", requestBaseUrl).href;
      const metadata = {
        resource: actualResourceUrl,
        authorization_servers: [actualResourceUrl],
        scopes_supported: scopes,
      };

      res.json(metadata);
    },
  );
}

/**
 * Set up OAuth authorization endpoint
 * For test servers, this auto-approves requests and redirects with authorization code
 */
function setupAuthorizationEndpoint(
  app: express.Application,
  config: OAuthConfig,
  issuerUrl: URL,
): void {
  app.get("/oauth/authorize", async (req: Request, res: Response) => {
    const {
      client_id,
      redirect_uri,
      response_type,
      scope,
      state,
      code_challenge,
      code_challenge_method,
    } = req.query;

    // Validate required parameters
    if (!client_id || !redirect_uri || !response_type) {
      res.status(400).json({
        error: "invalid_request",
        error_description: "Missing required parameters",
      });
      return;
    }

    if (response_type !== "code") {
      res.status(400).json({ error: "unsupported_response_type" });
      return;
    }

    // Validate client (check static clients, DCR, or CIMD)
    const client = await findClient(client_id as string, config);
    if (!client) {
      res.status(400).json({ error: "invalid_client" });
      return;
    }

    // Validate redirect_uri
    if (
      client.redirectUris &&
      !client.redirectUris.includes(redirect_uri as string)
    ) {
      res.status(400).json({
        error: "invalid_request",
        error_description: "Invalid redirect_uri",
      });
      return;
    }

    // Validate PKCE
    if (code_challenge_method && code_challenge_method !== "S256") {
      res.status(400).json({
        error: "invalid_request",
        error_description: "Unsupported code_challenge_method",
      });
      return;
    }

    // For test servers, auto-approve and generate authorization code
    const authCode = generateAuthorizationCode(
      client_id as string,
      code_challenge as string | undefined,
    );

    // Store authorization code temporarily (in production, use proper storage)
    storeAuthorizationCode(authCode, {
      clientId: client_id as string,
      redirectUri: redirect_uri as string,
      codeChallenge: code_challenge as string | undefined,
      scope: scope as string | undefined,
    });

    // Redirect with authorization code
    const redirectUrl = new URL(redirect_uri as string);
    redirectUrl.searchParams.set("code", authCode);
    if (state) {
      redirectUrl.searchParams.set("state", state as string);
    }

    res.redirect(redirectUrl.href);
  });
}

/**
 * Set up OAuth token endpoint
 */
function setupTokenEndpoint(
  app: express.Application,
  config: OAuthConfig,
  issuerUrl: URL,
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
          const crypto = require("node:crypto");
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
        const accessToken = generateAccessToken(client_id, authCodeData.scope);
        const tokenExpiration = config.tokenExpirationSeconds || 3600;

        const response: any = {
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: tokenExpiration,
          scope: authCodeData.scope || config.scopesSupported?.[0] || "mcp",
        };

        // Add refresh token if supported
        if (config.supportRefreshTokens !== false) {
          const refreshToken = generateRefreshToken(client_id);
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

        const accessToken = generateAccessToken(
          client_id,
          refreshTokenData.scope,
        );
        const tokenExpiration = config.tokenExpirationSeconds || 3600;

        res.json({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: tokenExpiration,
          scope: refreshTokenData.scope || config.scopesSupported?.[0] || "mcp",
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
function setupDCREndpoint(
  app: express.Application,
  config: OAuthConfig,
  issuerUrl: URL,
): void {
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
const refreshTokens = new Map<string, RefreshTokenData>();
const registeredClients = new Map<string, RegisteredClient>();

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

function generateAuthorizationCode(
  clientId: string,
  codeChallenge?: string,
): string {
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

function generateAccessToken(clientId: string, scope?: string): string {
  const token = `test_access_token_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  accessTokens.add(token);
  return token;
}

function generateRefreshToken(clientId: string): string {
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

function isValidToken(token: string, config: OAuthConfig): boolean {
  // Simplified token validation for test server
  // In production, verify JWT signature, expiration, etc.
  return accessTokens.has(token);
}

/**
 * Clear all OAuth test data (useful for test cleanup)
 */
export function clearOAuthTestData(): void {
  authorizationCodes.clear();
  accessTokens.clear();
  refreshTokens.clear();
  registeredClients.clear();
}
