import { discoverOAuthProtectedResourceMetadata } from "@modelcontextprotocol/client";
import { discoverAuthorizationServerMetadataForServer } from "./discovery.js";
import type { BaseOAuthClientProvider } from "./providers.js";

/**
 * When the authorization server supports URL-based client IDs (SEP-991 / CIMD),
 * pre-register `{ client_id: clientMetadataUrl }` before SDK `auth()`.
 *
 * SDK `auth()` rejects non-HTTPS `clientMetadataUrl` during registration, but
 * accepts an already-stored `client_id` (including `http://` URLs used by local
 * dev/test metadata servers). Production CIMD metadata documents should still
 * use HTTPS per SEP-991.
 *
 * `resourceMetadataUrl` is the RFC 9728 document advertised by the
 * `WWW-Authenticate` challenge, when the caller has one. It matters here and
 * not only in `auth()`: this runs *before* SDK `auth()`, so without it the
 * pre-registration probe would do its own default-location discovery and miss
 * a document served from a non-default path (#2071).
 */
export async function ensureCimdClientRegistration(params: {
  serverUrl: string;
  provider: BaseOAuthClientProvider;
  fetchFn?: typeof fetch;
  resourceMetadataUrl?: URL;
}): Promise<void> {
  const clientMetadataUrl = params.provider.clientMetadataUrl?.trim();
  if (!clientMetadataUrl) return;

  // Prefer the discovery state SDK `auth()` itself persists and reuses. Without
  // this, moving the existing-client check after discovery would turn a
  // temporary well-known outage into a failed reconnect, even where the SDK
  // could have proceeded from cache (Copilot).
  let metadata = (await params.provider.discoveryState())
    ?.authorizationServerMetadata;

  if (!metadata) {
    let resourceMetadata;
    try {
      resourceMetadata = await discoverOAuthProtectedResourceMetadata(
        params.serverUrl,
        { resourceMetadataUrl: params.resourceMetadataUrl },
        // The same fetch the AS-metadata leg below uses. On web that is
        // `createRemoteFetch`, which proxies through the backend to sidestep
        // CORS — on the global `fetch` this leg would fail in the browser, be
        // swallowed by the catch, and leave CIMD probing the wrong
        // authorization server (Copilot).
        params.fetchFn,
      );
    } catch {
      resourceMetadata = undefined;
    }

    try {
      // Walks the path-scoped authorization-server URL before the bare origin, so
      // a server hosted under a path is probed where it actually publishes its
      // metadata rather than only at the domain root (#2110).
      metadata = await discoverAuthorizationServerMetadataForServer(
        params.serverUrl,
        resourceMetadata,
        params.fetchFn,
      );
    } catch {
      // Pre-registration is an optimization over what SDK `auth()` does for
      // itself, so a discovery failure here must never fail the connection: bail
      // out and let `auth()` run its own discovery and error handling.
      return;
    }
  }

  const issuer = metadata?.issuer;
  if (!metadata?.client_id_metadata_document_supported) return;

  // ⚠️ Keyed by the issuer just resolved, not read ctx-less. A ctx-less read
  // resolves through the *active* issuer, so it early-returns for every
  // subsequent issuer and leaves them with no CIMD registration at all. It
  // answers the static case first, since `clientInformation` checks the
  // preregistered slot before any issuer slot — and a static client, like any
  // existing registration, means there is nothing to pre-register.
  const existing = await params.provider.clientInformation(
    issuer ? { issuer } : undefined,
  );
  if (existing?.client_id) return;

  await params.provider.saveClientInformation(
    { client_id: clientMetadataUrl },
    {
      registrationKind: "cimd",
      // An AS metadata document without an `issuer` is malformed (RFC 8414 §2),
      // but the type allows it; fall back to the unkeyed slot rather than
      // inventing a key.
      ...(issuer && { issuer }),
    },
  );
}
