/**
 * A bound on every network call the Inspector makes on the OAuth path (#2319).
 *
 * ## Why this exists
 *
 * Protected-resource-metadata discovery, authorization-server metadata
 * discovery, dynamic client registration, the token exchange and the refresh
 * all went out with no `AbortSignal` at all. Token revocation was the single
 * exception — `revocation.ts` has carried its own deadline since #2144, and it
 * is the pattern this module generalizes.
 *
 * An unbounded fetch matters more here than it usually would, because of where
 * this work runs and what the UI does while it runs:
 *
 * - It runs **server-side**, in the Inspector's own Node process, proxied
 *   through the backend. A stall is therefore invisible in browser devtools —
 *   #2188's reporter correctly observed that no request left the browser at
 *   all while a Node-side socket sat established and idle.
 * - Connect-time auth errors deliberately hold the connection status at
 *   `"connecting"` rather than moving it to `"error"`
 *   (`isConnectAuthRecoveryError`, `challenge.ts`), on the theory that a
 *   redirect is about to end the attempt. A stalled fetch inside that window is
 *   a silent, unbounded spinner rather than a surfaced failure.
 *
 * The deadline covers the **whole exchange**, not just the headers: `fetch`
 * resolves as soon as response headers arrive, so a server that sends headers
 * — or half a JSON document — and then stalls would leave the caller's
 * `response.json()` hanging with nothing watching it. Every response on this
 * path is a small finite document, so the body is buffered under the same race
 * and the response rebuilt around it.
 *
 * Today the common case is bounded, but only incidentally: a discovery stall
 * that happens to sit inside an SDK `initialize` rides that request's own
 * timeout and surfaces after 60s as `Request timed out`. This module makes the
 * bound deliberate, applies it to the stalls that sit *outside* an SDK request
 * too, and — the point of naming the URL in the error — says *which* endpoint
 * stalled instead of blaming the handshake.
 *
 * ## Why a race, and not just the signal
 *
 * The signal alone cannot enforce this. In the browser the OAuth fetch is
 * `createRemoteFetch`, which re-issues the call as a POST to `/api/fetch` and
 * does not forward `init.signal`; the backend's outbound fetch gets no signal
 * either. So on exactly the path this bound exists for — a browser session
 * against a wedged authorization server — aborting the local promise would
 * change nothing. The race is what actually enforces the deadline; the signal
 * is kept because it does cancel the direct-fetch paths (CLI, TUI, backend)
 * rather than merely abandoning them. Same reasoning, same shape, as
 * `revokeToken`.
 */

/**
 * 30 seconds. Deliberately generous: discovery against a slow or cold-starting
 * authorization server is legitimate, and a bound that fires on a server that
 * was going to answer is worse than the unbounded wait it replaced. It still
 * halves the 60s the SDK handshake incidentally provides, and it is the only
 * bound at all on the legs that sit outside an SDK request.
 */
export const DEFAULT_OAUTH_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Raised when an OAuth-path request outlives its budget.
 *
 * Carries the URL because "discovery timed out" without one is only marginally
 * better than a spinner: the OAuth path makes several requests to several
 * hosts, and which of them stalled is the whole diagnostic.
 */
export class OAuthRequestTimeoutError extends Error {
  readonly url: string;
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`OAuth request to ${url} timed out after ${timeoutMs}ms`);
    this.name = "OAuthRequestTimeoutError";
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

/** The request URL, whatever form `fetch`'s first argument took. */
function requestUrlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * The caller's own `AbortSignal`, if it supplied one.
 *
 * A `Request` carries its signal on the *input*, not in `init`, and this
 * wrapper always passes a `signal` of its own in `init` — so reading `init`
 * alone would silently override the embedded one and change ordinary `fetch`
 * cancellation semantics for `withOAuthRequestTimeout(new Request(url, { signal }))`
 * (Copilot).
 *
 * `init.signal` still wins whenever the key is *present*, per the fetch spec:
 * an explicit `null` there means "no signal" even when `input` is a `Request`
 * that has one.
 */
function callerSignalOf(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): AbortSignal | undefined {
  if (init && "signal" in init) return init.signal ?? undefined;
  if (typeof input !== "string" && !(input instanceof URL)) return input.signal;
  return undefined;
}

/**
 * Statuses the Fetch Standard defines as null-body. Handing the `Response`
 * constructor a body with one of these throws a `TypeError`, so the rebuilt
 * response below must pass `null` instead.
 */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * Rebuild a `Response` around an already-buffered body.
 *
 * `url`, `redirected` and `type` are getters with no constructor option, and
 * callers do read them — the RFC 8414/OIDC compat wrapper stamps a header
 * naming the URL a body came from, and the SDK's discovery reports the
 * responding URL in its errors. So they are copied across explicitly rather
 * than silently reset to `""` / `false` / `"default"`.
 */
function rebuildResponse(response: Response, body: ArrayBuffer): Response {
  const rebuilt = new Response(
    NULL_BODY_STATUSES.has(response.status) ? null : body,
    {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    },
  );
  for (const key of ["url", "redirected", "type"] as const) {
    Object.defineProperty(rebuilt, key, {
      value: response[key],
      enumerable: true,
      configurable: true,
    });
  }
  return rebuilt;
}

