/**
 * RFC 7009 OAuth 2.0 Token Revocation (#2144).
 *
 * Clearing the Inspector's OAuth state used to delete the *local* copy of the
 * tokens and stop there: the access token, and the refresh token when one was
 * issued, stayed valid at the authorization server until they expired on their
 * own. From the AS's side nothing happened — the client just went quiet — so a
 * day of connect/disconnect iteration left it holding a pile of live grants for
 * sessions that had ended hours ago. RFC 7009 §1 describes exactly this case
 * (a client invalidating its tokens when the user logs out or walks away) and
 * this module is the request that closes it.
 *
 * Everything here is **best-effort**, and deliberately so: the local clear is
 * what the user asked for, and it must finish whether or not the AS cooperates.
 * An authorization server that advertises no `revocation_endpoint` is left
 * behaving exactly as before, a network error or a non-2xx is reported and
 * swallowed, and a short timeout keeps a slow AS from hanging the teardown.
 * Every path therefore returns a {@link TokenRevocationOutcome} rather than
 * throwing — a caller is telling us to forget these tokens, and there is no
 * failure here that should stop it.
 */

import type {
  OAuthClientInformation,
  OAuthTokens,
} from "@modelcontextprotocol/client";
import { selectClientAuthMethod } from "@modelcontextprotocol/client";
import {
  OAuthClientInformationSchema,
  OAuthTokensSchema,
} from "@modelcontextprotocol/core";
import type { InspectorLogger } from "../logging/index.js";
import type { OAuthStorage, RevocationSnapshot } from "./storage.js";

/**
 * How long a revocation request may take before it is abandoned.
 *
 * Short on purpose. This runs inside a disconnect the user has already
 * committed to, so an unreachable or wedged authorization server must not hold
 * the teardown open — five seconds is long enough for a real endpoint on a slow
 * link and short enough that a dead one is not felt as a hang.
 *
 * It is a budget for the **whole** call, not per request: a server with several
 * issuer-bound grants revokes them sequentially against one shared deadline, so
 * the bound the user feels is this number regardless of how many grants the
 * clear is about to delete.
 */
export const DEFAULT_REVOCATION_TIMEOUT_MS = 5000;

/**
 * The least budget worth spending a revocation request on.
 *
 * The shared deadline below is consumed sequentially, so the grant that follows
 * a slow one can arrive with a sliver of budget left — a couple of milliseconds,
 * which is less than a TCP handshake, let alone a round trip. Issuing that
 * request buys nothing: it is guaranteed to time out, and its outcome is the
 * same `failed` the exhausted-budget branch already reports, only after a
 * needless call to the authorization server.
 *
 * It also removes a boundary that nothing can land on cleanly. `remainingMs > 0`
 * is decided by timer resolution: the deadline is enforced by a `setTimeout`,
 * and a clock that has not yet ticked past the deadline when the loop comes
 * round leaves a fractional budget behind, so the same run issues one request or
 * two depending on scheduling noise (#2252). A floor an order of magnitude above
 * that noise makes the decision the same every time.
 */
export const MIN_REVOCATION_REQUEST_BUDGET_MS = 5;

/** Why a revocation request was not sent. */
export type TokenRevocationSkipReason =
  /** The caller turned revocation off for this server. */
  | "disabled"
  /** The authorization server advertises no `revocation_endpoint`. */
  | "no_endpoint"
  /** Nothing is stored for this server, so there is no grant to revoke. */
  | "no_tokens"
  /** Authorization-server metadata could not be resolved at all. */
  | "no_metadata";

/**
 * What happened on the revocation leg. Never an exception: see the module
 * comment — the local clear runs regardless, so this is reported, not thrown.
 */
export type TokenRevocationOutcome =
  | {
      status: "revoked";
      /** Which token RFC 7009 §2.1 was asked about. */
      tokenTypeHint: "refresh_token" | "access_token";
      endpoint: string;
    }
  | { status: "skipped"; reason: TokenRevocationSkipReason }
  | { status: "failed"; detail: string; endpoint?: string };

/**
 * The token to name in the request, and the hint that describes it.
 *
 * A refresh token is preferred when one exists, and not merely as a
 * tie-breaker: RFC 7009 §2.1 says an AS asked to revoke a refresh token SHOULD
 * also invalidate the access tokens issued under the same grant, so the single
 * request covers both. Naming the access token instead would leave the refresh
 * token — the long-lived half, and the one a user cannot wait out — alive.
 */
