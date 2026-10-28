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

import { createHmac, randomUUID } from "node:crypto";
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
 *
 * Ids are additionally scoped by the state file's secrets namespace
 * (#2549): without it, two state files (profiles) that connect to the same
 * server share one store entry, so profile B's login overwrites profile
 * A's tokens and A silently acts as B. The namespace is a UUID stored in
 * the state file itself (see `adoptSecretsNamespace` in
 * `oauth-persist-file.ts`), inserted between the prefix and the encoded
 * URL: `oauth+<namespace>+<encoded url>`. The delimiter stays unambiguous
 * because `encodeURIComponent` escapes `+` (to `%2B`) and
 * {@link isValidSecretsNamespace} rejects `+` (and `:`, keeping the id
 * colon-free for the keyring account parse) — so a namespaced id can never
 * equal a legacy unscoped one, and no (namespace, url) pair can produce
 * another pair's id. `namespace === undefined` yields the legacy unscoped
 * shape, still used to read (and migrate away from) pre-#2549 entries.
 */
export const oauthSecretServerId = (
  serverUrl: string,
  namespace?: string,
): string =>
  namespace === undefined
    ? `oauth+${encodeURIComponent(serverUrl)}`
    : `oauth+${namespace}+${encodeURIComponent(serverUrl)}`;
export const oauthIdpSecretServerId = (
  issuer: string,
  namespace?: string,
): string =>
  namespace === undefined
    ? `oauth-idp+${encodeURIComponent(issuer)}`
    : `oauth-idp+${namespace}+${encodeURIComponent(issuer)}`;

/**
 * A usable secrets namespace: what `randomUUID()` produces, plus room for a
 * hand-chosen value. The charset is what carries the id guarantees above —
 * no `:` (keyring accounts parse at the first colon), no `+` (the id
 * delimiter), and nothing `encodeURIComponent` leaves unescaped in a way
 * that could forge a delimiter. Anything else in the file is ignored as if
 * absent rather than propagated into store ids.
 */
export function isValidSecretsNamespace(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
  );
}

/** Mint a fresh secrets namespace for a state file that has none. */
export function newSecretsNamespace(): string {
  return randomUUID();
}

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

/**
 * Field for the owner stamp stored beside a DCR client credential (#2734):
 * which `client_id` the value in `field` was written for. The store does
 * not otherwise record that pairing, and a carry-over from a superseded
 * namespace needs it — a secret paired with the wrong client is useless.
 *
 * It lives in the store, beside the value, rather than in the namespace
 * ledger because the value moves without the ledger seeing it: the
 * file-to-keychain hand-off copies each account it finds unless the
 * keychain already holds one, and knows nothing of state files. A stamp in
 * the store is copied or kept exactly as its value is, so it names the
 * client of the value actually there, however many hand-offs ran.
 */
export const clientCredentialStampField = (field: string): string =>
  `${field}#owner`;

/**
 * A MAC over `clientId` keyed by the credential itself: only a writer
 * holding `value` can produce it, and it matches only that value and that
 * client. Keyed rather than a plain digest of the value, so the credential
 * is never the hashed input — a fast unkeyed hash of a secret is the shape
 * of an offline-guessable password hash, even though this one sits in the
 * same store as the value and so reveals nothing that store does not.
 */
const credentialMac = (clientId: string, value: string): string =>
  createHmac("sha256", value).update(clientId).digest("hex");

/**
 * The stamp naming `clientId` as the owner of `value`. It carries a MAC
 * bound to the value so a stamp separated from its value — the hand-off
 * keeps and copies per account, so a kept value can meet a copied stamp,
 * and an older Inspector can rewrite a value without its stamp — never
 * vouches for another value.
 */
export function clientCredentialStamp(clientId: string, value: string): string {
  return JSON.stringify({
    client_id: clientId,
    mac: credentialMac(clientId, value),
  });
}

/**
 * The `client_id` a stamp names as `value`'s owner, or `undefined` when
 * there is no stamp, it is malformed, or it was written for a different
 * value — all of which make the owner unknown, and an unknown owner is
 * never guessed.
 */
export function stampedOwner(
  stamp: string | undefined,
  value: string,
): string | undefined {
  if (stamp === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stamp);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const { client_id: clientId, mac } = parsed as Record<string, unknown>;
  if (typeof clientId !== "string" || mac !== credentialMac(clientId, value)) {
    return undefined;
  }
  return clientId;
}

/** Secret values extracted from one entry, keyed by store field. */
export type OAuthSecretValues = Record<string, string>;

