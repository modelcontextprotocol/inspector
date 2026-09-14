import type { RedirectUrlProvider } from "@inspector/core/auth/index.js";
import { toRecord } from "@inspector/core/json/jsonUtils.js";
import {
  API_SERVER_ENV_VARS,
  INSPECTOR_API_TOKEN_GLOBAL,
} from "@inspector/core/mcp/remote/constants.js";
import { OAUTH_CALLBACK_PATH } from "../utils/oauthFlow";

// OAuth redirect URL provider — points at the dev backend's `/oauth/callback`
// handler. The InspectorClient only consults this when the active server
// requires OAuth; for stdio MCP servers it's never used. Created once and
// reused so `BrowserOAuthClientProvider` doesn't re-instantiate per render.
export const redirectUrlProvider: RedirectUrlProvider = {
  getRedirectUrl: () => `${window.location.origin}${OAUTH_CALLBACK_PATH}`,
};

// Recover the backend's auth token. Every browser request to /api/* needs it
// in the `x-mcp-remote-auth: Bearer …` header or the Hono backend returns 401.
// Three sources, in priority order:
//   1. `window.__INSPECTOR_API_TOKEN__` — injected into index.html by the
//      backend on every page load (dev Vite plugin + prod Hono server). This
//      is the robust path: it survives a bare-URL reload, a bookmark, or a
//      cleared sessionStorage, none of which carry the query string.
//   2. `?MCP_INSPECTOR_API_TOKEN=…` — the URL the launcher banner prints. Kept
//      as a fallback for pasted full URLs and older integrations.
//   3. sessionStorage — backstop for SPA navigations / OAuth round-trips that
//      land without either of the above.
// Both the injected global and the URL value are persisted to sessionStorage
// so a later navigation that drops them (e.g. a deep-link load that wasn't
// injected, or an iframe) still authenticates from the backstop.
export function getAuthToken(): string | undefined {
  /* v8 ignore next -- happy-dom always defines `window`; this is the SSR/no-DOM guard */
  if (typeof window === "undefined") return undefined;
  const STORAGE_KEY = API_SERVER_ENV_VARS.AUTH_TOKEN;
  // Best-effort persistence — sessionStorage may be unavailable (privacy
  // mode, iframe sandboxing, etc.); the resolved value still works for the
  // current page load regardless.
  const persist = (token: string): void => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, token);
    } catch {
      // ignore — see note above
    }
  };
  const fromGlobal = toRecord(window)[INSPECTOR_API_TOKEN_GLOBAL];
  if (typeof fromGlobal === "string" && fromGlobal) {
    persist(fromGlobal);
    return fromGlobal;
  }
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get(API_SERVER_ENV_VARS.AUTH_TOKEN);
  if (fromUrl) {
    persist(fromUrl);
    return fromUrl;
  }
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
