/**
 * Splits acquired OAuth secrets out of the persisted `oauth.json` shape and
 * into the {@link SecretStore} (Step 2 of the token-storage plan): tokens,
 * DCR/legacy client secrets, and IdP session tokens live in the secret store;
 * `oauth.json` keeps only non-secret state/cache (verifiers, metadata, scope,
 * issuer keys, public client ids). Pure split/join/field-enumeration helpers
 * — the orchestration (locked read-modify-write, migration, store IO) lives
 * in `oauth-persist-file.ts`.
 *
 * Also owns `MCP_INSPECTOR_PERSIST_TOKENS=all|access|none`, the strip filter
 * for acquired tokens at the same boundary: `access` persists access tokens
 * but strips refresh tokens; `none` persists no acquired tokens at all
 * (token lifetime = process lifetime). Applied on the write side only —
 * already-persisted tokens still load, and the next save under the stricter
 * policy deletes them (an absent field is a deletion).
 *
 * Node-only by placement: the secret store is Node-only, and the split runs
 * where the file lives (Node backends and the remote server's storage
 * route); the browser round-trips full snapshots over the authed local API.
 */

import type { OAuthTokens } from "@modelcontextprotocol/client";
import { setOwnEntry } from "../../storage/own-entry.js";
import type { OAuthPersistSnapshot } from "../oauth-persist.js";
import type { IdpSessionState } from "../storage.js";
import type { IssuerBoundOAuthState, ServerOAuthState } from "../store.js";

/** `MCP_INSPECTOR_PERSIST_TOKENS` values — see the header for semantics. */
export type PersistTokensPolicy = "all" | "access" | "none";

export const PERSIST_TOKENS_ENV = "MCP_INSPECTOR_PERSIST_TOKENS";

const warnedPolicyValues = new Set<string>();

/**
 * Read the persist-tokens policy from the environment. An unset variable is
 * `all` (today's behavior). An *invalid* value is also `all`, with a
 * once-per-value warning: silently treating a typo as `none` would break
 * persistence the user did not ask to lose, while `all` is the documented
 * default the variable's absence already means.
 */
export function getPersistTokensPolicy(
  env: NodeJS.ProcessEnv = process.env,
): PersistTokensPolicy {
  const raw = env[PERSIST_TOKENS_ENV];
  if (raw === undefined || raw === "") return "all";
  if (raw === "all" || raw === "access" || raw === "none") return raw;
  if (!warnedPolicyValues.has(raw)) {
    warnedPolicyValues.add(raw);
    console.warn(
      `[mcp-inspector] Ignoring invalid ${PERSIST_TOKENS_ENV}=${JSON.stringify(raw)} (expected "all", "access", or "none"); persisting all tokens.`,
    );
  }
  return "all";
}

/** Test seam: forget which invalid policy values have been warned about. */
export function resetPersistTokensPolicyWarnings(): void {
  warnedPolicyValues.clear();
}

/**
 * SecretStore ids are namespaced so OAuth state cannot collide with catalog
 * server entries (whose ids are user-chosen names) or the client.json id.
 *
 * The URL/issuer is percent-encoded because the id **must not contain a
 * colon**: store accounts are `serverId:field`, and the keyring store's
 * `deleteAllForServer` parses an account at the *first* colon and requires
 * the parsed id to equal the requested one — an id like `oauth:https://…`
 * would parse as `oauth` and never match, so purges would silently leave
 * tokens in the OS keychain. A raw URL would also make one server's id a
 * prefix of another's (`https://a` vs `https://a:8080`), letting
 * prefix-matching stores delete the wrong server's secrets. Encoding turns
 * `:` and `/` into `%3A`/`%2F`, which no other id can collide with.
 */
export const oauthSecretServerId = (serverUrl: string): string =>
  `oauth+${encodeURIComponent(serverUrl)}`;
export const oauthIdpSecretServerId = (issuer: string): string =>
  `oauth-idp+${encodeURIComponent(issuer)}`;

/** Field for one issuer's acquired tokens (JSON-serialized `OAuthTokens`). */
export const issuerTokensField = (issuer: string): string => `tokens:${issuer}`;
/** Field for one issuer's DCR `client_secret`. */
export const issuerClientSecretField = (issuer: string): string =>
  `client-secret:${issuer}`;
