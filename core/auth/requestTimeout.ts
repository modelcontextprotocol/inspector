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
 * path is a small finite document, so a *clone* of it is drained under the same
 * race and the original — untouched, with every native slot intact — is what
 * the caller gets.
 *
 * Today the common case is bounded, but only incidentally: a discovery stall
 * that happens to sit inside an SDK `initialize` rides that request's own
 * timeout and surfaces after 60s as `Request timed out`. This module makes the
 * bound deliberate, applies it to the stalls that sit *outside* an SDK request
 * too, and — the point of naming the URL in the error — says *which* endpoint
 * stalled instead of blaming the handshake.
 *
 * ## The signal, the proxy hop, and why the race is still here
 *
 * The signal is the primary mechanism and it now reaches all the way out. On a
 * direct fetch (CLI, TUI, backend) it cancels the request outright. In the
 * browser the OAuth fetch is `createRemoteFetch`, which re-issues the call as a
 * POST to `/api/fetch` — and as of #2319 it forwards the signal onto that hop,
 * where the route composes `c.req.raw.signal` into its own outbound fetch. So
 * an abort here tears down the backend's request to the authorization server
 * rather than leaving it running detached, which is what it used to do.
 *
 * The race is kept anyway, and it is not redundant. It bounds what the signal
 * cannot: a `fetchFn` that ignores `AbortSignal` altogether — an injected or
 * test double, or any future transport that drops it the way the proxy used to
 * — and a backend that is itself wedged, where the outbound request is
 * cancelled but the hop back never completes. A deadline that depends on every
 * layer beneath it honouring a signal is not a deadline. Same reasoning, same
 * shape, as `revokeToken`.
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

/**
 * The largest delay `setTimeout` can actually schedule. Past `2 ** 31 - 1` the
 * delay overflows a 32-bit signed integer and Node falls back to **1ms**, so an
 * `Infinity` or an over-large budget produces an *immediate* timeout — the exact
 * opposite of what the caller asked for (Copilot).
 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * Coerce a caller's budget into something `setTimeout` can honour and the error
 * can honestly report.
 *
 * - Non-finite (`NaN`, `±Infinity`) falls back to the default. `NaN` survives
 *   `Math.max(0, Math.round(...))` and `setTimeout(fn, NaN)` fires immediately,
 *   so a caller whose arithmetic produced a `NaN` would otherwise see every
 *   OAuth request fail at once with "timed out after NaNms".
 * - Above `MAX_TIMER_DELAY_MS` it clamps rather than overflowing to 1ms.
 * - Negative clamps to 0, which is a real budget (fire on the next tick), not
 *   an error.
 *
 * Rounded because the budget is *reported* — see the note at the call site.
 */
function normalizeBudget(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs)) return DEFAULT_OAUTH_REQUEST_TIMEOUT_MS;
  return Math.min(MAX_TIMER_DELAY_MS, Math.max(0, Math.round(timeoutMs)));
}

/**
 * How a proxy-side deadline is carried back to the browser (#2319).
 *
 * `/api/fetch` serializes its failures as a JSON error response, and
 * `createRemoteFetch` turns any non-OK answer into a plain `Error` — so a
 * timeout enforced by the *backend* would arrive as an untyped error and the
 * `instanceof OAuthRequestTimeoutError` checks downstream would all be false
 * (Copilot). Both ends run the same budget, so the client's race usually
 * settles first; this matters when the backend's timer wins anyway — most
 * plausibly a backgrounded tab, where the browser throttles `setTimeout` while
 * the server's fires on schedule. Which of two equal deadlines happened to fire
 * must not decide whether the error names its endpoint. So the route stamps
 * this marker and `createRemoteFetch` reconstructs the typed error from it.
 */
export const OAUTH_TIMEOUT_WIRE_CODE = "oauth_request_timeout";

/** The body `/api/fetch` returns when its own deadline fired. */
export interface OAuthRequestTimeoutWire {
  code: typeof OAUTH_TIMEOUT_WIRE_CODE;
  url: string;
  timeoutMs: number;
}

/** Whether a parsed `/api/fetch` error body is a proxy-side deadline. */
export function isOAuthRequestTimeoutWire(
  value: unknown,
): value is OAuthRequestTimeoutWire {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.code === OAUTH_TIMEOUT_WIRE_CODE &&
    typeof candidate.url === "string" &&
    typeof candidate.timeoutMs === "number"
  );
}

