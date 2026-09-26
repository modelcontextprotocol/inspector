/**
 * Splits acquired OAuth secrets out of the persisted `oauth.json` shape and
 * into the {@link SecretStore} (Step 2 of the token-storage plan): tokens,
 * DCR/legacy client secrets and registration access tokens (RFC 7592), and
 * IdP session tokens live in the secret store;
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

import { OAuthTokensSchema } from "@modelcontextprotocol/core";
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
/** Field for one issuer's DCR `registration_access_token` (RFC 7592). */
export const issuerRegistrationTokenField = (issuer: string): string =>
  `registration-token:${issuer}`;
/** Legacy unkeyed fallback slots (pre-1625 snapshots) — no issuer suffix. */
export const LEGACY_TOKENS_FIELD = "tokens";
export const LEGACY_CLIENT_SECRET_FIELD = "client-secret";
export const LEGACY_REGISTRATION_TOKEN_FIELD = "registration-token";
/** `client_secret` of a statically preregistered client. */
export const PREREG_CLIENT_SECRET_FIELD = "prereg-client-secret";
/** `registration_access_token` of a statically preregistered client. */
export const PREREG_REGISTRATION_TOKEN_FIELD = "prereg-registration-token";
/** One IdP issuer's session tokens (JSON `{ idToken?, refreshToken? }`). */
export const IDP_SESSION_FIELD = "idp-session";

/** Secret values extracted from one entry, keyed by store field. */
export type OAuthSecretValues = Record<string, string>;