export interface SplitResult<T> {
  /**
   * What remains for `oauth.json` — carries no usable secret. The one
   * exception is a *type-corrupt* token payload (say `access_token: 123`,
   * possible only in a hand-edited file) that {@link splitTokens} leaves in
   * place so the entry stays clearable; every well-typed token payload,
   * partial or full, moves to the store.
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
 * The schema for what the secret store may hold in a tokens field: every
 * present field well-typed, none required. This is deliberately the same
 * shape the API write boundary accepts (`parseOAuthStoreWriteBody`) and the
 * read-side join serves back (`parseStoredTokens`) — one contract for
 * "storable", so nothing the split stores can be dropped on read, and
 * nothing the boundary admits gets stranded outside the store.
 */
const StorableTokensSchema = OAuthTokensSchema.partial();

/**
 * The other half of the store contract: a stored payload must carry at
 * least one bearer-grade field. `splitTokens` never stores a secretless
 * payload, and the read side ({@link parseStoredTokens}) must not treat one
 * as usable — it would win over plaintext in the join for no benefit.
 */
function hasSecretBearingTokenField(tokens: OAuthTokens): boolean {
  return (
    tokens.access_token !== undefined ||
    tokens.refresh_token !== undefined ||
    tokens.id_token !== undefined
  );
}

/**
 * Split one `tokens` payload into what goes to the store and what must stay
 * plaintext in the residue, *post-policy* so `none`/`access` stripping
 * still applies. Any payload the store contract accepts
 * ({@link StorableTokensSchema}) and that carries at least one
 * secret-bearing field goes to the store — including partial-but-legitimate
 * shapes such as a refresh-only entry inherited from a legacy plaintext
 * file, which the read-side join serves back for the CLI's stored-token
 * refresh while `getTokens` still withholds it from the SDK. A storable
 * payload with no secret-bearing field (no `access_token`, `refresh_token`,
 * or `id_token` — say policy `access` applied to a refresh-only entry) is
 * dropped: there is nothing worth preserving, and a secretless `tokens`
 * artifact would linger forever. Only a *type-corrupt* payload (say
 * `access_token: 123`, possible only in a hand-edited file — the API write
 * boundary rejects it) stays plaintext in the residue: the store must never
 * hold junk the join cannot serve, and the entry must remain clearable
 * from the file. Every consumer of the split (saves, lazy migration, the
 * non-durable keep) inherits these rules.
 */
function splitTokens(
  tokens: OAuthTokens,
  policy: PersistTokensPolicy,
): { secret?: string; plaintext?: OAuthTokens } {
  const kept = applyTokensPolicy(tokens, policy);
  if (!kept) return {};
  if (!StorableTokensSchema.safeParse(kept).success) {
    return { plaintext: kept };
  }
  if (!hasSecretBearingTokenField(kept)) {
    return {};
  }
  return { secret: JSON.stringify(kept) };
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
  client_id?: unknown;
  client_secret?: string;
  registration_access_token?: string;
};

/**
 * The pair of store fields one `clientInformation` slot splits into, and
 * whether each value is stamped with its owner (DCR slots only — see
 * {@link clientCredentialOwners} for why pre-registered ones are not).
 */
interface ClientInfoFields {
  clientSecret: string;
  registrationToken: string;
  stamped: boolean;
}

/**
 * Extract the bearer-grade keys from one `clientInformation` object into
 * `secrets`, returning the public residue. Both keys are handled in one
 * place so a slot with a `registration_access_token` but no `client_secret`
 * still splits — key-by-key extraction is how the token used to slip
 * through to plaintext. A DCR slot's values are stamped with the client
 * they belong to (#2734).
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
  const put = (field: string, value: string | undefined): void => {
    if (value === undefined) return;
    secrets[field] = value;
    if (fields.stamped && typeof info.client_id === "string") {
      secrets[clientCredentialStampField(field)] = clientCredentialStamp(
        info.client_id,
        value,
      );
    }
  };
  put(fields.clientSecret, client_secret);
  put(fields.registrationToken, registration_access_token);
  return publicInfo as T;
}

/**
 * Overlay a slot's stored bearer-grade keys back onto its residue
 * (store-wins). Only called when the residue slot exists — a secret with no
 * slot was cleared, and rejoining it would resurrect the cleared value.
 *
 * A DCR value whose stamp vouches for it but names a different client is
 * read as absent (#2768): the file-to-keychain hand-off keeps an existing
 * keychain value, so after a re-registration the keychain can still hold
 * the previous client's secret, and pairing it with the new `client_id`
 * fails only at the token endpoint. A value with no valid stamp (legacy, or
 * rewritten by an older Inspector) is served as before — its owner is
 * unknown, and an unknown owner is never guessed.
 */
function joinClientInformation<T extends ClientInfoSecretKeys>(
  info: T,
  fields: ClientInfoFields,
  secrets: OAuthSecretValues,
): T {
  const owned = (field: string): string | undefined => {
    const value = secrets[field];
    if (
      value === undefined ||
      !fields.stamped ||
      typeof info.client_id !== "string"
    ) {
      return value;
    }
    const owner = stampedOwner(
      secrets[clientCredentialStampField(field)],
      value,
    );
    return owner === undefined || owner === info.client_id ? value : undefined;
  };
  const clientSecret = owned(fields.clientSecret);
  const registrationToken = owned(fields.registrationToken);
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
  stamped: true,
});
const LEGACY_CLIENT_INFO_FIELDS: ClientInfoFields = {
  clientSecret: LEGACY_CLIENT_SECRET_FIELD,
  registrationToken: LEGACY_REGISTRATION_TOKEN_FIELD,
  stamped: true,
};
const PREREG_CLIENT_INFO_FIELDS: ClientInfoFields = {
  clientSecret: PREREG_CLIENT_SECRET_FIELD,
  registrationToken: PREREG_REGISTRATION_TOKEN_FIELD,
  stamped: false,
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
    // Validate with the store contract — the same gate `splitTokens`
    // applies on write ({@link StorableTokensSchema} plus at least one
    // secret-bearing field), so exactly what the split stores is served
    // back. Partial shapes (say refresh-only) are
    // deliberately servable: the CLI's stored-token refresh reads
    // `state.tokens.refresh_token` from the joined state, while `getTokens`
    // applies the full schema before handing tokens to the SDK and reports
    // a partial as "no usable tokens". Validation only: the *original*
    // object is returned, since the schema strips extra fields like the
    // SEP-2352 `issuer` stamp that the state relies on.
    if (
      StorableTokensSchema.safeParse(parsed).success &&
      hasSecretBearingTokenField(parsed as OAuthTokens)
    ) {
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
  const stamped = (field: string): string[] => [
    field,
    clientCredentialStampField(field),
  ];
  const fields = new Set<string>([
    LEGACY_TOKENS_FIELD,
    ...stamped(LEGACY_CLIENT_SECRET_FIELD),
    ...stamped(LEGACY_REGISTRATION_TOKEN_FIELD),
    PREREG_CLIENT_SECRET_FIELD,
    PREREG_REGISTRATION_TOKEN_FIELD,
  ]);
  for (const issuer of Object.keys(state?.byIssuer ?? {})) {
    fields.add(issuerTokensField(issuer));
    for (const field of stamped(issuerClientSecretField(issuer))) {
      fields.add(field);
    }
    for (const field of stamped(issuerRegistrationTokenField(issuer))) {
      fields.add(field);
    }
  }
  return [...fields];
}

/**
 * The `client_id` each dynamically registered client's credential fields
 * belong to, keyed by field (#2672). A carried-over `client_secret` or
 * registration token is only meaningful paired with the client it was
 * issued to, and the store does not record that pairing, so a carry-over
 * from a superseded namespace checks it against this. Pre-registered
 * clients are left out: they are user-entered, and a user can clear one's
 * secret while keeping its `client_id`, which no carry-over could tell
 * apart from a secret that was never carried.
 */
export function clientCredentialOwners(
  state: ServerOAuthState,
): Map<string, string> {
  const owners = new Map<string, string>();
  const add = (
    info: { client_id?: unknown } | undefined,
    fields: ClientInfoFields,
  ): void => {
    if (typeof info?.client_id !== "string") return;
    owners.set(fields.clientSecret, info.client_id);
    owners.set(fields.registrationToken, info.client_id);
  };
  add(state.clientInformation, LEGACY_CLIENT_INFO_FIELDS);
  for (const [issuer, slot] of Object.entries(state.byIssuer ?? {})) {
    add(slot.clientInformation, issuerClientInfoFields(issuer));
  }
  return owners;
}

/**
 * `secrets` with each DCR client credential's stamp made to vouch for the
 * value beside it (#2734), for a write that copies values it read rather
 * than splitting them from state (adoption). A stamp that already vouches
 * for its value is kept, whichever client it names — it records where that
 * value came from. Any other value is stamped for the client `state` pairs
 * it with, which is the pairing the copy itself asserts; a stamp whose
 * value is absent is dropped.
 */
export function restampClientCredentials(
  state: ServerOAuthState,
  secrets: OAuthSecretValues,
): OAuthSecretValues {
  const out: OAuthSecretValues = { ...secrets };
  for (const [field, clientId] of clientCredentialOwners(state)) {
    const stampField = clientCredentialStampField(field);
    const value = Object.hasOwn(out, field) ? out[field] : undefined;
    if (value === undefined) {
      delete out[stampField];
    } else if (stampedOwner(out[stampField], value) === undefined) {
      setOwnEntry(out, stampField, clientCredentialStamp(clientId, value));
    }
  }
  return out;
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
