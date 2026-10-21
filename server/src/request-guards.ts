/**
 * Request guards for the proxy server: the auth-disable flag parser and the
 * Origin validation middleware (which also applies the same-origin
 * fetch-metadata check from fetch-metadata.ts).
 *
 * Extracted from index.ts so they can be unit-tested independently (index.ts
 * starts listening on import).
 */

import type express from "express";
import { isExplicitTruthyFlag } from "./env-flags.js";
import { shouldRejectSameOriginRequest } from "./fetch-metadata.js";

/**
 * Parses the value of `DANGEROUSLY_OMIT_AUTH`.
 *
 * Only an explicit truthy value (`true`, `1` or `yes`, case-insensitive,
 * surrounding whitespace ignored) disables authentication. Anything else —
 * unset, empty, `false`, `0`, or an unrecognized value — leaves auth enabled.
 *
 * `client/bin/start.js` carries an identical copy of this function so the
 * launcher and the proxy always agree on whether auth is disabled; keep the
 * two in sync.
 */
export function isAuthDisabledFlag(value: string | undefined): boolean {
  return isExplicitTruthyFlag(value);
}

/**
 * Returns the list of origins allowed to talk to the proxy: the
 * comma-separated `ALLOWED_ORIGINS` environment variable, or the client's
 * default origin (`http://localhost:${CLIENT_PORT}`, port 6274 by default).
 */
export function getAllowedOrigins(env: NodeJS.ProcessEnv = process.env) {
  const clientPort = env.CLIENT_PORT || "6274";
  const defaultOrigin = `http://localhost:${clientPort}`;
  return env.ALLOWED_ORIGINS?.split(",") || [defaultOrigin];
}

/**
 * Builds the Origin validation middleware.
 *
 * A request carrying an `Origin` header that is not in the allowed list is
 * always rejected with 403.
 *
 * A request with no `Origin` header is handled according to `authDisabled`:
 * - auth enabled: it passes this check. Non-browser clients legitimately send
 *   no `Origin`, and the session token checked by the auth middleware is what
 *   protects them.
 * - auth disabled: it is rejected with the same 403. With no token to check,
 *   the `Origin` header is the only thing tying a request to the Inspector web
 *   client, whose requests to the proxy are cross-origin and always carry one.
 *
 * Before either of those, a same-origin browser request
 * (`Sec-Fetch-Site: same-origin`) is rejected with 403 unless
 * `allowSameOriginApi` is true (`DANGEROUSLY_ALLOW_SAME_ORIGIN_API`). Such a
 * request carries no `Origin` header, so the allow-list cannot see it; see
 * fetch-metadata.ts.
 */
export function createOriginValidationMiddleware(
  authDisabled: boolean,
  allowSameOriginApi = false,
) {
  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    // A same-origin request carries no Origin header, so the allow-list below
    // cannot see it. The client never shares the proxy's origin; only documents
    // the proxy serves itself (the MCP Apps sandbox) do. See fetch-metadata.ts.
    if (shouldRejectSameOriginRequest(req.headers, allowSameOriginApi)) {
      console.error("Rejected same-origin request to an API route");
      res.status(403).json({
        error: "Forbidden - same-origin request",
        message:
          "API routes cannot be called from documents served by the proxy.",
      });
      return;
    }

    const origin = req.headers.origin;
    const allowedOrigins = getAllowedOrigins();

    const rejected = origin ? !allowedOrigins.includes(origin) : authDisabled;

    if (rejected) {
      console.error(
        origin
          ? `Invalid origin: ${origin}`
          : "Missing origin (required when authentication is disabled)",
      );
      res.status(403).json({
        error: "Forbidden - invalid origin",
        message:
          "Request blocked to prevent DNS rebinding attacks. Configure allowed origins via environment variable.",
      });
      return;
    }
    next();
  };
}
