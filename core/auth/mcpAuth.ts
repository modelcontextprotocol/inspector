/**
 * Thin wrapper over the `@modelcontextprotocol/client` v2 OAuth orchestrator.
 *
 * SDK v2's `auth()` handles the full flow natively — including `forceReauthorization`
 * (skip refresh and start a fresh authorization request when a step-up scope union
 * cannot be widened by refresh, RFC 6749 §6), RFC 9207 `iss` validation, SEP-2352
 * issuer stamping/`ctx.issuer` keying, and SEP-837 `application_type` defaults. This
 * wrapper exists only to pin the option shape (`McpAuthOptions`) the Inspector passes
 * and to keep a single import site; it no longer reimplements any flow logic.
 * The one thing it adds is a hint on the RFC 8414 §3.3 metadata issuer
 * mismatch, naming the per-server setting that relaxes the check (#2983).
 */

import {
  auth as sdkAuth,
  IssuerMismatchError,
} from "@modelcontextprotocol/client";
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
  /**
   * SEP-2468 opt-out for the RFC 8414 §3.3 issuer-echo check
   * (security-weakening). Set from the per-server
   * `oauth.skipIssuerMetadataValidation` setting only (#2983).
   */
  skipIssuerMetadataValidation?: boolean;
  /**
   * Skip refresh and start an authorization-code flow. Required for step-up when
   * the union scope exceeds the current token grant (RFC 6749 §6).
   */
  forceReauthorization?: boolean;
}

/**
 * Appended to the SDK's RFC 8414 §3.3 metadata issuer mismatch, which
 * otherwise names the two issuers and no way forward (#2983). It points at the
 * per-server setting and says what turning it on costs, so the hint cannot be
 * read as a routine fix.
 */
export const ISSUER_METADATA_MISMATCH_HINT =
  "If you trust this authorization server and it is known to publish a " +
  "non-matching issuer (Microsoft Entra ID's multi-tenant endpoints do), turn " +
  'on "Skip issuer metadata validation" in this server\'s settings ' +
  "(`oauth.skipIssuerMetadataValidation` in mcp.json). That weakens a " +
  "security check, so leave it off for any other authorization server.";

/**
 * True for the SDK's `IssuerMismatchError` raised by the **metadata** check.
 * The same class also reports an RFC 9207 authorization-response mismatch
 * (`kind: "authorization_response"`), which the setting does not affect and
 * which must not be answered with a hint to relax anything.
 *
 * `isInstance` is the SDK's cross-copy-safe brand check; the `name` comparison
 * covers an error that crossed a serialization boundary, as `issuerBinding.ts`
 * does for its own class.
 */
function isMetadataIssuerMismatch(err: unknown): err is Error {
  if (!(err instanceof Error)) return false;
  if (
    !IssuerMismatchError.isInstance(err) &&
    err.name !== "IssuerMismatchError"
  ) {
    return false;
  }
  return (err as { kind?: unknown }).kind === "metadata";
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

  try {
    return await sdkAuth(provider, {
      serverUrl: options.serverUrl,
      authorizationCode: options.authorizationCode,
      iss: options.iss,
      scope: options.scope,
      resourceMetadataUrl: options.resourceMetadataUrl,
      fetchFn: options.fetchFn,
      skipIssuerMetadataValidation: options.skipIssuerMetadataValidation,
      forceReauthorization: options.forceReauthorization,
    });
  } catch (err) {
    if (isMetadataIssuerMismatch(err)) {
      // The original stays reachable as `cause`, so anything walking the chain
      // for the SDK's error still finds it.
      throw new Error(`${err.message}. ${ISSUER_METADATA_MISMATCH_HINT}`, {
        cause: err,
      });
    }
    throw err;
  }
}
