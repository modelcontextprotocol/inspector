/**
 * Field identifiers for the per-server values held in the OS keychain.
 *
 * Pure constants — kept out of `core/auth/node/` so the converter in
 * `core/mcp/serverList.ts` (browser-safe) and the Node-only keychain
 * backend in `core/auth/node/secret-store.ts` agree on the spelling
 * without dragging the native binding import into browser code.
 */

/** Field name for an entry's OAuth client secret. */
export const SECRET_FIELD_OAUTH_CLIENT_SECRET = "oauth-client-secret";

/** Field name for one stdio env-variable value. */
export const envSecretField = (envKey: string): string => `env:${envKey}`;
