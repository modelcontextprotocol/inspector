import express, { Request, Response } from 'express';
import { Server } from 'http';
import crypto from 'crypto';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { createHttpTraceMiddleware, HttpTraceCollector } from '../../middleware/http-trace.js';
import { HttpTrace } from '../../types.js';

interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}

// Shared constants for the mock auth server
const AUTH_CONSTANTS = {
  FIXED_AUTH_CODE: 'test_auth_code_123',
  FIXED_ACCESS_TOKEN: 'test_access_token_abc',
  FIXED_REFRESH_TOKEN: 'test_refresh_token_xyz',
  TOKEN_EXPIRY: 3600, // 1 hour
  CLIENT_ID: 'test_client_id',
  CLIENT_SECRET: 'test_client_secret',
} as const;

export class MockAuthServer implements HttpTraceCollector {
  private app: express.Application;
  private server: Server | null = null;
  private port: number;
  public httpTrace: HttpTrace[] = [];
  private verbose: boolean;
  public issuerPath: string;
  public authResourceParameter: string | null = null;
  public tokenResourceParameter: string | null = null;


  // Store authorization requests for PKCE validation
  private authorizationRequests: Map<string, AuthorizationRequest> = new Map();

  constructor(port: number = 0, verbose: boolean = false, public metadataLocation: string = '/.well-known/oauth-authorization-server') {
    this.port = port;
    this.verbose = verbose;
    this.app = express();
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Extract issuer path from metadata location
    // For /.well-known/oauth-authorization-server/tenant1 -> /tenant1
    // For /.well-known/openid-configuration -> ''
    // For /tenant1/.well-known/openid-configuration -> /tenant1
    this.issuerPath = this.extractIssuerPath(metadataLocation);

    this.setupRoutes();
  }

  private extractIssuerPath(metadataLocation: string): string {
    // Handle different metadata location patterns
    if (metadataLocation.includes('/.well-known/oauth-authorization-server/')) {
      // OAuth 2.0 with path: /.well-known/oauth-authorization-server/tenant1 -> /tenant1
      return metadataLocation.replace('/.well-known/oauth-authorization-server', '');
    } else if (metadataLocation.includes('/.well-known/openid-configuration/')) {
      // OpenID with path: /.well-known/openid-configuration/tenant1 -> /tenant1
      return metadataLocation.replace('/.well-known/openid-configuration', '');
    } else if (metadataLocation.endsWith('/.well-known/openid-configuration')) {
      // Check if there's a path before /.well-known
      const match = metadataLocation.match(/^(\/[^\/]+)\/.well-known\/openid-configuration$/);
      if (match) {
        // /tenant1/.well-known/openid-configuration -> /tenant1
        return match[1];
      }
    }
    // Standard locations without path component
    return '';
  }

  private log(...args: any[]): void {
    if (this.verbose) {
      console.log('[AUTH SERVER]', ...args);
    }
  }