/**
 * Wrap a `fetch` so every call through it is bounded by `timeoutMs`.
 *
 * Apply this to an **OAuth-path** fetch only. It must never wrap the transport
 * fetch: a Streamable HTTP or SSE response is a long-lived stream that is
 * *supposed* to stay open, and a deadline there would sever every connection
 * after the budget. `InspectorClient` keeps the two apart by wrapping inside
 * `buildEffectiveAuthFetch` rather than wrapping `this.fetchFn`, which the
 * transport is handed directly.
 *
 * A caller's own signal is preserved — whether it arrived in `init` or embedded
 * in a `Request` — and is both forwarded to the inner fetch (composed with
 * `AbortSignal.any`) and raced here, so an outer cancellation still wins even on
 * a fetch that drops the signal. This wrapper only ever *adds* a reason to give
 * up; it never removes the caller's.
 *
 * The response **body** is buffered under the same deadline, because `fetch`
 * resolves on headers and a stalled body would otherwise be unbounded.
 */
export function withOAuthRequestTimeout(
  fetchFn: typeof fetch,
  timeoutMs: number = DEFAULT_OAUTH_REQUEST_TIMEOUT_MS,
): typeof fetch {
  // Whole milliseconds, because `setTimeout` and `AbortSignal.timeout` both
  // take an integer: Node throws `ERR_OUT_OF_RANGE` on a fractional delay —
  // before the fetch, so the request is never sent and the caller sees a failed
  // operation rather than a timeout. A budget derived from `performance.now()`
  // is fractional, so this is reachable. `revocation.ts:253` carries the same
  // note for the same reason.
  const budget = Math.max(0, Math.round(timeoutMs));

  return async (input, init) => {
    const url = requestUrlOf(input);
    const controller = new AbortController();
    const callerSignal = callerSignalOf(input, init);
    const signal = callerSignal
      ? AbortSignal.any([controller.signal, callerSignal])
      : controller.signal;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let onCallerAbort: (() => void) | undefined;

    // The losing side of every race below: it rejects when the budget runs out,
    // and when the caller cancels.
    const abandoned = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        // Abort first so a direct fetch is actually cancelled rather than left
        // running detached, then reject so the proxied fetch — which never saw
        // the signal — is abandoned on schedule too.
        controller.abort(new OAuthRequestTimeoutError(url, budget));
        reject(new OAuthRequestTimeoutError(url, budget));
      }, budget);

      // The caller's cancellation is raced too, not merely forwarded. Forwarding
      // it is enough on a direct fetch, but on the browser's `createRemoteFetch`
      // path — the one this wrapper exists for — the signal is dropped in
      // flight, so an abort would otherwise leave this promise pending for the
      // whole budget instead of the outer cancellation winning as documented
      // (Copilot). The caller's own `reason` is preserved, so it still sees its
      // abort rather than a substituted error.
      if (callerSignal) {
        if (callerSignal.aborted) {
          reject(callerSignal.reason);
        } else {
          onCallerAbort = () => reject(callerSignal.reason);
          callerSignal.addEventListener("abort", onCallerAbort, { once: true });
        }
      }
    });

    try {
      const response = await Promise.race([
        fetchFn(input, { ...init, signal }),
        abandoned,
      ]);
      // `fetch` resolves once the response *headers* arrive, so stopping here
      // would leave the body unbounded: an authorization server can send
      // headers, or half a JSON document, and then stall, and the caller's
      // `response.json()` would hang with nothing watching it (Copilot). Every
      // response on this path is a small, finite document — metadata,
      // a registration, a token — so buffering it under the same deadline
      // bounds the whole exchange. This is the other reason the wrapper must
      // never be applied to the transport fetch, whose bodies are streams that
      // are supposed to stay open.
      const body = await Promise.race([response.arrayBuffer(), abandoned]);
      return rebuildResponse(response, body);
    } catch (err) {
      // `controller.abort()` above can reject the underlying fetch *before*
      // `reject` runs, in which case the race settles with undici's
      // `AbortError` instead of ours. Which of the two wins is an ordering
      // detail of the fetch implementation, so normalize on the flag rather
      // than on the error that surfaced: a timeout must always be reported as
      // one, naming the endpoint. A caller-driven abort leaves the flag false
      // and so passes through with its own reason intact.
      if (timedOut) throw new OAuthRequestTimeoutError(url, budget);
      throw err;
    } finally {
      /* v8 ignore next -- the Promise executor runs synchronously, so `timer`
         is always assigned by the time this runs; the guard exists only because
         TypeScript cannot see that. */
      if (timer !== undefined) clearTimeout(timer);
      // Drop the listener even though it is `once`: a caller signal can outlive
      // this request (one `AbortController` per connect attempt, several
      // requests through it), and a listener per request would accumulate on it.
      if (onCallerAbort && callerSignal) {
        callerSignal.removeEventListener("abort", onCallerAbort);
      }
    }
  };
}
