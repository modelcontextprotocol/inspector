/**
 * Embed the remote API auth token into the served `index.html` so the browser
 * doesn't depend on the `?MCP_INSPECTOR_API_TOKEN=…` query string surviving
 * navigation, bookmarks, or a hand-typed reload at the bare URL. The dev Vite
 * plugin (`vite-hono-plugin.ts`) and the prod Hono server (`server.ts`) both
 * funnel through this single helper so the injected shape stays identical
 * across both backends. `App.tsx`'s `getAuthToken()` reads the embedded global
 * ahead of the URL / sessionStorage fallbacks.
 */

import { INSPECTOR_API_TOKEN_GLOBAL } from "../../../core/mcp/remote/constants.ts";

/**
 * Serialize the token as a JS string literal safe to drop inside an inline
 * `<script>`. `JSON.stringify` handles quotes / backslashes / control chars;
 * the extra `<` → `<` escape closes the one hole that matters in an HTML
 * context — a token containing the literal `</script>` would otherwise close
 * the tag early. The token is normally a hex string, but it can be a
 * user-supplied value (`MCP_INSPECTOR_API_TOKEN` env / `--auth-token`), so we
 * don't assume it's benign.
 */
function serializeTokenForScript(token: string): string {
  return JSON.stringify(token).replace(/</g, "\\u003c");
}

/**
 * Return `html` with a `<script>window.__INSPECTOR_API_TOKEN__ = "…"</script>`
 * tag injected. The script is placed just before `</head>` when present, else
 * just before `</body>`, else prepended — in every case it runs before the app
 * bundle (which lives further down the document) so the global is set by the
 * time `getAuthToken()` reads it.
 *
 * An empty `token` (auth disabled via `DANGEROUSLY_OMIT_AUTH`) is a no-op: the
 * page is returned untouched and no global is defined, matching the banner's
 * "no token in the URL" behavior.
 */
export function injectAuthToken(html: string, token: string): string {
  if (!token) return html;
  const script = `<script>window.${INSPECTOR_API_TOKEN_GLOBAL} = ${serializeTokenForScript(
    token,
  )};</script>`;
  const headClose = html.indexOf("</head>");
  if (headClose !== -1) {
    return html.slice(0, headClose) + script + html.slice(headClose);
  }
  const bodyClose = html.indexOf("</body>");
  if (bodyClose !== -1) {
    return html.slice(0, bodyClose) + script + html.slice(bodyClose);
  }
  return script + html;
}