/**
 * Build the `isExempt` predicate for a chain that carries MCP traffic as well as
 * OAuth work: it returns true for the MCP endpoint itself.
 *
 * ⚠️ **Fails open, deliberately.** The two errors are not symmetric. Bounding a
 * request that should not be bounded severs a long-running tool call or an SSE
 * stream — a severe, user-visible regression. Failing to bound one leaves the
 * SDK's own per-request timeout as the backstop it has always been. So anything
 * uncertain — no server URL yet, a URL that will not parse, either side — is
 * treated as the MCP endpoint and exempted.
 *
 * The comparison is **as narrow as the transport allows**, which is not the same
 * rule for both of them:
 *
 * - **Streamable HTTP** sends every MCP request to the configured URL, so
 *   `origin + pathname` is exact. Same-origin OAuth work — a protected-resource
 *   document, or an authorization server deployed beside the resource — is a
 *   different path and stays bounded, which is what #2319 asks for (Copilot).
 * - **Legacy SSE** opens the configured URL (`/sse`), is handed a *separate*
 *   message endpoint by the server, and POSTs every JSON-RPC message to that
 *   second pathname. We never see that URL — it arrives inside the stream, in
 *   the SDK's own parser — so a path rule there bounds and body-buffers real
 *   MCP traffic, severing a slow tool call at 30s and reporting it as an
 *   `OAuthRequestTimeoutError`. Origin is the narrowest rule available, and it
 *   is exact rather than approximate: the SDK *enforces* that the message
 *   endpoint shares the stream URL's origin and rejects one that does not.
 *
 * So the residual gap is confined to legacy SSE against a server that also
 * hosts its own OAuth endpoints, where transport-internal OAuth falls back to
 * the SDK's per-request timeout — where it was before #2319. The Inspector's
 * own discovery and token requests to those URLs are bounded regardless, on the
 * OAuth chain.
 *
 * ⚠️ **Fails open** on every uncertainty, and the uncertainties differ by rule:
 * no server URL, an unparseable URL on either side, or *not knowing which
 * transport this is* all resolve to exempt — the last one by falling back to
 * the wider origin rule.
 */
/**
 * Read the transport hint, treating "absent" and "threw" alike as the wide
 * case. A path rule applied to a connection that turns out to be legacy SSE
 * severs real MCP traffic, so every uncertainty resolves toward the origin rule.
 */
function readNegotiatesEndpoint(hint: (() => boolean) | undefined): boolean {
  if (!hint) return true;
  try {
    return hint();
  } catch {
    return true;
  }
}

/**
 * The media type every OAuth token-family request uses — the token exchange,
 * the refresh, and revocation are all `application/x-www-form-urlencoded` per
 * RFC 6749 §4.1.3 and RFC 7009 §2.1. MCP is JSON-RPC over `application/json`
 * and never uses it, which is what makes this a safe discriminator rather than
 * a heuristic.
 */
const OAUTH_FORM_MEDIA_TYPE = "application/x-www-form-urlencoded";

