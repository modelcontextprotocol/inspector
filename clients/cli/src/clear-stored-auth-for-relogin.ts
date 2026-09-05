import {
  NodeOAuthStorage,
  resetNodeOAuthStorageCache,
} from "@inspector/core/auth/node/storage-node.js";
import {
  DEFAULT_REVOCATION_TIMEOUT_MS,
  MIN_REVOCATION_REQUEST_BUDGET_MS,
  clearAndPlanRevocation,
  executeOAuthRevocation,
  type OAuthRevocationPlan,
  type TokenRevocationOutcome,
} from "@inspector/core/auth/revocation.js";
import { createProxyFetch } from "@inspector/core/mcp/node/proxyFetch.js";

/** Same canonicalisation as CLI `normalizeServerUrl` (avoid cycles). */
function normalizeServerUrl(serverUrl: string): string {
  try {
    return new URL(serverUrl).href;
  } catch {
    return serverUrl;
  }
}

/**
 * Delete stored OAuth state for an HTTP(S) server URL from the shared store
 * (`--relogin`) so the next connect cannot silently reuse tokens. This removes
 * the store entry (not a per-run ignore). No-op when `serverUrl` is missing.
 *
 * Clears **both** the raw URL and the `new URL().href`-normalised form. Runtime
 * OAuth storage is keyed by the transport's raw `url` string, while some writers
 * (and earlier clear paths) use the normalised key — mirroring
 * `findStoredServerState` in `cli.ts`, which already tries both on read.
 */
export async function clearStoredAuthForRelogin(
  serverUrl: string | undefined,
  options?: {
    revoke?: boolean;
    /**
     * Total wall-clock budget for the revocation requests across both key
     * spellings. Defaults to {@link DEFAULT_REVOCATION_TIMEOUT_MS}; injectable
     * so the exhaustion path can be exercised without a five-second test.
     */
    budgetMs?: number;
  },
): Promise<TokenRevocationOutcome | undefined> {
  if (!serverUrl?.trim()) return undefined;
  const raw = serverUrl.trim();
  const normalized = normalizeServerUrl(raw);
  const storage = new NodeOAuthStorage();
  // RFC 7009 (#2144), ordered snapshot -> clear -> revoke. Everything the
  // requests need is read first, because the clear empties the store; but the
  // clear then runs immediately rather than behind the network. Waiting would
  // hold this process's in-memory view of a *shared*, file-backed store for up
  // to five seconds, and another CLI/TUI writing a fresh grant in that window
  // would be erased by the clear that followed.
  //
  // Both spellings are cleared, so both are planned from — a stale entry under
  // the other key is a live grant at the authorization server, and deleting it
  // locally without revoking is exactly the leak this closes. The normalised
  // key goes first because that is the precedence `findStoredServerState` reads
  // with, so the grant actually in use is the one whose outcome is reported.
  // They are deliberately not deduplicated; see `sendPlans`.
  const keys = normalized === raw ? [raw] : [normalized, raw];
  // Each key's state is taken and deleted in ONE atomic storage step, so the
  // clear is never a separate check-then-act over an already-read snapshot.
  const plans: OAuthRevocationPlan[] = [];
  for (const key of keys) {
    plans.push(
      await clearAndPlanRevocation({
        serverUrl: key,
        storage,
        enabled: options?.revoke !== false,
      }),
    );
  }
  // Drop the in-process singleton so the next connect cannot reuse a cleared
  // entry from the NodeOAuthStorage cache.
  resetNodeOAuthStorageCache();

  return options?.revoke === false
    ? undefined
    : sendPlans(plans, options?.budgetMs ?? DEFAULT_REVOCATION_TIMEOUT_MS);
}

/**
 * Send each plan's requests, in order, and report the outcome that matters most.
 *
 * Both key spellings are cleared, so both are planned from: a stale entry under
 * the other spelling is still a live grant at the authorization server, and
 * deleting it locally without revoking is the leak this whole change closes.
 *
 * There is deliberately **no** cross-key deduplication. It looked cheap — the
 * two keys are usually two spellings of one server — but it can only be done by
 * pre-reading a single token, and a plan enumerates every issuer slot under a
 * key. So a shared *active* token would have skipped the second key entirely,
 * taking any additional issuer-bound grant under it with the local delete. A
 * duplicate RFC 7009 request is harmless (§2.2 makes an unknown token a
 * success), which is a much better trade than a missed one.
 *
 * One budget across both plans, for the same reason a plan shares one across
 * its grants: two keys would otherwise double the wait.
 *
 * Reporting prefers a **failure** over any success — a grant still live at the
 * authorization server is what the user needs to hear about, and a success
 * would otherwise silence the warning. Failing that it is the first plan's
 * outcome that was not "nothing to do", which with the keys in
 * `findStoredServerState` precedence means the grant the CLI would actually
 * have connected with. When no key held a token, the last "nothing to do"
 * answer is returned so the caller can still tell "no tokens" from "this
 * authorization server advertises no revocation endpoint".
 */
async function sendPlans(
  plans: OAuthRevocationPlan[],
  budgetMs: number,
): Promise<TokenRevocationOutcome | undefined> {
  const fetchFn = createProxyFetch() ?? fetch;
  // Monotonic and epsilon-floored for the same reasons as the shared deadline
  // inside `executeOAuthRevocation` — see MIN_REVOCATION_REQUEST_BUDGET_MS.
  const deadlineAt = performance.now() + budgetMs;
  let reported: TokenRevocationOutcome | undefined;
  let lastSkip: TokenRevocationOutcome | undefined;
  for (const plan of plans) {
    const remainingMs = deadlineAt - performance.now();
    // A plan that already knows its answer needs no network, so the budget is
    // irrelevant to it. Synthesising exhaustion here would warn that a grant
    // may still be live when the key held no grant at all — a false alarm, and
    // one that outranks the real outcome under the failure-first rule below.
    const needsNetwork = plan.outcome === undefined;
    if (needsNetwork && remainingMs <= MIN_REVOCATION_REQUEST_BUDGET_MS) {
      // Overrides an earlier success rather than deferring to it: this key's
      // grant may still be live at the authorization server, and that is the
      // thing the user needs to hear about. Same failure-first rule as below.
      const exhausted: TokenRevocationOutcome = {
        status: "failed",
        detail: `the ${budgetMs}ms revocation budget was exhausted before "${plan.serverUrl}" was attempted`,
      };
      if (reported?.status !== "failed") reported = exhausted;
      continue;
    }
    const outcome = await executeOAuthRevocation(plan, {
      fetchFn,
      timeoutMs: needsNetwork ? remainingMs : undefined,
    });
    if (outcome.status === "skipped" && outcome.reason === "no_tokens") {
      lastSkip = outcome;
      continue;
    }
    if (outcome.status === "failed") {
      if (reported?.status !== "failed") reported = outcome;
    } else {
      reported ??= outcome;
    }
  }
  return reported ?? lastSkip;
}
