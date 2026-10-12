import {
  AuthChallengeError,
  parseAuthChallengeFromResponse,
} from "../../auth/challenge.js";
import type { AuthChallenge } from "../../auth/challenge.js";

/**
 * Wrap fetch so MCP HTTP auth challenges — any 401, and a 403 carrying
 * `WWW-Authenticate` — become {@link AuthChallengeError} before the SDK invokes
 * `auth()` on a frozen remote token provider. A bare 403 is a denial, not a
 * challenge, and is returned as-is (#2515).
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
    // A 403 with no `WWW-Authenticate` is an ordinary denial, not a challenge
    // (#2515): hand it to the transport untouched so the MCP caller sees it.
    if (!challenge) {
      return response;
    }

    // Release the connection before throwing so the SDK transport is not left
    // with a half-read 401/403 body on streamable HTTP. Not awaited: when the
    // network tracker sits below this wrapper (#2297) the body is one branch of
    // a tee, and cancel() adopts the source's promise, which a stalled body may
    // never settle — so awaiting it could hang the throw.
    void response.body?.cancel().catch(() => {});

    throw new AuthChallengeError(
      challenge,
      response.status,
      `MCP auth challenge (${response.status})`,
    );
  };
}

/**
 * Wrap fetch so every MCP HTTP auth challenge (as classified by
 * `parseAuthChallengeFromResponse` — a bare 403 is not one, #2515) is
 * *reported* — control flow untouched, response returned as-is.
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
      // Undefined for a bare 403, which is a denial, not a challenge (#2515).
      if (challenge) {
        onChallenge(challenge);
      }
    }
    return response;
  };
}
