/**
 * JWT access-token validation for test MCP servers using an external authorization server.
 */

import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { discoverAuthorizationServerMetadata } from "@modelcontextprotocol/client";
import type { ServerConfig } from "./composable-test-server.js";

type ExternalValidatorOAuthConfig = Pick<
  NonNullable<ServerConfig["oauth"]>,
  "authorizationServers" | "accessTokenIssuers" | "jwksUri" | "resourceAudience"
>;

function normalizeIssuer(issuer: string): string {
  return issuer.replace(/\/$/, "");
}

function audienceMatches(aud: unknown, expected: string): boolean {
  const normalized = expected.replace(/\/$/, "");
  if (typeof aud === "string") {
    return normalizeIssuer(aud) === normalized;
  }
  if (Array.isArray(aud)) {
    return aud.some(
      (a) => typeof a === "string" && normalizeIssuer(a) === normalized,
    );
  }
  return false;
}

function parseScopeString(scope: string | undefined): string[] {
  if (!scope?.trim()) {
    return [];
  }
  return scope.trim().split(/\s+/).filter(Boolean);
}

/** Extract granted OAuth scopes from a verified JWT access token payload. */
export function extractScopesFromJwtPayload(
  payload: Record<string, unknown>,
): string[] {
  if (typeof payload.scope === "string") {
    return parseScopeString(payload.scope);
  }
  if (Array.isArray(payload.scp)) {
    return payload.scp.filter((s): s is string => typeof s === "string");
  }
  if (Array.isArray(payload.scopes)) {
    return payload.scopes.filter((s): s is string => typeof s === "string");
  }
  return [];
}

export interface ValidatedAccessToken {
  valid: boolean;
  scopes: string[];
}

export class ExternalAccessTokenValidator {
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  private allowedIssuers = new Set<string>();
  private initPromise: Promise<void> | null = null;
  private readonly config: ExternalValidatorOAuthConfig;
  private readonly fetchFn: typeof fetch;

  constructor(
    config: ExternalValidatorOAuthConfig,
    fetchFn: typeof fetch = fetch,
  ) {
    this.config = config;
    this.fetchFn = fetchFn;
  }

  private async ensureReady(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.init();
    }
    await this.initPromise;
  }

  private async init(): Promise<void> {
    const configuredIssuers =
      this.config.accessTokenIssuers ?? this.config.authorizationServers ?? [];
    if (configuredIssuers.length === 0) {
      throw new Error(
        "External access token validation requires authorizationServers or accessTokenIssuers",
      );
    }

    for (const issuer of configuredIssuers) {
      this.allowedIssuers.add(normalizeIssuer(issuer));
    }

    let jwksUri = this.config.jwksUri;
    const primaryAs = this.config.authorizationServers?.[0];
    if (!jwksUri && primaryAs) {
      const metadata = await discoverAuthorizationServerMetadata(
        new URL(primaryAs),
        { fetchFn: this.fetchFn },
      );
      if (metadata?.issuer) {
        this.allowedIssuers.add(normalizeIssuer(metadata.issuer));
      }
      const discoveredJwks = metadata?.jwks_uri;
      if (typeof discoveredJwks === "string") {
        jwksUri = discoveredJwks;
      }
    }

    if (!jwksUri) {
      throw new Error(
        "Could not resolve jwks_uri for external authorization server (set oauth.jwksUri in config)",
      );
    }

    this.jwks = createRemoteJWKSet(new URL(jwksUri), {
      [customFetch]: this.fetchFn,
    });
  }

  async validateAccessTokenWithScopes(
    token: string,
  ): Promise<ValidatedAccessToken> {
    if (!this.jwks) {
      await this.ensureReady();
    }
    if (!this.jwks) {
      return { valid: false, scopes: [] };
    }

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: [...this.allowedIssuers],
      });

      if (this.config.resourceAudience) {
        const aud = payload.aud;
        if (!audienceMatches(aud, this.config.resourceAudience)) {
          return { valid: false, scopes: [] };
        }
      }

      return {
        valid: true,
        scopes: extractScopesFromJwtPayload(payload as Record<string, unknown>),
      };
    } catch {
      return { valid: false, scopes: [] };
    }
  }

  async validateAccessToken(token: string): Promise<boolean> {
    return (await this.validateAccessTokenWithScopes(token)).valid;
  }
}