export function selectRevocableToken(
  tokens: OAuthTokens | undefined,
): { token: string; tokenTypeHint: "refresh_token" | "access_token" } | null {
  if (!tokens) return null;
  if (tokens.refresh_token) {
    return { token: tokens.refresh_token, tokenTypeHint: "refresh_token" };
  }
  if (tokens.access_token) {
    return { token: tokens.access_token, tokenTypeHint: "access_token" };
  }
  return null;
}

/**
 * The client-authentication methods the revocation endpoint advertises.
 *
 * RFC 8414 §2 gives `revocation_endpoint_auth_methods_supported` a default of
 * **`client_secret_basic`** when it is omitted — it does *not* inherit
 * `token_endpoint_auth_methods_supported`. Falling through to the token
 * endpoint's list would make metadata advertising only `client_secret_post`
 * there send POST credentials to a revocation endpoint that never advertised
 * that method, which a strict server rejects.
 *
 * The default is returned **literally** rather than as an empty list. An empty
 * list does not mean "apply the RFC default" to `selectClientAuthMethod`: it
 * means "the metadata said nothing", and the SDK then honors whatever
 * `token_endpoint_auth_method` the client's own registration declares. A DCR
 * client registered `client_secret_post` would therefore put its credentials
 * in the body of a request to an endpoint that promised only Basic, and the
 * revocation would fail. Naming the default is what actually enforces it.
 */
export function revocationAuthMethods(metadata: CachedMetadata): string[] {
  return (
    metadata.revocation_endpoint_auth_methods_supported ?? [
      "client_secret_basic",
    ]
  );
}

export interface RevocationRequestParams {
  endpoint: string;
  token: string;
  tokenTypeHint: "refresh_token" | "access_token";
  clientInformation?: OAuthClientInformation;
  supportedAuthMethods: string[];
}

/**
 * Build the RFC 7009 §2.1 request — an `application/x-www-form-urlencoded` POST
 * carrying `token` and `token_type_hint`, plus client authentication.
 *
 * Split out from {@link revokeToken} because *what is sent* is the part worth
 * asserting directly: a credential in the wrong place (basic vs. post) is a
 * silent 401 at a real AS and indistinguishable from "the server declined" in
 * an end-to-end test.
 */