export interface SplitResult<T> {
  /**
   * What remains for `oauth.json`. Usually secret-free, with one deliberate
   * exception: a partial-but-legitimate token payload that the store's
   * read-side gate would reject (see {@link splitTokens}) stays plaintext
   * here — the file is the only place it can survive. Callers must not
   * assume the residue is safe to expose as if it carried no credentials.
   */
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
 * Split one `tokens` payload into what goes to the store and what must stay
 * plaintext in the residue. The store only receives a payload the read-side
 * join can serve back (`parseStoredTokens` gates with the full
 * `OAuthTokensSchema`): a partial-but-legitimate payload — say a
 * refresh-only entry inherited from a legacy plaintext file — would
 * otherwise be stored with apparent success, stripped from the residue, and
 * silently dropped on the very next read. Such a payload stays in the
 * residue instead, *post-policy* so `none`/`access` stripping still
 * applies: the file is the only place it can survive. A post-policy payload
 * with no secret-bearing field at all (no `access_token`, `refresh_token`,
 * or `id_token` — say policy `access` applied to a refresh-only entry) is
 * dropped rather than kept: there is nothing left worth preserving, and a
 * secretless `tokens` artifact in the residue would linger forever. Every
 * consumer of the split (saves, lazy migration, the non-durable keep)
 * inherits this rule, so no path can strip a token payload the store
 * cannot serve.
 */
function splitTokens(
  tokens: OAuthTokens,
  policy: PersistTokensPolicy,
): { secret?: string; plaintext?: OAuthTokens } {
  const kept = applyTokensPolicy(tokens, policy);
  if (!kept) return {};
  if (OAuthTokensSchema.safeParse(kept).success) {
    return { secret: JSON.stringify(kept) };
  }
  if (
    kept.access_token === undefined &&
    kept.refresh_token === undefined &&
    kept.id_token === undefined
  ) {
    return {};
  }
  return { plaintext: kept };
}

/**
 * The bearer-grade keys a `clientInformation` object can carry.
 * `client_secret` is in the declared type; `registration_access_token` (the
 * RFC 7592 registration-management credential — same bearer class, see
 * `maskSecrets.ts`) has never been surfaced by any SDK release, so this
 * split handles it purely defensively should one ever preserve it (see
 * `StoredOAuthClientInformation` in `store.ts`).
 */
type ClientInfoSecretKeys = {
  client_secret?: string;
  registration_access_token?: string;
};

/** The pair of store fields one `clientInformation` slot splits into. */
interface ClientInfoFields {
  clientSecret: string;
  registrationToken: string;
}

/**
 * Extract the bearer-grade keys from one `clientInformation` object into
 * `secrets`, returning the public residue. Both keys are handled in one
 * place so a slot with a `registration_access_token` but no `client_secret`
 * still splits — key-by-key extraction is how the token used to slip
 * through to plaintext.
 */
function splitClientInformation<T extends ClientInfoSecretKeys>(
  info: T,
  fields: ClientInfoFields,
  secrets: OAuthSecretValues,
): T {
  const { client_secret, registration_access_token, ...publicInfo } = info;
  if (client_secret === undefined && registration_access_token === undefined) {
    return info;
  }
  if (client_secret !== undefined) {
    secrets[fields.clientSecret] = client_secret;
  }
  if (registration_access_token !== undefined) {
    secrets[fields.registrationToken] = registration_access_token;
  }
  return publicInfo as T;
}

/**
 * Overlay a slot's stored bearer-grade keys back onto its residue
 * (store-wins). Only called when the residue slot exists — a secret with no
 * slot was cleared, and rejoining it would resurrect the cleared value.
 */
function joinClientInformation<T extends ClientInfoSecretKeys>(
  info: T,
  fields: ClientInfoFields,
  secrets: OAuthSecretValues,
): T {
  const clientSecret = secrets[fields.clientSecret];
  const registrationToken = secrets[fields.registrationToken];
  if (clientSecret === undefined && registrationToken === undefined) {
    return info;
  }
  return {
    ...info,
    ...(clientSecret !== undefined && { client_secret: clientSecret }),
    ...(registrationToken !== undefined && {
      registration_access_token: registrationToken,
    }),
  };
}

const issuerClientInfoFields = (issuer: string): ClientInfoFields => ({
  clientSecret: issuerClientSecretField(issuer),
  registrationToken: issuerRegistrationTokenField(issuer),
});
const LEGACY_CLIENT_INFO_FIELDS: ClientInfoFields = {
  clientSecret: LEGACY_CLIENT_SECRET_FIELD,
  registrationToken: LEGACY_REGISTRATION_TOKEN_FIELD,
};
const PREREG_CLIENT_INFO_FIELDS: ClientInfoFields = {
  clientSecret: PREREG_CLIENT_SECRET_FIELD,
  registrationToken: PREREG_REGISTRATION_TOKEN_FIELD,
};

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
        const tokenSplit = splitTokens(slot.tokens, policy);
        if (tokenSplit.secret !== undefined) {
          secrets[issuerTokensField(issuer)] = tokenSplit.secret;
        }
        if (tokenSplit.plaintext) slotResidue.tokens = tokenSplit.plaintext;
      }
      if (slot.clientInformation) {
        slotResidue.clientInformation = splitClientInformation(
          slot.clientInformation,
          issuerClientInfoFields(issuer),
          secrets,
        );
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
    const tokenSplit = splitTokens(state.tokens, policy);
    if (tokenSplit.secret !== undefined) {
      secrets[LEGACY_TOKENS_FIELD] = tokenSplit.secret;
    }
    if (tokenSplit.plaintext) residue.tokens = tokenSplit.plaintext;
  }
  if (state.clientInformation) {
    residue.clientInformation = splitClientInformation(
      state.clientInformation,
      LEGACY_CLIENT_INFO_FIELDS,
      secrets,
    );
  }
  if (state.preregisteredClientInformation) {
    residue.preregisteredClientInformation = splitClientInformation(
      state.preregisteredClientInformation,
      PREREG_CLIENT_INFO_FIELDS,
      secrets,
    );
  }

  return { residue, secrets };
}

function parseStoredTokens(raw: string): OAuthTokens | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    // Validate with the same schema `getTokens` applies before serving the
    // value — a looser check here (say, access_token only) would declare a
    // value "usable" that then throws at the consumer, and migration would
    // have stripped the valid plaintext in its favor. Validation only: the
    // *original* object is returned, since the schema strips extra fields
    // like the SEP-2352 `issuer` stamp that the state relies on.
    if (OAuthTokensSchema.safeParse(parsed).success) {
      return parsed as OAuthTokens;
    }
  } catch {
    // Corrupt store entry — treat as absent rather than poisoning the state.
  }
  return undefined;
}

/**
 * Parse a stored `idp-session` value into the fields the join extracts, or
 * `undefined` when nothing usable is present. Shared by {@link joinIdpSession}
 * and {@link isUsableStoredSecret} so "usable" cannot drift from what the
 * join actually accepts: the split only ever stores a value with at least
 * one string field, so a value yielding neither is corrupt.
 */