/** Legacy unkeyed fallback slots (pre-1625 snapshots) — no issuer suffix. */
export const LEGACY_TOKENS_FIELD = "tokens";
export const LEGACY_CLIENT_SECRET_FIELD = "client-secret";
/** `client_secret` of a statically preregistered client. */
export const PREREG_CLIENT_SECRET_FIELD = "prereg-client-secret";
/** One IdP issuer's session tokens (JSON `{ idToken?, refreshToken? }`). */
export const IDP_SESSION_FIELD = "idp-session";

/** Secret values extracted from one entry, keyed by store field. */
export type OAuthSecretValues = Record<string, string>;

export interface SplitResult<T> {
  /** What remains for `oauth.json` — never carries a secret value. */
  residue: T;
  /** What goes to the secret store, post-policy. */
  secrets: OAuthSecretValues;
}

function applyTokensPolicy(
  tokens: OAuthTokens,
  policy: PersistTokensPolicy,
): OAuthTokens | undefined {
  if (policy === "none") return undefined;
  if (policy === "access" && tokens.refresh_token !== undefined) {
    const { refresh_token: _stripped, ...rest } = tokens;
    return rest as OAuthTokens;
  }
  return tokens;
}

/**
 * Split one server's OAuth state into its non-secret residue and the secret
 * store values it produces. Total and non-destructive: the input is not
 * mutated, and every non-secret field passes through untouched.
 */
export function splitServerOAuthState(
  state: ServerOAuthState,
  policy: PersistTokensPolicy,
): SplitResult<ServerOAuthState> {
  const secrets: OAuthSecretValues = {};
  const residue: ServerOAuthState = { ...state };

  if (state.byIssuer) {
    const byIssuer: Record<string, IssuerBoundOAuthState> = {};
    for (const [issuer, slot] of Object.entries(state.byIssuer)) {
      const slotResidue: IssuerBoundOAuthState = { ...slot };
      if (slot.tokens) {
        delete slotResidue.tokens;
        const kept = applyTokensPolicy(slot.tokens, policy);
        if (kept) secrets[issuerTokensField(issuer)] = JSON.stringify(kept);
      }
      if (slot.clientInformation?.client_secret !== undefined) {
        const { client_secret, ...publicInfo } = slot.clientInformation;
        slotResidue.clientInformation = publicInfo;
        secrets[issuerClientSecretField(issuer)] = client_secret;
      }
      // Own-property write: issuer keys come from persisted state and can
      // be "__proto__", which a plain assignment would silently drop —
      // omitting the residue while its secrets were already emitted.
      setOwnEntry(byIssuer, issuer, slotResidue);
    }
    residue.byIssuer = byIssuer;
  }

  if (state.tokens) {
    delete residue.tokens;
    const kept = applyTokensPolicy(state.tokens, policy);
    if (kept) secrets[LEGACY_TOKENS_FIELD] = JSON.stringify(kept);
  }
  if (state.clientInformation?.client_secret !== undefined) {
    const { client_secret, ...publicInfo } = state.clientInformation;
    residue.clientInformation = publicInfo;
    secrets[LEGACY_CLIENT_SECRET_FIELD] = client_secret;
  }
  if (state.preregisteredClientInformation?.client_secret !== undefined) {
    const { client_secret, ...publicInfo } =
      state.preregisteredClientInformation;
    residue.preregisteredClientInformation = publicInfo;
    secrets[PREREG_CLIENT_SECRET_FIELD] = client_secret;
  }

  return { residue, secrets };
}

function parseStoredTokens(raw: string): OAuthTokens | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { access_token?: unknown }).access_token === "string"
    ) {
      return parsed as OAuthTokens;
    }
  } catch {
    // Corrupt store entry — treat as absent rather than poisoning the state.
  }
  return undefined;
}

/**
 * Rejoin a server's residue with its secret store values. The store wins
 * over any plaintext still in the residue (keychain-wins — the migration
 * rule: a store value is at least as fresh as the file copy it replaced). A
 * secret with no matching residue slot is ignored — the slot was cleared,
 * and resurrecting credentials from an orphaned store entry would undo it.
 */
