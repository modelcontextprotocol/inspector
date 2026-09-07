import { discoverOAuthProtectedResourceMetadata } from "@modelcontextprotocol/client";
import type { OAuthClientInformation } from "@modelcontextprotocol/client";
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

  // Walks the path-scoped authorization-server URL before the bare origin, so a
  // server hosted under a path is probed where it actually publishes its
  // metadata rather than only at the domain root (#2110).
  const metadata = await discoverAuthorizationServerMetadataForServer(
    params.serverUrl,
    resourceMetadata,
    params.fetchFn,
  );
  if (!metadata?.client_id_metadata_document_supported) return;

  // SEP-2352 keys a registration to the authorization server that issued it, so
  // the record this writes is bound to the issuer we just discovered rather than
  // to the server as a whole. That binding is what makes the provenance
  // trustworthy later: `BaseOAuthClientProvider.saveClientInformation` preserves
  // `cimd` only for an issuer this function recorded it for, having first
  // confirmed *that* AS advertises `client_id_metadata_document_supported`
  // (#2242, Copilot). A second AS behind the same resource therefore gets its own
  // determination — pre-registered here when it too supports CIMD, and left to
  // dynamic registration when it does not.
  //
  // ⚠️ This is why the "do we already have a client?" check below sits *after*
  // discovery rather than short-circuiting it, at the cost of a discovery round
  // trip on each connect attempt rather than only the first. Read ctx-less — as
  // it was — it resolves through the *active* issuer and so early-returns for
  // every subsequent issuer, leaving them with no CIMD record at all. It still
  // answers the static case first, since `clientInformation` checks the
  // preregistered slot before any issuer slot.
  const issuer = metadata.issuer;
  const existing = await params.provider.clientInformation(
    issuer ? { issuer } : undefined,
  );
  if (existing?.client_id) return;

  const clientInformation: OAuthClientInformation = {
    client_id: clientMetadataUrl,
  };
  await params.provider.saveClientInformation(clientInformation, {
    registrationKind: "cimd",
    // An AS metadata document without an `issuer` is malformed (RFC 8414 §2),
    // but the type allows it; fall back to the unkeyed slot rather than
    // inventing a key.
    ...(issuer && { issuer }),
  });
}
