/**
 * Thin wrapper over the `@modelcontextprotocol/client` v2 OAuth orchestrator.
 *
 * SDK v2's `auth()` handles the full flow natively — including `forceReauthorization`
 * (skip refresh and start a fresh authorization request when a step-up scope union
 * cannot be widened by refresh, RFC 6749 §6), RFC 9207 `iss` validation, SEP-2352
 * issuer stamping/`ctx.issuer` keying, and SEP-837 `application_type` defaults. This
 * wrapper exists only to pin the option shape (`McpAuthOptions`) the Inspector passes
 * and to keep a single import site; it no longer reimplements any flow logic.
 */

import { auth as sdkAuth } from "@modelcontextprotocol/client";
import type { OAuthClientProvider } from "@modelcontextprotocol/client";
import type { FetchLike } from "@modelcontextprotocol/client";

export type McpAuthResult = "AUTHORIZED" | "REDIRECT";

/**
 * Options forwarded to SDK v2 `auth()`.
 */
export interface McpAuthOptions {
  serverUrl: string | URL;
  authorizationCode?: string;
  /** RFC 9207 callback `iss`, validated by the SDK against the metadata issuer. */
  iss?: string;
  scope?: string;
  resourceMetadataUrl?: URL;
  fetchFn?: FetchLike;
  /** SEP-2468 opt-out for the RFC 8414 §3.3 issuer-echo check (security-weakening). */
  skipIssuerMetadataValidation?: boolean;
  /**
   * Skip refresh and start an authorization-code flow. Required for step-up when
   * the union scope exceeds the current token grant (RFC 6749 §6).
   */
  forceReauthorization?: boolean;
}

export async function mcpAuth(
  provider: OAuthClientProvider,
  options: McpAuthOptions,
): Promise<McpAuthResult> {
  if (options.forceReauthorization && options.authorizationCode !== undefined) {
    throw new Error(
      "forceReauthorization cannot be combined with authorizationCode",
    );
  }

  return sdkAuth(provider, {
    serverUrl: options.serverUrl,
    authorizationCode: options.authorizationCode,
    iss: options.iss,
    scope: options.scope,
    resourceMetadataUrl: options.resourceMetadataUrl,
    fetchFn: options.fetchFn,
    skipIssuerMetadataValidation: options.skipIssuerMetadataValidation,
    forceReauthorization: options.forceReauthorization,
  });
}
