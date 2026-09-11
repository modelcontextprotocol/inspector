/**
 * Unit coverage for `withOAuthRequestTimeout` (#2319) — the deadline every
 * OAuth-path request runs under.
 *
 * What is pinned here, and why each case exists rather than being obvious:
 *
 * - **The bound itself**, including the *body*: `fetch` resolves on headers, so
 *   a server that sends them and then stalls has to be caught by the buffering
 *   race, not by the fetch promise.
 * - **The response's identity.** The bound drains a *clone* and hands back the
 *   original, so the cases assert identity, that the body is still readable
 *   after the drain, and that a caller's own `clone()` keeps its metadata —
 *   the property a rebuilt response could not have, since `url` / `redirected`
 *   / `type` are internal slots.
 * - **Cancellation semantics.** The caller's signal is forwarded *and* raced,
 *   so the tests distinguish the two: one uses a fetch that honours the signal,
 *   another uses one that ignores it entirely.
 * - **Composition with `withRfc8414OidcCompat`**, written as a contrast between
 *   the two orderings. It is the ordering that is under test, not one
 *   arrangement's behaviour, so the wrong one is asserted to misattribute.
 *
 * Fake timers throughout: every budget here is exercised by advancing the clock
 * rather than by waiting, so the suite costs milliseconds.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DEFAULT_OAUTH_REQUEST_TIMEOUT_MS,
  OAuthRequestTimeoutError,
  deadlineForRequestInit,
  exemptMcpEndpoint,
  withOAuthRequestTimeout,
} from "@inspector/core/auth/requestTimeout.js";
import { withRfc8414OidcCompat } from "@inspector/core/auth/oidcDiscoveryCompat.js";

const URL_UNDER_TEST =
  "https://as.example.com/.well-known/oauth-authorization-server";

/** A fetch that never settles — the wedged authorization server of #2319. */
const neverSettles: typeof fetch = () => new Promise<Response>(() => {});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("withOAuthRequestTimeout", () => {
  it("passes a prompt response through", async () => {
    // The same object: the body is drained through a clone under the deadline
    // (see the stalled-body case below), so nothing about the response the
    // caller receives changes.
    const inner = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const wrapped = withOAuthRequestTimeout(inner, 1000);

    const response = await wrapped(URL_UNDER_TEST);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("rejects a stalled request with an error naming the endpoint", async () => {
    vi.useFakeTimers();
    const wrapped = withOAuthRequestTimeout(neverSettles, 1000);

    const pending = wrapped(URL_UNDER_TEST);
    const assertion = expect(pending).rejects.toThrow(
      `OAuth request to ${URL_UNDER_TEST} timed out after 1000ms`,
    );
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("reports the timeout as OAuthRequestTimeoutError carrying url and budget", async () => {
    vi.useFakeTimers();
    const wrapped = withOAuthRequestTimeout(neverSettles, 1000);

    const pending = wrapped(new URL(URL_UNDER_TEST));
    const assertion = pending.catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(1000);
    const err = await assertion;

    expect(err).toBeInstanceOf(OAuthRequestTimeoutError);
    const timeout = err as OAuthRequestTimeoutError;
    expect(timeout.name).toBe("OAuthRequestTimeoutError");
    expect(timeout.url).toBe(URL_UNDER_TEST);
    expect(timeout.timeoutMs).toBe(1000);
  });

  it("redacts sensitive query values from the endpoint it names", async () => {
    vi.useFakeTimers();
    // This message is recorded verbatim by `createFetchTracker` into the
    // Network log and the persisted session, and an OAuth endpoint's query
    // string can carry a `code`, an `access_token` or a `client_secret` —
    // which `fetchTracking` already redacts everywhere else it records a URL.
    const sensitive =
      "https://as.example.com/token?code=abc123&client_secret=shhh&state=keepme";
    const wrapped = withOAuthRequestTimeout(neverSettles, 1000);

    const assertion = wrapped(sensitive).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(1000);
    const err = (await assertion) as OAuthRequestTimeoutError;

    for (const secret of ["abc123", "shhh"]) {
      expect(err.message).not.toContain(secret);
      expect(err.url).not.toContain(secret);
    }
    // Still identifiable, which was the point of naming the endpoint: the path
    // and every non-sensitive parameter survive. Read through `URL`, since
    // `URLSearchParams.toString()` percent-encodes the redaction marker.
    const redacted = new URL(err.url);
    expect(redacted.origin + redacted.pathname).toBe(
      "https://as.example.com/token",
    );
    expect(redacted.searchParams.get("state")).toBe("keepme");
    expect(redacted.searchParams.get("code")).toBe("[REDACTED]");
    expect(redacted.searchParams.get("client_secret")).toBe("[REDACTED]");
  });

  it("takes the URL off a Request object too", async () => {
    vi.useFakeTimers();
    const wrapped = withOAuthRequestTimeout(neverSettles, 1000);

    const pending = wrapped(new Request(URL_UNDER_TEST, { method: "POST" }));
    const assertion = pending.catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(1000);

    expect((await assertion) as OAuthRequestTimeoutError).toMatchObject({
      url: URL_UNDER_TEST,
    });
  });

  it("aborts the underlying fetch rather than leaving it running detached", async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    const inner: typeof fetch = (_input, init) => {
      seen = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted by signal")),
        );
      });
    };
    const wrapped = withOAuthRequestTimeout(inner, 1000);

    const assertion = wrapped(URL_UNDER_TEST).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(1000);

    expect(seen?.aborted).toBe(true);
    // The underlying rejection can win the race against our own; either way the
    // caller must be told it was a timeout, and which endpoint stalled.
    expect((await assertion) as Error).toBeInstanceOf(OAuthRequestTimeoutError);
  });

  it("still enforces the deadline when the fetch ignores the signal", async () => {
    vi.useFakeTimers();
    // The signal now reaches all the way out — `createRemoteFetch` forwards it
    // onto the proxy hop and `/api/fetch` composes it into its outbound call —
    // but a `fetchFn` that ignores `AbortSignal` cancels nothing, so the race
    // is what bounds this case.
    const signalIgnoring: typeof fetch = () => new Promise<Response>(() => {});
    const wrapped = withOAuthRequestTimeout(signalIgnoring, 1000);

    const assertion = wrapped(URL_UNDER_TEST).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(1000);

    expect((await assertion) as Error).toBeInstanceOf(OAuthRequestTimeoutError);
  });

  it("forwards a caller-supplied signal to the inner fetch", async () => {
    const inner: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("caller cancelled")),
        );
      });
    const wrapped = withOAuthRequestTimeout(inner, 60_000);

    const caller = new AbortController();
    const pending = wrapped(URL_UNDER_TEST, { signal: caller.signal });
    caller.abort();

    await expect(pending).rejects.toThrow("caller cancelled");
  });

  it("races caller cancellation too, so it wins on a signal-ignoring fetch", async () => {
    // Forwarding alone is not enough against a `fetchFn` that ignores the
    // signal: without the race the caller's abort would sit pending for the
    // whole budget instead of winning.
    const wrapped = withOAuthRequestTimeout(neverSettles, 60_000);

    const caller = new AbortController();
    const pending = wrapped(URL_UNDER_TEST, { signal: caller.signal });
    const reason = new Error("caller gave up");
    caller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it("rejects an already-aborted signal without sending the request", async () => {
    const inner = vi.fn<typeof fetch>(neverSettles);
    const wrapped = withOAuthRequestTimeout(inner, 60_000);
    const reason = new Error("already gone");

    await expect(
      wrapped(URL_UNDER_TEST, { signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
    // Racing it would still have evaluated the inner fetch, and a fetch that
    // does not check an already-aborted signal would send the request.
    expect(inner).not.toHaveBeenCalled();
  });

  it("treats an undefined init.signal as absent, keeping a Request's own", async () => {
    // `RequestInit` is a WebIDL dictionary: a member present as `undefined` is
    // converted as absent. `{ ...base, signal: undefined }` is what a spread
    // over an options object with no signal produces.
    const wrapped = withOAuthRequestTimeout(neverSettles, 60_000);

    const caller = new AbortController();
    const pending = wrapped(
      new Request(URL_UNDER_TEST, { signal: caller.signal }),
      { signal: undefined },
    );
    const reason = new Error("request cancelled");
    caller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it("honours the signal embedded in a Request input", async () => {
    // `init.signal` is absent here, so the Request's own signal is the caller's
    // — reading `init` alone would silently override it.
    const wrapped = withOAuthRequestTimeout(neverSettles, 60_000);

    const caller = new AbortController();
    const pending = wrapped(
      new Request(URL_UNDER_TEST, { signal: caller.signal }),
    );
    const reason = new Error("request cancelled");
    caller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it("lets an explicit null init.signal override a Request's own", async () => {
    vi.useFakeTimers();
    // Per the fetch spec a present `signal` key wins, `null` included.
    const wrapped = withOAuthRequestTimeout(neverSettles, 1000);

    const caller = new AbortController();
    const pending = wrapped(
      new Request(URL_UNDER_TEST, { signal: caller.signal }),
      { signal: null },
    );
    const assertion = pending.catch((err: unknown) => err);
    caller.abort(new Error("ignored"));
    await vi.advanceTimersByTimeAsync(1000);

    expect((await assertion) as Error).toBeInstanceOf(OAuthRequestTimeoutError);
  });

  it("removes its abort listener once the request settles", async () => {
    const caller = new AbortController();
    const removeSpy = vi.spyOn(caller.signal, "removeEventListener");
    const wrapped = withOAuthRequestTimeout(
      vi.fn<typeof fetch>().mockResolvedValue(new Response("{}")),
      60_000,
    );

    await wrapped(URL_UNDER_TEST, { signal: caller.signal });

    // A caller signal outlives one request — one connect attempt makes several
    // — so a listener left behind per request would accumulate on it.
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("bounds a stalled response body, not just the headers", async () => {
    vi.useFakeTimers();
    // `fetch` resolves on headers. A server that sends them and then stalls
    // would leave the caller's `response.json()` hanging unwatched.
    const stalledBody: typeof fetch = () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(ctrl) {
              ctrl.enqueue(new TextEncoder().encode('{"issuer":'));
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    const wrapped = withOAuthRequestTimeout(stalledBody, 1000);

    const assertion = wrapped(URL_UNDER_TEST).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(1000);

    expect((await assertion) as Error).toBeInstanceOf(OAuthRequestTimeoutError);
  });

  it("hands back the original response, not a copy", async () => {
    const original = new Response('{"issuer":"https://as.example.com"}', {
      status: 201,
      statusText: "Created",
      headers: { "content-type": "application/json", "x-probe": "kept" },
    });
    const wrapped = withOAuthRequestTimeout(
      vi.fn<typeof fetch>().mockResolvedValue(original),
      1000,
    );

    const response = await wrapped(URL_UNDER_TEST);

    // Identity, which is the strongest form of "nothing was changed": every
    // native slot, the headers guard and `clone()` behave as they would if this
    // wrapper were not in the chain at all.
    expect(response).toBe(original);
    await expect(response.json()).resolves.toEqual({
      issuer: "https://as.example.com",
    });
  });

  it("leaves the body readable after draining the clone", async () => {
    // The bound works by draining a clone; teeing buffers the other branch, so
    // the caller must still be able to read the original without a second trip.
    const wrapped = withOAuthRequestTimeout(
      vi.fn<typeof fetch>().mockResolvedValue(new Response("hello")),
      1000,
    );

    const response = await wrapped(URL_UNDER_TEST);

    expect(response.bodyUsed).toBe(false);
    await expect(response.text()).resolves.toBe("hello");
  });

  it("leaves the caller free to clone it again, with metadata intact", async () => {
    // The case a rebuilt response could never satisfy: `url` / `redirected` /
    // `type` are internal slots, so a shadowed own property survives a direct
    // read and is lost the moment anyone calls `clone()`.
    const original = new Response("{}", { status: 200 });
    Object.defineProperty(original, "url", {
      value: "https://as.example.com/redirected",
      configurable: true,
    });
    Object.defineProperty(original, "redirected", {
      value: true,
      configurable: true,
    });
    const wrapped = withOAuthRequestTimeout(
      vi.fn<typeof fetch>().mockResolvedValue(original),
      1000,
    );

    const response = await wrapped(URL_UNDER_TEST);
    const copy = response.clone();

    expect(copy.url).toBe("https://as.example.com/redirected");
    expect(copy.redirected).toBe(true);
    await expect(copy.json()).resolves.toEqual({});
  });

  it("keeps content-encoding and content-length, which are the server's own", async () => {
    // Nothing is rebuilt, so nothing invalidates them: the caller gets the
    // response `fetch` produced and decodes it the way `fetch` intends.
    const original = new Response("{}", {
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
    });
    const wrapped = withOAuthRequestTimeout(
      vi.fn<typeof fetch>().mockResolvedValue(original),
      1000,
    );

    const response = await wrapped(URL_UNDER_TEST);

    expect(response.headers.get("content-encoding")).toBe("gzip");
  });

  it("passes a null-body status through untouched", async () => {
    const original = new Response(null, { status: 204 });
    const wrapped = withOAuthRequestTimeout(
      vi.fn<typeof fetch>().mockResolvedValue(original),
      1000,
    );

    const response = await wrapped(URL_UNDER_TEST);

    expect(response).toBe(original);
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it("propagates a non-timeout failure unchanged", async () => {
    const boom = new TypeError("network error");
    const inner = vi.fn<typeof fetch>().mockRejectedValue(boom);
    const wrapped = withOAuthRequestTimeout(inner, 1000);

    await expect(wrapped(URL_UNDER_TEST)).rejects.toBe(boom);
  });

  it("rounds a fractional budget, which is reported to the caller", async () => {
    vi.useFakeTimers();
    // `setTimeout` would accept the fraction and truncate it. The rounding is
    // for the budget's *reported* form: a `performance.now()` subtraction would
    // otherwise name "1000.4000000953674ms" in the message and expose a
    // non-integer `timeoutMs`.
    const wrapped = withOAuthRequestTimeout(neverSettles, 1000.4);

    const assertion = wrapped(URL_UNDER_TEST).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(1000);

    expect((await assertion) as OAuthRequestTimeoutError).toMatchObject({
      timeoutMs: 1000,
    });
  });

  it("falls back to the default on a non-finite budget", async () => {
    vi.useFakeTimers();
    // `NaN` survives `Math.max(0, Math.round(NaN))` and `setTimeout(fn, NaN)`
    // fires immediately, so without this every OAuth request under a budget
    // that came out of bad arithmetic would fail at once with "timed out after
    // NaNms".
    for (const bad of [NaN, Infinity, -Infinity]) {
      const wrapped = withOAuthRequestTimeout(neverSettles, bad);
      const assertion = wrapped(URL_UNDER_TEST).catch((err: unknown) => err);

      await vi.advanceTimersByTimeAsync(DEFAULT_OAUTH_REQUEST_TIMEOUT_MS - 1);
      expect(await Promise.race([assertion, Promise.resolve("pending")])).toBe(
        "pending",
      );

      await vi.advanceTimersByTimeAsync(1);
      expect((await assertion) as OAuthRequestTimeoutError).toMatchObject({
        timeoutMs: DEFAULT_OAUTH_REQUEST_TIMEOUT_MS,
      });
    }
  });

  it("clamps an over-large budget to what setTimeout can schedule", async () => {
    vi.useFakeTimers();
    // Past 2**31-1 the delay overflows a 32-bit signed int and Node falls back
    // to 1ms — an immediate timeout, the opposite of what was asked for.
    const wrapped = withOAuthRequestTimeout(neverSettles, 2 ** 40);

    const assertion = wrapped(URL_UNDER_TEST).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await Promise.race([assertion, Promise.resolve("pending")])).toBe(
      "pending",
    );

    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect((await assertion) as OAuthRequestTimeoutError).toMatchObject({
      timeoutMs: 2_147_483_647,
    });
  });

  it("clamps a negative budget to zero rather than throwing", async () => {
    vi.useFakeTimers();
    const wrapped = withOAuthRequestTimeout(neverSettles, -1);

    const assertion = wrapped(URL_UNDER_TEST).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(0);

    expect((await assertion) as OAuthRequestTimeoutError).toMatchObject({
      timeoutMs: 0,
    });
  });

  it("defaults to a generous budget a slow authorization server can meet", async () => {
    vi.useFakeTimers();
    const wrapped = withOAuthRequestTimeout(neverSettles);

    const assertion = wrapped(URL_UNDER_TEST).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(DEFAULT_OAUTH_REQUEST_TIMEOUT_MS - 1);
    expect(await Promise.race([assertion, Promise.resolve("pending")])).toBe(
      "pending",
    );

    await vi.advanceTimersByTimeAsync(1);
    expect((await assertion) as OAuthRequestTimeoutError).toMatchObject({
      timeoutMs: DEFAULT_OAUTH_REQUEST_TIMEOUT_MS,
    });
  });

  describe("the deadline stamped on the init (#2319 proxy hop)", () => {
    // How the budget reaches `/api/fetch` without travelling upstream: a header
    // would be copied verbatim into the payload and re-sent to the
    // authorization server, so the carrier is a WeakMap keyed on the init.
    it("stamps the budget on the init it hands down", async () => {
      const inner = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
      const wrapped = withOAuthRequestTimeout(inner, 1234);

      await wrapped(URL_UNDER_TEST);

      expect(deadlineForRequestInit(inner.mock.calls[0][1])).toBe(1234);
    });

    it("stamps the rounded budget, matching what is reported", async () => {
      const inner = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
      const wrapped = withOAuthRequestTimeout(inner, 1000.4);

      await wrapped(URL_UNDER_TEST);

      expect(deadlineForRequestInit(inner.mock.calls[0][1])).toBe(1000);
    });

    it("stamps nothing on an exempt request", async () => {
      // The route must apply no deadline to MCP traffic, and it decides that
      // from the absence of a budget in the envelope.
      const inner = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
      const wrapped = withOAuthRequestTimeout(inner, 1234, () => true);

      await wrapped(URL_UNDER_TEST, { method: "POST" });

      expect(deadlineForRequestInit(inner.mock.calls[0][1])).toBeUndefined();
    });

    it("reads nothing off an init that never went through the wrapper", () => {
      expect(deadlineForRequestInit(undefined)).toBeUndefined();
      expect(deadlineForRequestInit({})).toBeUndefined();
      expect(deadlineForRequestInit({ method: "GET" })).toBeUndefined();
    });
  });

  describe("exemptMcpEndpoint (the transport chain's mixed traffic)", () => {
    const SERVER = "https://srv.example.com/mcp";

    /** Most cases are plain JSON-RPC traffic, which carries no form media type. */
    const JSON_HEADERS = new Headers({ "content-type": "application/json" });
    /** The token family: RFC 6749 §4.1.3 and RFC 7009 §2.1 are form-encoded. */
    const FORM_HEADERS = new Headers({
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    });

    /** Streamable HTTP: every MCP request goes to the configured URL. */
    const streamable = (serverUrl: string) =>
      exemptMcpEndpoint(
        () => serverUrl,
        () => false,
      );
    /** Legacy SSE: the message endpoint arrives inside the stream. */
    const sse = (serverUrl: string) =>
      exemptMcpEndpoint(
        () => serverUrl,
        () => true,
      );

    it("exempts the MCP endpoint itself, whatever method or query", () => {
      const isExempt = exemptMcpEndpoint(() => SERVER);

      expect(isExempt(SERVER, JSON_HEADERS)).toBe(true);
      expect(isExempt(`${SERVER}?sessionId=abc`, JSON_HEADERS)).toBe(true);
      expect(isExempt(`${SERVER}#frag`, JSON_HEADERS)).toBe(true);
    });

    it("never exempts a form-encoded request, whatever URL it uses", () => {
      // `oauthTokenUrl` takes any absolute URL, including the MCP endpoint's
      // own — at which point a URL rule would exempt the transport-internal
      // refresh, the one request this change exists to bound. The token family
      // is form-encoded and MCP never is, so the media type settles it first.
      for (const isExempt of [
        streamable(SERVER),
        sse(SERVER),
        exemptMcpEndpoint(() => SERVER),
      ]) {
        expect(isExempt(SERVER, FORM_HEADERS)).toBe(false);
      }
      // And a missing server URL no longer fails open past it either.
      expect(exemptMcpEndpoint(() => undefined)(SERVER, FORM_HEADERS)).toBe(
        false,
      );
    });

    it("bounds same-origin OAuth work on a Streamable HTTP connection", () => {
      // The narrow rule, available because the endpoint is the configured URL.
      const isExempt = streamable(SERVER);

      expect(isExempt(SERVER, JSON_HEADERS)).toBe(true);
      expect(
        isExempt(
          "https://srv.example.com/.well-known/oauth-protected-resource/mcp",
          JSON_HEADERS,
        ),
      ).toBe(false);
      expect(isExempt("https://srv.example.com/token", JSON_HEADERS)).toBe(
        false,
      );
    });

    it("widens to the origin on legacy SSE, whose message path is unknowable", () => {
      // The cost of the wider rule, asserted rather than implied: same-origin
      // OAuth is exempt here, and falls back to the SDK's per-request timeout.
      const isExempt = sse("https://srv.example.com/sse");

      expect(
        isExempt(
          "https://srv.example.com/.well-known/openid-configuration",
          JSON_HEADERS,
        ),
      ).toBe(true);
      expect(isExempt("https://as.example.com/token", JSON_HEADERS)).toBe(
        false,
      );
    });

    it("falls back to the origin rule when the transport is unknown", () => {
      // Fails open on this uncertainty like every other: a path rule applied to
      // a connection that turns out to be SSE severs real MCP traffic.
      const noHint = exemptMcpEndpoint(() => SERVER);
      const throws = exemptMcpEndpoint(
        () => SERVER,
        () => {
          throw new Error("not yet connected");
        },
      );

      expect(noHint("https://srv.example.com/token", JSON_HEADERS)).toBe(true);
      expect(throws("https://srv.example.com/token", JSON_HEADERS)).toBe(true);
    });

    it("exempts legacy SSE's separate message endpoint", () => {
      // The case a path rule gets wrong: `SSEClientTransport` opens the
      // configured URL and is handed a *different* pathname to POST every
      // JSON-RPC message to. Bounding those would sever a slow tool call over
      // SSE and report it as an OAuth timeout. The SDK enforces that the
      // message endpoint shares the stream URL's origin, which is what makes
      // an origin rule exact rather than approximate.
      const isExempt = exemptMcpEndpoint(() => "https://srv.example.com/sse");

      expect(
        isExempt(
          "https://srv.example.com/messages?sessionId=abc",
          JSON_HEADERS,
        ),
      ).toBe(true);
      expect(isExempt("https://srv.example.com/", JSON_HEADERS)).toBe(true);
    });

    it("bounds OAuth work on a different origin", () => {
      const isExempt = exemptMcpEndpoint(() => SERVER);

      expect(isExempt("https://as.example.com/token", JSON_HEADERS)).toBe(
        false,
      );
      expect(
        isExempt(
          "https://as.example.com/.well-known/openid-configuration",
          JSON_HEADERS,
        ),
      ).toBe(false);
      // Origin is scheme + host + port, so any of the three differing bounds it.
      expect(isExempt("http://srv.example.com/token", JSON_HEADERS)).toBe(
        false,
      );
      expect(isExempt("https://srv.example.com:8443/token", JSON_HEADERS)).toBe(
        false,
      );
    });

    it("fails open when the server URL is unknown or unparseable", () => {
      // The two errors are not symmetric: bounding what should not be bounded
      // severs a long-running tool call, while failing to bound leaves the
      // SDK's own per-request timeout as the backstop it already was.
      expect(
        exemptMcpEndpoint(() => undefined)(
          "https://as.example.com/token",
          JSON_HEADERS,
        ),
      ).toBe(true);
      expect(
        exemptMcpEndpoint(() => "")(
          "https://as.example.com/token",
          JSON_HEADERS,
        ),
      ).toBe(true);
      expect(exemptMcpEndpoint(() => "not a url")(SERVER, JSON_HEADERS)).toBe(
        true,
      );
      expect(exemptMcpEndpoint(() => SERVER)("not a url", JSON_HEADERS)).toBe(
        true,
      );
    });

    it("fails open when the server-URL getter throws", () => {
      // `InspectorClient.getServerUrl()` throws for a non-HTTP configuration,
      // and this wrapped fetch can still be handed to a transport or a custom
      // factory that calls it — propagating a configuration error out of a
      // fetch would turn the documented fail-open into a hard failure.
      const isExempt = exemptMcpEndpoint(() => {
        throw new Error("Server URL is only available for HTTP transports");
      });

      expect(isExempt("https://as.example.com/token", JSON_HEADERS)).toBe(true);
      // Still not past the form-encoded check, which runs first.
      expect(isExempt("https://as.example.com/token", FORM_HEADERS)).toBe(
        false,
      );
    });

    it("reads the server URL per call, since it changes between connects", () => {
      let current = SERVER;
      const isExempt = exemptMcpEndpoint(() => current);

      expect(isExempt("https://other.example.com/mcp", JSON_HEADERS)).toBe(
        false,
      );
      current = "https://other.example.com/mcp";
      expect(isExempt("https://other.example.com/mcp", JSON_HEADERS)).toBe(
        true,
      );
      expect(isExempt(SERVER, JSON_HEADERS)).toBe(false);
    });
  });

  it("passes an exempt request through with no deadline and no buffering", async () => {
    vi.useFakeTimers();
    // Untouched means untouched: no signal of ours, and the body is left as a
    // live stream rather than buffered — which is what an SSE response needs.
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode("data: hi\n\n"));
      },
    });
    const original = new Response(body, {
      headers: { "content-type": "text/event-stream" },
    });
    const inner = vi.fn<typeof fetch>().mockResolvedValue(original);
    const wrapped = withOAuthRequestTimeout(inner, 1000, () => true);

    const response = await wrapped(URL_UNDER_TEST);

    expect(response).toBe(original);
    expect(
      (inner.mock.calls[0][1] as RequestInit | undefined)?.signal,
    ).toBeUndefined();
    // Nothing is armed, so advancing past the budget cannot sever it.
    await vi.advanceTimersByTimeAsync(5000);
    expect(response.bodyUsed).toBe(false);
  });

  describe("composed under withRfc8414OidcCompat (#2319 ordering)", () => {
    // `withRfc8414OidcCompat` re-fetches an OIDC candidate after a failed RFC
    // 8414 discovery, so where the deadline sits relative to it decides which
    // request is being timed. `InspectorClient` and the CLI both put it
    // innermost; these two cases are why.
    const RFC8414 =
      "https://as.example.com/.well-known/oauth-authorization-server/tenant";
    // A path-suffixed RFC 8414 candidate has two OIDC siblings, and the compat
    // wrapper tries both.
    const PROBES = [
      "https://as.example.com/.well-known/openid-configuration/tenant",
      "https://as.example.com/tenant/.well-known/openid-configuration",
    ];

    /** Answers the RFC 8414 leg with a prompt 404, then stalls on the probe. */
    function stallingProbeFetch() {
      return vi.fn<typeof fetch>((input) => {
        if (String(input) === RFC8414) {
          return Promise.resolve(new Response(null, { status: 404 }));
        }
        return new Promise<Response>(() => {});
      });
    }

    it("outside, a stalled probe is misreported under the preceding URL", async () => {
      vi.useFakeTimers();
      const inner = stallingProbeFetch();
      const wrapped = withOAuthRequestTimeout(
        withRfc8414OidcCompat(inner),
        1000,
      );

      const assertion = wrapped(RFC8414).catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(1000);

      const err = (await assertion) as OAuthRequestTimeoutError;
      expect(err).toBeInstanceOf(OAuthRequestTimeoutError);
      // The endpoint that stalled was PROBE. One budget covers both legs, and
      // the error names the request the caller made rather than the one that
      // hung — exactly the diagnostic this change exists to provide.
      expect(err.url).toBe(RFC8414);
    });

    it("innermost, the probe's own timeout escapes and names the probe", async () => {
      vi.useFakeTimers();
      const inner = stallingProbeFetch();
      const wrapped = withRfc8414OidcCompat(
        withOAuthRequestTimeout(inner, 1000),
      );

      const assertion = wrapped(RFC8414).catch((err: unknown) => err);
      // The probe is timed from when it starts, on a budget of its own — not on
      // whatever an outer one had left after the RFC 8414 leg.
      await vi.advanceTimersByTimeAsync(1000);

      const err = (await assertion) as OAuthRequestTimeoutError;
      // The compat wrapper is inert on an ordinary probe failure, but a deadline
      // the Inspector imposed escapes it, so the caller is told which endpoint
      // stalled rather than being handed the preceding 404.
      expect(err).toBeInstanceOf(OAuthRequestTimeoutError);
      expect(err.url).toBe(PROBES[0]);
      expect(inner).toHaveBeenCalledTimes(2);
    });
  });

  it("clears its timer once the request settles", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const wrapped = withOAuthRequestTimeout(
      vi.fn<typeof fetch>().mockResolvedValue(new Response("{}")),
      1000,
    );

    await wrapped(URL_UNDER_TEST);

    expect(clearSpy).toHaveBeenCalled();
    // Nothing is left to fire, so no unhandled rejection can surface later.
    await vi.advanceTimersByTimeAsync(5000);
  });
});