export function buildRevocationRequest(params: RevocationRequestParams): {
  url: string;
  init: RequestInit;
} {
  const body = new URLSearchParams({
    token: params.token,
    token_type_hint: params.tokenTypeHint,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  const client = params.clientInformation;
  if (client) {
    const method = selectClientAuthMethod(client, params.supportedAuthMethods);
    if (method === "client_secret_basic" && client.client_secret) {
      // RFC 6749 §2.3.1: each half is form-urlencoded *before* the colon joins
      // them. This deliberately differs from the SDK's `applyBasicAuth`, which
      // base64s the raw pair — matching that was the first instinct, on the
      // theory that a credential should be presented the same way here as at
      // the token endpoint. It does not hold up: a client authenticated with
      // `client_secret_post` never exercised the SDK's Basic path at all, so
      // there is no precedent to match, and the raw form is ambiguous for a
      // client id containing `:` and makes `btoa` throw outright on a
      // non-Latin-1 secret. Encoding is what the server decodes.
      //
      // ⚠️ `encodeURIComponent` is **not** the form-urlencoded algorithm §2.3.1
      // names (RFC 6749 Appendix B), and #2222 was filed on the assumption that
      // the difference breaks a secret containing `+`. It does not, and the
      // reasoning is worth keeping because the next reader will have the same
      // doubt: `encodeURIComponent` **escapes** `+` as `%2B`. The characters it
      // leaves bare are exactly `!'()*-._~` plus alphanumerics, and a
      // form-urldecoder passes every one of them through unchanged. It can
      // therefore never emit the one character the two algorithms disagree
      // about, so its output decodes identically under both — verified over
      // every code point up to U+2FFF, and pinned by the round-trip cases in
      // `revocation.test.ts`.
      //
      // Switching to `URLSearchParams` would be the literal algorithm and a
      // small *regression*: it encodes a space as `+`, which a compliant server
      // reads back as a space but a lenient one — decoding with
      // `decodeURIComponent` alone, having never implemented the `+` rule —
      // reads as a literal `+`. `%20` is understood by both. So the encoding
      // here is the one that survives either server, which matters more than
      // matching the spec's wording for a header no server sees twice.
      const credentials = `${encodeURIComponent(client.client_id)}:${encodeURIComponent(client.client_secret)}`;
      headers.Authorization = `Basic ${base64Encode(credentials)}`;
    } else if (method === "client_secret_post" && client.client_secret) {
      body.set("client_id", client.client_id);
      body.set("client_secret", client.client_secret);
    } else {
      // Public client (or a confidential one with no secret on hand): RFC 7009
      // §2.1 still wants the client identified.
      body.set("client_id", client.client_id);
    }
  }

  return {
    url: params.endpoint,
    init: { method: "POST", headers, body: body.toString() },
  };
}

/**
 * Base64 for the Basic credential, in both runtimes this code runs in.
 *
 * `btoa` is the browser's and is byte-oriented, so the percent-encoded
 * credential above (which is ASCII by construction) is safe to pass it. Node
 * has `Buffer`; reaching for it first would pull a Node built-in into the
 * browser bundle, which the #1769 build gate rejects outright.
 */
function base64Encode(value: string): string {
  if (typeof btoa === "function") return btoa(value);
  /* v8 ignore next 2 -- Node 22 and every supported browser define btoa; this is the belt-and-braces branch. */
  return Buffer.from(value, "utf8").toString("base64");
}

export interface RevokeTokenParams extends RevocationRequestParams {
  fetchFn: typeof fetch;
  timeoutMs?: number;
}

/**
 * POST the revocation request and classify the answer.
 *
 * RFC 7009 §2.2 makes a 200 the success case *and* the response to a token the
 * AS does not recognize, which is why an already-expired token is not an error
 * here. Anything else — a 4xx, a 5xx, a network failure, the timeout — is
 * reported as `failed` and goes no further than a warning at the call site.
 */
export async function revokeToken(
  params: RevokeTokenParams,
): Promise<TokenRevocationOutcome> {
  // Whole milliseconds, because `AbortSignal.timeout` takes an integer: Node
  // throws `ERR_OUT_OF_RANGE` on a fractional delay — before the fetch, so the
  // request is never sent and the caller gets that as the revocation's failure
  // detail. What is left of a shared deadline is measured with a
  // sub-millisecond clock, so a fractional budget does arrive here. Rounded
  // rather than floored so a caller's own whole-millisecond timeout survives the
  // trip through that clock and is still the number the timeout message names.
  const timeoutMs = Math.max(
    0,
    Math.round(params.timeoutMs ?? DEFAULT_REVOCATION_TIMEOUT_MS),
  );
  try {
    // Inside the try: `encodeURIComponent` throws on a lone UTF-16 surrogate,
    // which is valid JSON and so can reach here from a persisted client id or
    // secret. Built outside, that would reject instead of returning a `failed`
    // outcome — and every caller has already cleared its local state by now, so
    // a rejection would break the documented best-effort guarantee.
    const { url, init } = buildRevocationRequest(params);
    // The signal alone is not enough to bound this. In the browser the fetch is
    // `createRemoteFetch`, which re-issues the call as a POST to `/api/fetch`
    // and does not forward `init.signal`; the backend's outbound fetch gets no
    // signal either. So a wedged authorization server would hold the teardown
    // open indefinitely on exactly the path the timeout exists for. The race is
    // what actually enforces the deadline; the signal is kept because it does
    // cancel the direct-fetch paths (CLI, TUI, backend) rather than merely
    // abandoning them.
    const response = await withDeadline(
      params.fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
      timeoutMs,
    );
    if (!response.ok) {
      return {
        status: "failed",
        endpoint: url,
        detail:
          `revocation endpoint responded ${response.status} ${response.statusText}`.trim(),
      };
    }
    return {
      status: "revoked",
      tokenTypeHint: params.tokenTypeHint,
      endpoint: url,
    };
  } catch (err) {
    return {
      // `params.endpoint`, not the built `url`: construction is inside the try
      // now, so `url` may not exist on this path.
      status: "failed",
      endpoint: params.endpoint,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Reject with a timeout error if `promise` has not settled within `timeoutMs`.
 *
 * The underlying request is abandoned rather than cancelled — nothing here can
 * cancel a fetch the proxy already stripped the signal from. That is the right
 * trade for this caller: the point is that the *teardown* proceeds, and the
 * response, if it ever arrives, is a revocation we no longer need to wait for.
 * The timer is cleared on the settled path so a caller is never held awake by it.
 */
async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error(`revocation request timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    /* v8 ignore next -- the Promise executor runs synchronously, so `timer` is
       always assigned by the time this runs; the guard exists only because
       TypeScript cannot see that. */
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface PlanOAuthRevocationParams {
  serverUrl: string;
  storage: OAuthStorage;
  /**
   * `false` plans nothing — the deliberate case from #2144, where a user wants
   * to watch a server cope with a client that walks off still holding live
   * tokens.
   */
  enabled?: boolean;
}

export interface ExecuteOAuthRevocationParams {
  fetchFn: typeof fetch;
  timeoutMs?: number;
  logger?: InspectorLogger;
}

/**
 * Everything the revocation requests need, read out of the store **before** the
 * local clear empties it.
 *
 * Split from the sending on purpose. `clearAndPlanRevocation` takes the state
 * and deletes it in one atomic storage step; the requests then go out from this
 * copy, which nothing can invalidate. Revoking first and clearing afterwards
 * would delay the clear by however long the network takes, and a *fresh*
 * authorization completing in that window would be deleted by a clear
 * reasoning about the grant it replaced.
 */
export interface OAuthRevocationPlan {
  serverUrl: string;
  grants: StoredGrant[];
  /** Slots that could not be read; reported beside whatever the rest do. */
  failures: TokenRevocationOutcome[];
  endpoint?: string;
  supportedAuthMethods: string[];
  metadataIssuer?: string;
  /** Set when there is nothing to send, and why. */
  outcome?: TokenRevocationOutcome;
}

/** A plan that sends nothing, carrying the reason. */
function emptyPlan(
  serverUrl: string,
  outcome: TokenRevocationOutcome,
  failures: TokenRevocationOutcome[] = [],
): OAuthRevocationPlan {
  return {
    serverUrl,
    grants: [],
    failures,
    supportedAuthMethods: [],
    outcome:
      failures.length > 0 ? aggregateOutcomes([...failures, outcome]) : outcome,
  };
}

/**
 * Take the server's OAuth state — deleting it — and build the revocation
 * requests from what was taken.
 *
 * The take and the delete are one atomic storage step
 * ({@link OAuthStorage.takeRevocationSnapshot}), which is what closes the
 * check-then-act window: separate reads followed by a separate clear each yield
 * at an `await`, and an OAuth completion landing in one of those gaps would
 * save a fresh grant that the clear then destroyed.
 *
 * The state is cleared **even when revocation is disabled or nothing can be
 * revoked** — clearing is what the caller asked for; the requests are the
 * optional part.
 *
 * Every grant is covered, not just the active issuer's: see
 * {@link collectGrants}. The metadata comes from the cache the OAuth flow
 * already populated rather than from a fresh discovery round-trip — the tokens
 * being revoked were minted by that same authorization server, so its cached
 * document is the one that describes them, and re-discovering would add two
 * network legs to a teardown for no new information.
 */
export async function clearAndPlanRevocation(
  params: PlanOAuthRevocationParams,
): Promise<OAuthRevocationPlan> {
  const { serverUrl, storage } = params;

  let snapshot: RevocationSnapshot;
  try {
    snapshot = await storage.takeRevocationSnapshot(serverUrl);
  } catch (err) {
    // The clear did not happen, and the caller has no other way to learn that.
    throw err instanceof Error ? err : new Error(String(err));
  }

  if (params.enabled === false) {
    return emptyPlan(serverUrl, { status: "skipped", reason: "disabled" });
  }

  try {
    const { grants, failures } = await collectGrants(snapshot);
    if (grants.length === 0) {
      return emptyPlan(
        serverUrl,
        { status: "skipped", reason: "no_tokens" },
        failures,
      );
    }

    const metadata = parseServerMetadata(snapshot.serverMetadata);
    if (!metadata) {
      return emptyPlan(
        serverUrl,
        { status: "skipped", reason: "no_metadata" },
        failures,
      );
    }
    if (!metadata.revocation_endpoint) {
      return emptyPlan(
        serverUrl,
        { status: "skipped", reason: "no_endpoint" },
        failures,
      );
    }

    return {
      serverUrl,
      grants,
      failures,
      endpoint: metadata.revocation_endpoint,
      supportedAuthMethods: revocationAuthMethods(metadata),
      metadataIssuer: metadata.issuer,
    };
  } catch (err) {
    // The state is already gone; a snapshot we cannot interpret is reported,
    // not thrown, because there is nothing left for the caller to retry.
    return emptyPlan(serverUrl, {
      status: "failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * The cached authorization-server metadata from a snapshot.
 *
 * Read structurally rather than schema-parsed: this is a document the SDK's own
 * discovery wrote and the store round-trips as-is, and only two fields are
 * used. A parse failure here would lose an otherwise revocable grant.
 */
function parseServerMetadata(raw: unknown): CachedMetadata | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  return raw as CachedMetadata;
}

/** The three fields revocation reads out of cached AS metadata. */
interface CachedMetadata {
  revocation_endpoint?: string;
  revocation_endpoint_auth_methods_supported?: string[];
  issuer?: string;
}

/**
 * Send the requests a {@link clearAndPlanRevocation} snapshot describes.
 *
 * Safe to run **after** `storage.clear(serverUrl)` — that is the point: the
 * plan already holds the tokens, the credentials and the endpoint, so nothing
 * here reads the store, and the local clear is never waiting on the network.
 *
 * Best-effort throughout: every path returns a {@link TokenRevocationOutcome}
 * rather than throwing, because forgetting the tokens is what the caller
 * actually asked for and no failure on this leg should undo it.
 */
export async function executeOAuthRevocation(
  plan: OAuthRevocationPlan,
  params: ExecuteOAuthRevocationParams,
): Promise<TokenRevocationOutcome> {
  const outcome = await runPlan(plan, params);
  const { logger } = params;
  if (outcome.status === "failed") {
    logger?.warn(
      {
        serverUrl: plan.serverUrl,
        endpoint: outcome.endpoint,
        detail: outcome.detail,
      },
      "Token revocation failed; local OAuth state was cleared anyway",
    );
  } else if (outcome.status === "skipped" && outcome.reason === "no_endpoint") {
    logger?.debug(
      { serverUrl: plan.serverUrl },
      "Skipping token revocation: authorization server metadata has no revocation_endpoint",
    );
  }
  return outcome;
}

/** One revocable grant held for a server, and which AS minted it. */
export interface StoredGrant {
  /** Undefined for the legacy unkeyed slot, which predates issuer binding. */
  issuer?: string;
  token: string;
  tokenTypeHint: "refresh_token" | "access_token";
  /**
   * The credentials to authenticate the revocation request with: the
   * registration bound to this grant's issuer, falling back to the
   * preconfigured (static) one.
   *
   * Deliberately the **reverse** of `BaseOAuthClientProvider.clientInformation`,
   * which prefers the preregistered entry. That order answers "who should I
   * authenticate as *now*"; revocation asks "who minted *this* token", and the
   * two diverge — the store lets a preregistered client and an issuer-bound
   * dynamic registration coexist, so after a server is switched from DCR to a
   * configured `oauth.clientId` an older DCR grant would be revoked with the
   * configured client's credentials. RFC 7009 §2.2 answers 200 for a token the
   * server does not recognise as the caller's, so that reports `revoked` while
   * the grant stays live and the local record is already gone.
   *
   * Best available evidence, not proof: the store records client information
   * per issuer, not per token, so a server that re-registered dynamically under
   * one issuer still cannot say which registration minted which grant. Binding
   * the identity to the token at save time is the real fix and is a
   * storage-shape change.
   */
  clientInformation?: OAuthClientInformation;
}

/** What {@link collectGrants} found, including the slots it could not read. */
interface CollectedGrants {
  grants: StoredGrant[];
  /**
   * One `failed` outcome per slot that could not be parsed. Kept apart from the
   * grants so a single corrupt slot cannot abandon the ones that are still
   * revocable — the state is gone either way, so the failure has to be reported
   * *beside* the successes rather than instead of them.
   */
  failures: TokenRevocationOutcome[];
}

/**
 * Every grant the snapshot took, deduplicated by **issuer and token**.
 *
 * The snapshot is of state that has already been deleted, so this covers every
 * grant the clear removed rather than just the active issuer's: a server that
 * authorized against issuers A and B has two grants here, not one. Otherwise
 * B would be revoked while A's grant stayed live at its authorization server —
 * the same leak this feature closes, one level down.
 *
 * Deduplication is by issuer *and* token because a token means nothing outside
 * the authorization server that minted it: two issuers that happen to mint the
 * same opaque string are two grants, and collapsing them would drop the second
 * before the issuer check could report it.
 *
 * Parsing happens here rather than in the snapshot: it is pure, so it belongs
 * after the mutation — running it inside would reintroduce the `await` the
 * atomic read exists to remove.
 */
async function collectGrants(
  snapshot: RevocationSnapshot,
): Promise<CollectedGrants> {
  const grants: StoredGrant[] = [];
  const failures: TokenRevocationOutcome[] = [];
  const seenKeys = new Set<string>();

  // Parsed defensively: it is only a *fallback*, so a malformed preconfigured
  // registration must not abort grants that carry their own valid credentials.
  // Recorded and skipped, matching the per-slot salvage below.
  let preregistered: OAuthClientInformation | undefined;
  try {
    preregistered = await parseClient(snapshot.preregisteredClientInformation);
  } catch (err) {
    failures.push({
      status: "failed",
      detail: `could not read the preconfigured client registration: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }

  const add = async (
    issuer: string | undefined,
    rawTokens: unknown,
    rawClient: unknown,
  ): Promise<void> => {
    const revocable = selectRevocableToken(await parseTokens(rawTokens));
    if (!revocable) return;

    const key = `${issuer ?? "\u0000legacy"}\u0000${revocable.token}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);

    // The registration bound to THIS grant wins, with the preconfigured entry
    // as the fallback — see the note on `StoredGrant.clientInformation`.
    const bound = await parseClient(rawClient);
    grants.push({
      issuer,
      ...revocable,
      clientInformation: bound ?? preregistered,
    });
  };

  /** Read one slot; a slot that cannot be parsed is reported, not fatal. */
  const addSafely = async (
    issuer: string | undefined,
    rawTokens: unknown,
    rawClient: unknown,
  ): Promise<void> => {
    try {
      await add(issuer, rawTokens, rawClient);
    } catch (err) {
      const where =
        issuer === undefined ? "the unkeyed slot" : `issuer ${issuer}`;
      failures.push({
        status: "failed",
        detail: `could not read the stored grant for ${where}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  };

  for (const [issuer, slot] of Object.entries(snapshot.byIssuer)) {
    await addSafely(issuer, slot?.tokens, slot?.clientInformation);
  }
  await addSafely(
    undefined,
    snapshot.legacyTokens,
    snapshot.legacyClientInformation,
  );
  return { grants, failures };
}

/** Parse stored tokens, or `undefined` when the slot held none. */
async function parseTokens(raw: unknown): Promise<OAuthTokens | undefined> {
  return raw === undefined || raw === null
    ? undefined
    : await OAuthTokensSchema.parseAsync(raw);
}

/** Parse stored client information, or `undefined` when the slot held none. */
async function parseClient(
  raw: unknown,
): Promise<OAuthClientInformation | undefined> {
  return raw === undefined || raw === null
    ? undefined
    : await OAuthClientInformationSchema.parseAsync(raw);
}

/**
 * Combine per-grant outcomes into the one this function reports.
 *
 * A **failure outranks a success**: a grant still live at the authorization
 * server is what the caller needs to surface, and reporting another grant's
 * success would leave that silent. A success outranks a skip for the same
 * reason in the other direction — "revoked" is the more specific truth.
 *
 * Exported for its own test. `computeOutcome` returns early when there are no
 * grants, so the empty case cannot arise from there — which is exactly why the
 * fallback needs testing somewhere: nothing else would ever exercise it, and a
 * function that returns `undefined` while typed otherwise is a trap for the
 * next caller.
 */
export function aggregateOutcomes(
  outcomes: TokenRevocationOutcome[],
): TokenRevocationOutcome {
  return (
    outcomes.find((o) => o.status === "failed") ??
    outcomes.find((o) => o.status === "revoked") ??
    outcomes[0] ?? { status: "skipped", reason: "no_tokens" }
  );
}

/** Send one plan's requests against a single shared deadline. */
async function runPlan(
  plan: OAuthRevocationPlan,
  params: ExecuteOAuthRevocationParams,
): Promise<TokenRevocationOutcome> {
  if (plan.outcome) return plan.outcome;
  const endpoint = plan.endpoint;
  /* v8 ignore next -- `clearAndPlanRevocation` always sets `outcome` when it sets
     no endpoint, so this is unreachable; the guard exists to narrow the type. */
  if (!endpoint) return { status: "skipped", reason: "no_endpoint" };

  const outcomes: TokenRevocationOutcome[] = [...plan.failures];
  // ONE deadline for the whole teardown, not one per grant. `clear` deletes
  // every issuer slot, so a server with N of them would otherwise block for
  // N × the timeout — at which point the "short timeout" bounds a single
  // request and nothing the user experiences. Grants are revoked sequentially
  // on purpose (a burst of parallel requests to one authorization server is
  // not a kindness), so the budget is shared instead.
  const timeoutMs = params.timeoutMs ?? DEFAULT_REVOCATION_TIMEOUT_MS;
  // `performance.now()` rather than `Date.now()`: this is an elapsed-time
  // measurement, and a wall clock can be stepped by NTP or a suspend/resume
  // mid-teardown, which would either expire the budget early or extend it. It is
  // also sub-millisecond, so a budget is not spent or preserved by rounding.
  const deadlineAt = performance.now() + timeoutMs;

  for (const grant of plan.grants) {
    // Metadata is cached once per server, not per issuer, so it describes
    // whichever authorization server was discovered last. Sending another
    // issuer's token to *this* endpoint would disclose a bearer credential to a
    // server that never minted it — worse than not revoking. So an issuer-bound
    // grant must be able to PROVE the endpoint is its own, which means a
    // metadata document carrying no `issuer` is a mismatch rather than a free
    // pass: absence establishes nothing. The same reasoning rules out the
    // unkeyed legacy grant just below — see there.
    if (grant.issuer === undefined) {
      // An unkeyed (pre-SEP-2352) grant records no authorization server at all,
      // and "unknown" is not "whatever the cache currently holds": server-level
      // metadata is a single slot that a later discovery overwrites, while the
      // legacy token survives until the first issuer-stamped save. So the
      // endpoint on hand may belong to an authorization server that never
      // minted this token, and sending it there would disclose a bearer
      // credential to a stranger.
      //
      // Refusing costs such an entry its revocation — which is exactly the
      // behavior it had before this feature existed, so nothing regresses — and
      // it earns revocation back the moment it is re-authorized, since that
      // save is issuer-stamped. Not sending is the only answer that cannot be
      // wrong.
      outcomes.push({
        status: "failed",
        detail:
          "the stored grant is not bound to an authorization server (it predates issuer binding), so it could not be matched to this revocation endpoint and was cleared without revocation — re-authorize to make future clears revocable",
      });
      continue;
    }
    if (plan.metadataIssuer !== grant.issuer) {
      outcomes.push({
        status: "failed",
        detail:
          plan.metadataIssuer === undefined
            ? `the cached authorization-server metadata names no issuer, so the grant bound to ${grant.issuer} could not be matched to this revocation endpoint and was cleared without revocation`
            : `the cached authorization-server metadata is for ${plan.metadataIssuer}, so the grant bound to ${grant.issuer} was cleared without revocation`,
      });
      continue;
    }

    const remainingMs = deadlineAt - performance.now();
    // Not `<= 0`: see MIN_REVOCATION_REQUEST_BUDGET_MS. A budget too small to
    // complete a request is treated as no budget at all.
    if (remainingMs <= MIN_REVOCATION_REQUEST_BUDGET_MS) {
      outcomes.push({
        status: "failed",
        endpoint,
        detail: `the ${timeoutMs}ms revocation budget was exhausted before this grant was attempted${
          grant.issuer === undefined ? "" : ` (issuer ${grant.issuer})`
        }`,
      });
      continue;
    }

    outcomes.push(
      await revokeToken({
        endpoint,
        token: grant.token,
        tokenTypeHint: grant.tokenTypeHint,
        clientInformation: grant.clientInformation,
        supportedAuthMethods: plan.supportedAuthMethods,
        fetchFn: params.fetchFn,
        timeoutMs: remainingMs,
      }),
    );
  }
  return aggregateOutcomes(outcomes);
}
