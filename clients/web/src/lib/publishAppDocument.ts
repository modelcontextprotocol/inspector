/**
 * Publish a wrapped MCP App document to the backend's dedicated app-origin
 * listener and get back the URL to load it from (#2056).
 *
 * This is `lib`, not `utils`: it does network I/O against the authenticated
 * `/api/*` surface.
 *
 * ## Why the browser hands the bytes back
 *
 * The app's HTML arrives over the MCP connection, which only the browser
 * holds — the backend has no client of its own to read the `ui://` resource
 * with. So the one way an app can be served from a real HTTP origin is for the
 * browser to POST the document it already wrapped. The backend stores it under
 * an unguessable id and serves it from a separate listener on its own port,
 * which is what makes the app's origin real instead of opaque.
 *
 * Only apps whose UI resource declares `_meta.ui.domain` take this path; every
 * other app keeps the default `srcdoc` render under an opaque origin.
 */

/** Backend response shape for a successful publish. */
interface PublishResponse {
  url?: unknown;
}

export interface PublishAppDocumentOptions {
  /** Base URL of the backend (typically `window.location.origin`). */
  baseUrl: string;
  /** Optional auth token for the `x-mcp-remote-auth` header. */
  authToken?: string;
  /** Fetch function to use (default: `globalThis.fetch`). Useful in tests. */
  fetchFn?: typeof fetch;
}

/**
 * POST the document and return the absolute URL it is served from, or `null`
 * when the backend cannot host it.
 *
 * Never throws. Every failure — an old backend with no route, a backend with no
 * app-origin listener (503), a network error, a malformed body — is a `null`,
 * because the caller's response to all of them is the same: render the app the
 * default way. Losing the dedicated origin degrades what the app can reach; it
 * must not cost the user the app itself.
 */
export async function publishAppDocument(
  doc: { html: string; csp?: string },
  opts: PublishAppDocumentOptions,
): Promise<string | null> {
  const doFetch = opts.fetchFn ?? globalThis.fetch;
  const base = opts.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.authToken) headers["x-mcp-remote-auth"] = `Bearer ${opts.authToken}`;
  try {
    const res = await doFetch(`${base}/api/app-document`, {
      method: "POST",
      headers,
      body: JSON.stringify(doc),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as PublishResponse;
    return typeof body.url === "string" && body.url ? body.url : null;
  } catch {
    return null;
  }
}
