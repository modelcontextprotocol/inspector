/**
 * OAuth route handlers for Express
 */
import express, { Request, Response } from "express";
import { discover, discoverScopes } from "./discovery.js";
import { registerClient } from "./client-registration.js";
import { createAuthorizationUrl } from "./authorization.js";
import { exchangeToken } from "./token-exchange.js";
import { refreshToken } from "./token-refresh.js";
import { fetchUserInfo, validateIdToken } from "./oidc.js";
import {
  DiscoveryRequest,
  RegisterClientRequest,
  AuthorizationRequest,
  TokenExchangeRequest,
  TokenRefreshRequest,
  UserInfoRequest,
  ValidateIdTokenRequest,
  DiscoverScopesRequest,
} from "./types.js";

const router = express.Router();

// Enable JSON body parsing for all OAuth routes
router.use(express.json());

/**
 * Wraps an OAuth route handler with consistent error handling
 */
function wrapOAuthHandler<TRequest, TResponse>(
  handler: (request: TRequest) => Promise<TResponse>,
  options: {
    operationName: string;
    validate?: (request: TRequest) => { valid: boolean; error?: string };
  },
) {
  return async (req: Request, res: Response) => {
    try {
      const request = req.body as TRequest;

      // Run validation if provided
      if (options.validate) {
        const validation = options.validate(request);
        if (!validation.valid) {
          res.status(400).json({ error: validation.error });
          return;
        }
      }

      const result = await handler(request);
      res.json(result);
    } catch (error) {
      console.error(`Error in /api/oauth/${options.operationName}:`, error);
      res.status(500).json({
        error: `${options.operationName.charAt(0).toUpperCase() + options.operationName.slice(1).replace(/-/g, " ")} failed`,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

/**
 * POST /api/oauth/discover
 * Discover OAuth metadata from server
 */
router.post(
  "/discover",
  wrapOAuthHandler<DiscoveryRequest, Awaited<ReturnType<typeof discover>>>(
    (request) => discover(request.serverUrl, request.provider),
    {
      operationName: "discover",
      validate: (request) =>
        request.serverUrl
          ? { valid: true }
          : { valid: false, error: "serverUrl is required" },
    },
  ),
);

/**
 * POST /api/oauth/discover-scopes
 * Discover OAuth scopes from server metadata
 */
router.post(
  "/discover-scopes",
  wrapOAuthHandler<DiscoverScopesRequest, { scopes: string | undefined }>(
    async (request) => ({
      scopes: await discoverScopes(request.serverUrl, request.resourceMetadata),
    }),
    {
      operationName: "discover-scopes",
      validate: (request) =>
        request.serverUrl
          ? { valid: true }
          : { valid: false, error: "serverUrl is required" },
    },
  ),
);

/**
 * POST /api/oauth/register-client
 * Register OAuth client
 */
router.post(
  "/register-client",
  wrapOAuthHandler<
    RegisterClientRequest,
    Awaited<ReturnType<typeof registerClient>>
  >(registerClient, {
    operationName: "register-client",
    validate: (request) =>
      request.authServerUrl && request.metadata
        ? { valid: true }
        : { valid: false, error: "authServerUrl and metadata are required" },
  }),
);

/**
 * POST /api/oauth/start-authorization
 * Create authorization URL with PKCE
 */
router.post(
  "/start-authorization",
  wrapOAuthHandler<
    AuthorizationRequest,
    Awaited<ReturnType<typeof createAuthorizationUrl>>
  >(createAuthorizationUrl, {
    operationName: "start-authorization",
    validate: (request) =>
      request.authServerUrl &&
      request.clientId &&
      request.redirectUri &&
      request.scope
        ? { valid: true }
        : {
            valid: false,
            error:
              "authServerUrl, clientId, redirectUri, and scope are required",
          },
  }),
);

/**
 * POST /api/oauth/exchange-token
 * Exchange authorization code for tokens
 */
router.post(
  "/exchange-token",
  wrapOAuthHandler<
    TokenExchangeRequest,
    Awaited<ReturnType<typeof exchangeToken>>
  >(exchangeToken, {
    operationName: "exchange-token",
    validate: (request) =>
      request.tokenEndpoint &&
      request.code &&
      request.codeVerifier &&
      request.clientId &&
      request.redirectUri
        ? { valid: true }
        : {
            valid: false,
            error:
              "tokenEndpoint, code, codeVerifier, clientId, and redirectUri are required",
          },
  }),
);

/**
 * POST /api/oauth/refresh-token
 * Refresh access token
 */
router.post(
  "/refresh-token",
  wrapOAuthHandler<
    TokenRefreshRequest,
    Awaited<ReturnType<typeof refreshToken>>
  >(refreshToken, {
    operationName: "refresh-token",
    validate: (request) =>
      request.tokenEndpoint && request.refreshToken && request.clientId
        ? { valid: true }
        : {
            valid: false,
            error: "tokenEndpoint, refreshToken, and clientId are required",
          },
  }),
);

/**
 * POST /api/oauth/userinfo
 * Fetch user info from OIDC UserInfo endpoint
 */
router.post(
  "/userinfo",
  wrapOAuthHandler<UserInfoRequest, Awaited<ReturnType<typeof fetchUserInfo>>>(
    fetchUserInfo,
    {
      operationName: "userinfo",
      validate: (request) =>
        request.userInfoEndpoint && request.accessToken
          ? { valid: true }
          : {
              valid: false,
              error: "userInfoEndpoint and accessToken are required",
            },
    },
  ),
);

/**
 * POST /api/oauth/validate-id-token
 * Validate OIDC ID token
 */
router.post(
  "/validate-id-token",
  wrapOAuthHandler<
    ValidateIdTokenRequest,
    Awaited<ReturnType<typeof validateIdToken>>
  >(validateIdToken, {
    operationName: "validate-id-token",
    validate: (request) =>
      request.idToken && request.jwksUri && request.issuer && request.clientId
        ? { valid: true }
        : {
            valid: false,
            error: "idToken, jwksUri, issuer, and clientId are required",
          },
  }),
);

export default router;