function parseStoredIdpSession(
  raw: string,
): Pick<IdpSessionState, "idToken" | "refreshToken"> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const { idToken, refreshToken } = parsed as Pick<
        IdpSessionState,
        "idToken" | "refreshToken"
      >;
      const usable = {
        ...(typeof idToken === "string" && { idToken }),
        ...(typeof refreshToken === "string" && { refreshToken }),
      };
      if (Object.keys(usable).length > 0) return usable;
    }
  } catch {
    // Corrupt store entry — treat as absent.
  }
  return undefined;
}

/**
 * Whether a stored value for `field` would survive the read-side join.
 * Structured fields (`tokens`, `tokens:<issuer>`, `idp-session`) must hold
 * the JSON shape the join validates for — the same checks
 * {@link parseStoredTokens} and {@link joinIdpSession} apply; every other
 * field is an opaque secret string, so any value is usable. Migration uses
 * this so "store wins" means a *usable* store value wins: a corrupt store
 * entry must not suppress copying valid plaintext and then be discarded by
 * the join — that would turn a recoverable corrupt entry into token loss.
 */
export function isUsableStoredSecret(field: string, raw: string): boolean {
  if (field === LEGACY_TOKENS_FIELD || field.startsWith("tokens:")) {
    return parseStoredTokens(raw) !== undefined;
  }
  if (field === IDP_SESSION_FIELD) {
    return parseStoredIdpSession(raw) !== undefined;
  }
  return true;
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
      if (joinedSlot.clientInformation) {
        joinedSlot.clientInformation = joinClientInformation(
          joinedSlot.clientInformation,
          issuerClientInfoFields(issuer),
          secrets,
        );
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
  if (joined.clientInformation) {
    joined.clientInformation = joinClientInformation(
      joined.clientInformation,
      LEGACY_CLIENT_INFO_FIELDS,
      secrets,
    );
  }
  if (joined.preregisteredClientInformation) {
    joined.preregisteredClientInformation = joinClientInformation(
      joined.preregisteredClientInformation,
      PREREG_CLIENT_INFO_FIELDS,
      secrets,
    );
  }

  return joined;
}

/**
 * Split one IdP session: `idToken`/`refreshToken` are the secrets. Only
 * string-typed values are stringified into the store — the read-side
 * `parseStoredIdpSession` extracts only string fields, so a non-string
 * (corrupt data tolerated by the file parser) would be stored with apparent
 * success and yield nothing on read. Unlike partial token payloads there is
 * no legitimate non-string shape to preserve, so it is dropped here rather
 * than kept in the residue.
 */
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
      ...(typeof idToken === "string" && { idToken }),
      ...(policy === "all" &&
        typeof refreshToken === "string" && { refreshToken }),
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
  const stored = parseStoredIdpSession(raw);
  return stored ? { ...residue, ...stored } : { ...residue };
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
    LEGACY_REGISTRATION_TOKEN_FIELD,
    PREREG_CLIENT_SECRET_FIELD,
    PREREG_REGISTRATION_TOKEN_FIELD,
  ]);
  for (const issuer of Object.keys(state?.byIssuer ?? {})) {
    fields.add(issuerTokensField(issuer));
    fields.add(issuerClientSecretField(issuer));
    fields.add(issuerRegistrationTokenField(issuer));
  }
  return [...fields];
}

/** Does this `clientInformation` object still carry a bearer-grade key? */
function clientInfoHasPlaintext(
  info: ClientInfoSecretKeys | undefined,
): boolean {
  return (
    info !== undefined &&
    (info.client_secret !== undefined ||
      info.registration_access_token !== undefined)
  );
}

/** Does this snapshot still carry plaintext secrets (pre-migration file)? */
export function snapshotHasPlaintextSecrets(
  snapshot: OAuthPersistSnapshot,
): boolean {
  for (const state of Object.values(snapshot.servers)) {
    if (state.tokens) return true;
    if (clientInfoHasPlaintext(state.clientInformation)) return true;
    if (clientInfoHasPlaintext(state.preregisteredClientInformation)) {
      return true;
    }
    for (const slot of Object.values(state.byIssuer ?? {})) {
      if (slot.tokens) return true;
      if (clientInfoHasPlaintext(slot.clientInformation)) return true;
    }
  }
  for (const session of Object.values(snapshot.idpSessions)) {
    if (session.idToken !== undefined || session.refreshToken !== undefined) {
      return true;
    }
  }
  return false;
}
