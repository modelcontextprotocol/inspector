import {
  AuthChallengeError,
  parseAuthChallengeFromResponse,
} from "../../auth/challenge.js";
import type { AuthChallenge } from "../../auth/challenge.js";

/**
 * Wrap fetch so MCP HTTP 401/403 responses become {@link AuthChallengeError}
 * before the SDK invokes `auth()` on a frozen remote token provider.
 */
export function createAuthChallengeInterceptFetch(
  baseFetch: typeof fetch,
): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (response.status !== 401 && response.status !== 403) {
      return response;
    }

    const challenge = parseAuthChallengeFromResponse(response);
    /* v8 ignore next 3 -- parseAuthChallengeFromResponse only returns undefined for non-401/403, which the status guard above already excludes */
    if (!challenge) {
      return response;
    }

    // Release the connection before throwing so the SDK transport is not left
    // with a half-read 401/403 body on streamable HTTP.
    await response.body?.cancel().catch(() => {});

    throw new AuthChallengeError(
      challenge,
      response.status,
      `MCP auth challenge (${response.status})`,
    );
  };
}

/**
 * Wrap fetch so every MCP HTTP 401/403 is *reported* — control flow untouched,
 * response returned as-is.
 *
 * This is the passive sibling of {@link createAuthChallengeInterceptFetch},
 * and it exists for the one case that one cannot cover: a first-time
 * authorization in the default legacy era. There, `InspectorClient`
 * deliberately builds the transport with no `authProvider` (so the SDK does
 * not open a browser before the callback server is listening) and therefore
 * leaves interception off, so the CLI/TUI runner catches a plain
 * `UnauthorizedError` and calls `authenticate()` itself. That SDK error
 * carries no headers, so the challenge's RFC 9728 `resource_metadata` would be
 * lost before discovery ever starts (#2071) — the observer keeps it.
 *
 * Only the status line and headers are read; the body is left untouched for
 * the transport (or the interceptor layered above this one) to consume.
 */
export function createAuthChallengeObserverFetch(
  baseFetch: typeof fetch,
  onChallenge: (challenge: AuthChallenge) => void,
): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (response.status === 401 || response.status === 403) {
      const challenge = parseAuthChallengeFromResponse(response);
      /* v8 ignore next 3 -- parseAuthChallengeFromResponse only returns undefined for non-401/403, which the status guard above already excludes */
      if (challenge) {
        onChallenge(challenge);
      }
    }
    return response;
  };
}