export function exemptMcpEndpoint(
  getServerUrl: () => string | undefined,
  /**
   * Whether the message endpoint is negotiated rather than configured — true
   * for legacy SSE. Read per call, since the transport can change between
   * connects. Absent, or throwing, is treated as `true`.
   */
  negotiatesEndpoint?: () => boolean,
): (url: string, headers: Headers) => boolean {
  return (url, headers) => {
    // A URL match is not by itself proof of MCP traffic. `oauthTokenUrl` takes
    // any absolute URL, so a user may point it at the MCP endpoint's own URL,
    // and the transport-internal refresh then travels this chain to a path the
    // rules below would exempt — leaving the one request this whole change
    // exists to bound running unbounded (Copilot). The token family is
    // form-encoded and MCP never is, so the media type settles it before any
    // URL comparison happens.
    if (
      (headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() ===
      OAUTH_FORM_MEDIA_TYPE
    ) {
      return false;
    }

    // `getServerUrl()` throws for a non-HTTP configuration, and this wrapped
    // fetch can be handed to a transport or a custom factory that calls it
    // anyway — propagating a configuration error out of a fetch would turn the
    // documented fail-open into a hard failure (Copilot). Caught here for the
    // same reason `readNegotiatesEndpoint` catches.
    let serverUrl: string | undefined;
    try {
      serverUrl = getServerUrl();
    } catch {
      return true;
    }
    if (!serverUrl) return true;
    const negotiated = readNegotiatesEndpoint(negotiatesEndpoint);
    try {
      const a = new URL(url);
      const b = new URL(serverUrl);
      if (a.origin !== b.origin) return false;
      return negotiated || a.pathname === b.pathname;
    } catch {
      return true;
    }
  };
}

/**
 * The deadline a wrapped call is running under, keyed by the exact `RequestInit`
 * the wrapper handed down (#2319).
 *
 * This is how the budget crosses the proxy hop without travelling *upstream*.
 * `/api/fetch` must not time every request it serves — `createRemoteFetch` also
 * carries MCP traffic, and a Streamable HTTP tool call can legitimately withhold
 * its response headers for minutes — so the route needs to know which requests
 * are bounded and which are not (Copilot). A header would be the obvious
 * carrier and is the wrong one: `serializeRequest` copies request headers
 * verbatim into the payload and the route re-sends them to the authorization
 * server, so a marker header would leak to a third party.
 *
 * A `WeakMap` keyed on the init object has neither problem. It is invisible to
 * serialization, it needs no cast onto `RequestInit`, and it is collected with
 * the object — the wrapper builds a fresh init per call, so there is one entry
 * per in-flight request and nothing accumulates.
 */
const REQUEST_DEADLINES = new WeakMap<object, number>();

/**
 * The deadline `withOAuthRequestTimeout` stamped on this init, if any.
 *
 * `undefined` means the request is not bounded by this wrapper and must not be
 * bounded by anything downstream either — an exempt MCP request reads as
 * `undefined` because the exempt path never builds an init of its own.
 */
export function deadlineForRequestInit(
  init: RequestInit | undefined,
): number | undefined {
  return init ? REQUEST_DEADLINES.get(init) : undefined;
}

/**
 * The request's headers, whatever form `fetch`'s arguments took. `init` wins
 * over a `Request`'s own, matching `fetch`.
 */
function requestHeadersOf(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Headers {
  if (init?.headers) return new Headers(init.headers);
  if (typeof input !== "string" && !(input instanceof URL)) {
    return new Headers(input.headers);
  }
  return new Headers();
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
 * An `init.signal` still wins, but only when it is not `undefined`. `RequestInit`
 * is a WebIDL dictionary, where a member present with the value `undefined` is
 * converted as *absent* — so `{ ...base, signal: undefined }`, which is what a
 * spread over an options object that had no signal produces, must inherit the
 * `Request`'s signal rather than clear it (Copilot). An explicit `null` is the
 * genuine "no signal" override and is honoured as one.
 */
export function callerSignalOf(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): AbortSignal | undefined {
  const explicit = init?.signal;
  if (explicit !== undefined) return explicit ?? undefined;
  if (typeof input !== "string" && !(input instanceof URL)) return input.signal;
  return undefined;
}

/**
 * Wrap a `fetch` so every call through it is bounded by `timeoutMs`.
 *
 * Every request that reaches it unexempted is bounded — so on a chain that
 * carries anything other than OAuth work, `isExempt` is not optional. A
 * Streamable HTTP or SSE response is a long-lived stream that is *supposed* to
 * stay open, and a Streamable HTTP POST for a long-running tool call
 * legitimately withholds its response headers for minutes; a deadline over
 * either severs a working connection. `InspectorClient` uses the wrapper on
 * both of its chains and the two differ only in this: the OAuth chain passes no
 * predicate because every request on it is OAuth work, while the transport
 * chain passes `exemptMcpEndpoint`.
 *
 * `isExempt` receives the request's URL **and headers**, because a URL alone
 * cannot always tell the two kinds of traffic apart — see `exemptMcpEndpoint`.
 *
 * `isExempt` lets one wrapped fetch serve a mixed chain. It is how the
 * *transport* fetch can be bounded at all: that chain carries both the SDK's
 * OAuth work and the MCP traffic itself, and the MCP traffic must not be
 * timed — a Streamable HTTP POST for a long-running tool call legitimately
 * withholds its response headers for minutes, and an SSE body stays open
 * indefinitely. So `InspectorClient` exempts the MCP endpoint by URL and bounds
 * everything else on that chain, and **fails open**: if the server URL cannot
 * be determined or parsed, everything is exempt. Bounding a request that should
 * not be bounded breaks a working tool call; failing to bound one leaves the
 * SDK's own per-request timeout as the backstop it already was.
 *
 * A caller's own signal is preserved — whether it arrived in `init` or embedded
 * in a `Request` — and is both forwarded to the inner fetch (composed with
 * `AbortSignal.any`) and raced here, so an outer cancellation still wins even on
 * a fetch that drops the signal. This wrapper only ever *adds* a reason to give
 * up; it never removes the caller's.
 *
 * The response **body** is drained through a clone under the same deadline,
 * because `fetch` resolves on headers and a stalled body would otherwise be
 * unbounded. The caller receives the original response, not a copy.
 */
export function withOAuthRequestTimeout(
  fetchFn: typeof fetch,
  timeoutMs: number = DEFAULT_OAUTH_REQUEST_TIMEOUT_MS,
  isExempt?: (url: string, headers: Headers) => boolean,
): typeof fetch {
  // Whole milliseconds. Not for the reason `revocation.ts:253` gives — that one
  // calls `AbortSignal.timeout`, which really does throw `ERR_OUT_OF_RANGE` on
  // a fractional delay (verified on Node 26) and so would fail before the
  // request was sent. This wrapper drives its deadline with `setTimeout` and an
  // `AbortController`, and `setTimeout` accepts a fractional delay and
  // truncates it, so nothing here would throw (Copilot).
  //
  // The real reason is that the budget is *reported*: it is interpolated into
  // the timeout message and exposed as `OAuthRequestTimeoutError.timeoutMs`. A
  // caller whose budget came from a `performance.now()` subtraction would
  // otherwise produce "timed out after 1000.4000000953674ms" and a non-integer
  // public field. Rounding rather than flooring so a caller's own
  // whole-millisecond timeout survives the trip through that clock and is still
  // the number the message names.
  const budget = normalizeBudget(timeoutMs);

  return async (input, init) => {
    const url = requestUrlOf(input);
    // An exempt request is passed through completely untouched — no deadline,
    // no signal of ours, and crucially no body buffering, since the responses
    // this exists for are streams that must stay open (see `isExempt` above).
    if (isExempt?.(url, requestHeadersOf(input, init))) {
      return fetchFn(input, init);
    }

    const controller = new AbortController();
    const callerSignal = callerSignalOf(input, init);
    // Before anything is constructed or sent. Racing an already-aborted signal
    // would still evaluate `fetchFn(...)`, and a `fetchFn` that does not check
    // an already-aborted signal — the proxy hop was one until #2319 — would
    // send the OAuth request even though the caller cancelled before the call
    // (Copilot).
    if (callerSignal?.aborted) throw callerSignal.reason;

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
        // Abort first, which is what actually cancels the request — through
        // the proxy hop too, since #2319 — then reject, so a `fetchFn` that
        // ignores the signal is still abandoned on schedule.
        controller.abort(new OAuthRequestTimeoutError(url, budget));
        reject(new OAuthRequestTimeoutError(url, budget));
      }, budget);

      // The caller's cancellation is raced too, not merely forwarded. Forwarding
      // it is enough wherever the signal is honoured, but a `fetchFn` that
      // ignores it would otherwise leave this promise pending for the whole
      // budget instead of the outer cancellation winning as documented
      // (Copilot). The caller's own `reason` is preserved, so it still sees its
      // abort rather than a substituted error.
      // Not aborted — the short-circuit above returned for that case.
      if (callerSignal) {
        onCallerAbort = () => reject(callerSignal.reason);
        callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      }
    });

    // Built once and stamped, so `createRemoteFetch` can read the budget off it
    // and tell `/api/fetch` this particular request is bounded.
    const nextInit: RequestInit = { ...init, signal };
    REQUEST_DEADLINES.set(nextInit, budget);

    try {
      const response = await Promise.race([
        fetchFn(input, nextInit),
        abandoned,
      ]);
      // `fetch` resolves once the response *headers* arrive, so stopping here
      // would leave the body unbounded: an authorization server can send
      // headers, or half a JSON document, and then stall, and the caller's
      // `response.json()` would hang with nothing watching it (Copilot). Every
      // response on this path is a small, finite document — metadata,
      // a registration, a token — so buffering it under the same deadline
      // bounds the whole exchange. It is also the second reason `isExempt` is
      // not optional on a mixed chain: an exempt request skips this buffering
      // entirely, which is what lets an SSE body stay open rather than being
      // drained into memory here.
      // Read a *clone* under the deadline and hand back the original. Cloning
      // tees the body, so draining one branch buffers the other: by the time
      // this resolves the original is fully in memory and the caller reads it
      // without touching the network again — the bound is the same, and the
      // response the caller gets is the one `fetch` produced.
      //
      // The alternative, rebuilding a `Response` around the buffered bytes,
      // could never be faithful (Copilot). `url`, `redirected` and `type` are
      // internal slots; shadowing them as own properties satisfies a direct
      // read and is lost again the moment a caller calls `clone()`, which
      // returns a fresh native `Response`. The headers guard differs too, and
      // the decoded bytes made the inherited `content-encoding` and
      // `content-length` wrong, so those had to be stripped — a rebuilt
      // response was observably not the original in at least four ways. Not
      // rebuilding removes the whole class.
      await Promise.race([response.clone().arrayBuffer(), abandoned]);
      return response;
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
