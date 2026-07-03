import {
  AuthChallengeError,
  parseAuthChallengeFromResponse,
} from "../../auth/challenge.js";

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