export function joinServerOAuthState(
  residue: ServerOAuthState,
  secrets: OAuthSecretValues,
): ServerOAuthState {
  const joined: ServerOAuthState = { ...residue };

  if (residue.byIssuer) {
    const byIssuer: Record<string, IssuerBoundOAuthState> = {};
    for (const [issuer, slot] of Object.entries(residue.byIssuer)) {
      const joinedSlot: IssuerBoundOAuthState = { ...slot };
      const tokensRaw = secrets[issuerTokensField(issuer)];
      if (tokensRaw !== undefined) {
        const tokens = parseStoredTokens(tokensRaw);
        if (tokens) joinedSlot.tokens = tokens;
      }
      const clientSecret = secrets[issuerClientSecretField(issuer)];
      if (clientSecret !== undefined && joinedSlot.clientInformation) {
        joinedSlot.clientInformation = {
          ...joinedSlot.clientInformation,
          client_secret: clientSecret,
        };
      }
      setOwnEntry(byIssuer, issuer, joinedSlot);
    }
    joined.byIssuer = byIssuer;
  }

  const legacyTokensRaw = secrets[LEGACY_TOKENS_FIELD];
  if (legacyTokensRaw !== undefined) {
    const tokens = parseStoredTokens(legacyTokensRaw);
    if (tokens) joined.tokens = tokens;
  }
  const legacySecret = secrets[LEGACY_CLIENT_SECRET_FIELD];
  if (legacySecret !== undefined && joined.clientInformation) {
    joined.clientInformation = {
      ...joined.clientInformation,
      client_secret: legacySecret,
    };
  }
  const preregSecret = secrets[PREREG_CLIENT_SECRET_FIELD];
  if (preregSecret !== undefined && joined.preregisteredClientInformation) {
    joined.preregisteredClientInformation = {
      ...joined.preregisteredClientInformation,
      client_secret: preregSecret,
    };
  }

  return joined;
}

/** Split one IdP session: `idToken`/`refreshToken` are the secrets. */
export function splitIdpSession(
  session: IdpSessionState,
  policy: PersistTokensPolicy,
): SplitResult<IdpSessionState> {
  const { idToken, refreshToken, ...residue } = session;
  const secrets: OAuthSecretValues = {};
  if (
    policy !== "none" &&
    (idToken !== undefined || refreshToken !== undefined)
  ) {
    const kept: Pick<IdpSessionState, "idToken" | "refreshToken"> = {
      ...(idToken !== undefined && { idToken }),
      ...(policy === "all" && refreshToken !== undefined && { refreshToken }),
    };
    if (Object.keys(kept).length > 0) {
      secrets[IDP_SESSION_FIELD] = JSON.stringify(kept);
    }
  }
  return { residue, secrets };
}

/** Rejoin an IdP session residue with its stored tokens (store wins). */
export function joinIdpSession(
  residue: IdpSessionState,
  secrets: OAuthSecretValues,
): IdpSessionState {
  const raw = secrets[IDP_SESSION_FIELD];
  if (raw === undefined) return { ...residue };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const { idToken, refreshToken } = parsed as Pick<
        IdpSessionState,
        "idToken" | "refreshToken"
      >;
      return {
        ...residue,
        ...(typeof idToken === "string" && { idToken }),
        ...(typeof refreshToken === "string" && { refreshToken }),
      };
    }
  } catch {
    // Corrupt store entry — treat as absent.
  }
  return { ...residue };
}

/**
 * Every secret-store field this server entry could be using, derived from
 * the entry's shape (the store has no enumeration; the file's issuer keys
 * are the index). Used to compute set-vs-delete on write: a candidate field
 * with no post-split value is deleted, so clears and policy downgrades
 * propagate to the store.
 */
export function serverSecretFields(
  state: ServerOAuthState | undefined,
): string[] {
  const fields = new Set<string>([
    LEGACY_TOKENS_FIELD,
    LEGACY_CLIENT_SECRET_FIELD,
    PREREG_CLIENT_SECRET_FIELD,
  ]);
  for (const issuer of Object.keys(state?.byIssuer ?? {})) {
    fields.add(issuerTokensField(issuer));
    fields.add(issuerClientSecretField(issuer));
  }
  return [...fields];
}

/** Does this snapshot still carry plaintext secrets (pre-migration file)? */
export function snapshotHasPlaintextSecrets(
  snapshot: OAuthPersistSnapshot,
): boolean {
  for (const state of Object.values(snapshot.servers)) {
    if (state.tokens) return true;
    if (state.clientInformation?.client_secret !== undefined) return true;
    if (state.preregisteredClientInformation?.client_secret !== undefined) {
      return true;
    }
    for (const slot of Object.values(state.byIssuer ?? {})) {
      if (slot.tokens) return true;
      if (slot.clientInformation?.client_secret !== undefined) return true;
    }
  }
  for (const session of Object.values(snapshot.idpSessions)) {
    if (session.idToken !== undefined || session.refreshToken !== undefined) {
      return true;
    }
  }
  return false;
}