  private setupRoutes(): void {
    // Capture all HTTP requests and responses
    this.app.use(createHttpTraceMiddleware(this));

    // OAuth Authorization Server Metadata endpoint
    this.app.get(this.metadataLocation, (req: Request, res: Response) => {
      const baseUrl = this.getUrl();
      const issuer = baseUrl + this.issuerPath;

      // Base metadata for both OAuth 2.0 and OIDC
      const metadata: any = {
        issuer: issuer,
        authorization_endpoint: `${baseUrl}/authorize`,
        token_endpoint: `${baseUrl}/token`,
        registration_endpoint: `${baseUrl}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post']
      };

      // Add OIDC-specific fields if this is an OpenID Connect metadata endpoint
      if (this.metadataLocation.includes('openid-configuration')) {
        metadata.jwks_uri = `${baseUrl}/jwks`;
        metadata.subject_types_supported = ['public'];
        metadata.id_token_signing_alg_values_supported = ['RS256'];
        metadata.userinfo_endpoint = `${baseUrl}/userinfo`;
        metadata.scopes_supported = ['openid', 'profile', 'email'];
        metadata.claims_supported = ['sub', 'name', 'email', 'email_verified'];
      }

      res.json(metadata);
    });

    // OAuth2 authorization endpoint
    this.app.get('/authorize', (req: Request, res: Response) => {
      const {
        response_type,
        client_id,
        redirect_uri,
        state,
        code_challenge,
        code_challenge_method,
        resource,
      } = req.query as any;

      // Track resource parameter
      if (resource) {
        this.authResourceParameter = resource;
      }

      // Basic validation
      if (response_type !== 'code') {
        return res.status(400).json({
          error: 'unsupported_response_type',
          error_description: 'Only code response type is supported'
        });
      }

      if (!code_challenge || code_challenge_method !== 'S256') {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'PKCE is required with S256 method'
        });
      }

      // Store the request for later PKCE validation
      this.authorizationRequests.set(AUTH_CONSTANTS.FIXED_AUTH_CODE, {
        clientId: client_id,
        redirectUri: redirect_uri,
        state: state || '',
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method
      });

      // Immediately redirect back with authorization code (no user interaction)
      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set('code', AUTH_CONSTANTS.FIXED_AUTH_CODE);
      if (state) {
        redirectUrl.searchParams.set('state', state);
      }

      res.redirect(redirectUrl.toString());
    });

    // OAuth2 token endpoint
    this.app.post('/token', (req: Request, res: Response) => {
      const {
        grant_type,
        code,
        redirect_uri,
        code_verifier,
        client_id,
        client_secret,
        refresh_token,
        resource
      } = req.body;

      // Track resource parameter in token request
      if (resource) {
        this.tokenResourceParameter = resource;
      }

      if (grant_type === 'authorization_code') {
        // Validate authorization code
        if (code !== AUTH_CONSTANTS.FIXED_AUTH_CODE) {
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Invalid authorization code'
          });
        }

        // Get the stored authorization request
        const authRequest = this.authorizationRequests.get(code);
        if (!authRequest) {
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Authorization code not found or expired'
          });
        }

        // Validate redirect URI matches
        if (redirect_uri !== authRequest.redirectUri) {
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Redirect URI mismatch'
          });
        }

        // Validate PKCE code verifier
        if (!this.validatePKCE(code_verifier, authRequest.codeChallenge)) {
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Invalid PKCE code verifier'
          });
        }

        // Clean up used authorization code
        this.authorizationRequests.delete(code);

        // Return tokens
        res.json({
          access_token: AUTH_CONSTANTS.FIXED_ACCESS_TOKEN,
          token_type: 'Bearer',
          expires_in: AUTH_CONSTANTS.TOKEN_EXPIRY,
          refresh_token: AUTH_CONSTANTS.FIXED_REFRESH_TOKEN,
          scope: 'mcp'
        });

      } else if (grant_type === 'refresh_token') {
        // Simple refresh token validation
        if (refresh_token !== AUTH_CONSTANTS.FIXED_REFRESH_TOKEN) {
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Invalid refresh token'
          });
        }

        // Return new access token (same static value for simplicity)
        res.json({
          access_token: AUTH_CONSTANTS.FIXED_ACCESS_TOKEN,
          token_type: 'Bearer',
          expires_in: AUTH_CONSTANTS.TOKEN_EXPIRY,
          refresh_token: AUTH_CONSTANTS.FIXED_REFRESH_TOKEN,
          scope: 'mcp'
        });

      } else {
        res.status(400).json({
          error: 'unsupported_grant_type',
          error_description: 'Grant type not supported'
        });
      }
    });

    // Client registration endpoint (returns static client info)
    this.app.post('/register', (req: Request, res: Response) => {
      const { client_name, redirect_uris } = req.body;

      // Return a static client configuration
      res.status(201).json({
        client_id: AUTH_CONSTANTS.CLIENT_ID,
        client_name: client_name || 'Test Client',
        redirect_uris: redirect_uris || [],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post'
      });
    });

    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'ok', server: 'mock-auth-server' });
    });
  }

  private validatePKCE(codeVerifier: string, codeChallenge: string): boolean {
    if (!codeVerifier || !codeChallenge) {
      return false;
    }

    // Compute S256 challenge from verifier
    const hash = crypto.createHash('sha256');
    hash.update(codeVerifier);
    const computedChallenge = hash.digest('base64url');

    return computedChallenge === codeChallenge;
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        const actualPort = this.getPort();
        this.log(`Started on port ${actualPort}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.log('Stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getUrl(): string {
    return `http://localhost:${this.getPort()}`;
  }

  getPort(): number {
    if (!this.server) {
      throw new Error('Server not started');
    }
    const address = this.server.address();
    if (typeof address === 'object' && address !== null) {
      return address.port;
    }
    throw new Error('Unable to get server port');
  }

  getHttpTrace(): HttpTrace[] {
    return this.httpTrace;
  }
}

/**
 * Token verifier implementation for the mock auth server.
 * Validates the fixed access token and returns AuthInfo.
 */
export class MockTokenVerifier implements OAuthTokenVerifier {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (token !== AUTH_CONSTANTS.FIXED_ACCESS_TOKEN) {
      throw new Error('Invalid access token');
    }

    // Return AuthInfo for the valid token
    return {
      token: token,
      clientId: AUTH_CONSTANTS.CLIENT_ID,
      scopes: ['mcp'],
      expiresAt: Math.floor(Date.now() / 1000) + AUTH_CONSTANTS.TOKEN_EXPIRY,
      extra: {
        source: 'mock-auth-server'
      }
    };
  }
}
