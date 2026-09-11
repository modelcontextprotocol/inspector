/**
 * Unit coverage for `withOAuthRequestTimeout` (#2319) — the deadline every
 * OAuth-path request runs under.
 *
 * What is pinned here, and why each case exists rather than being obvious:
 *
 * - **The bound itself**, including the *body*: `fetch` resolves on headers, so
 *   a server that sends them and then stalls has to be caught by the buffering
 *   race, not by the fetch promise.
 * - **The rebuilt response.** Buffering means the caller gets a different
 *   `Response` object, so `url` / `redirected` / `type` are asserted to survive
 *   and `content-encoding` / `content-length` to be dropped — the buffer holds
 *   the decoded body, which makes both of those headers lies.
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
    // Not the same object: the body is buffered under the deadline (see the
    // stalled-body case below) and the response rebuilt around it.
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

  it("returns a readable response whose metadata survives the rebuild", async () => {
    const original = new Response('{"issuer":"https://as.example.com"}', {
      status: 201,
      statusText: "Created",
      headers: { "content-type": "application/json", "x-probe": "kept" },
    });
    // Seeded to NON-default values, which is the whole point of the case: a
    // synthetic `new Response(...)` already has `url === ""`, `redirected ===
    // false` and `type === "default"` — exactly the rebuilt response's own
    // defaults — so asserting against those would stay green with the
    // `Object.defineProperty` loop deleted from `rebuildResponse` (Copilot).
    // These are read-only getters, hence the same mechanism the source uses.
    Object.defineProperty(original, "url", {
      value: "https://as.example.com/redirected",
      configurable: true,
    });
    Object.defineProperty(original, "redirected", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(original, "type", {
      value: "cors",
      configurable: true,
    });
    const wrapped = withOAuthRequestTimeout(
      vi.fn<typeof fetch>().mockResolvedValue(original),
      1000,
    );

    const response = await wrapped(URL_UNDER_TEST);

    expect(response.status).toBe(201);
    expect(response.statusText).toBe("Created");
    expect(response.ok).toBe(true);
    expect(response.headers.get("x-probe")).toBe("kept");
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.url).toBe("https://as.example.com/redirected");
    expect(response.redirected).toBe(true);
    expect(response.type).toBe("cors");
    // The rebuild must not change what enumerates. Which keys a `Response` owns
    // is the host's business — under the Fetch standard these three are
    // prototype getters and a native response has no own enumerable keys, while
    // happy-dom makes them own enumerable data properties — so this compares
    // against a baseline built in the same runtime rather than asserting either
    // answer. Hard-coding one would make the rebuilt response observably
    // different from a response that never passed through the wrapper, in
    // `Object.keys`, object spread and `JSON.stringify`.
    const baseline = Object.keys(new Response("{}")).sort();
    expect(Object.keys(response).sort()).toEqual(baseline);
    await expect(response.json()).resolves.toEqual({
      issuer: "https://as.example.com",
    });
  });

  it("drops content-encoding and content-length, which the buffer invalidates", async () => {
    // `arrayBuffer()` hands back the *decoded* entity body, so an inherited
    // `content-encoding` would describe an encoding the bytes no longer have
    // and the inherited `content-length` would be the compressed size. Both are
    // wrong, and both show up in the Network capture.
    const decoded = '{"issuer":"https://as.example.com"}';
    const wrapped = withOAuthRequestTimeout(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(decoded, {
          headers: {
            "content-type": "application/json",
            "content-encoding": "gzip",
            "content-length": "42",
          },
        }),
      ),
      1000,
    );

    const response = await wrapped(URL_UNDER_TEST);

    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.text()).resolves.toBe(decoded);
  });

  it("rebuilds a null-body status without handing it a body", async () => {
    // `new Response(body, { status: 204 })` throws; the rebuild has to pass null.
    const wrapped = withOAuthRequestTimeout(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 204 })),
      1000,
    );

    const response = await wrapped(URL_UNDER_TEST);

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

    it("exempts the MCP endpoint itself, whatever method or query", () => {
      const isExempt = exemptMcpEndpoint(() => SERVER);

      expect(isExempt(SERVER)).toBe(true);
      expect(isExempt(`${SERVER}?sessionId=abc`)).toBe(true);
      expect(isExempt(`${SERVER}#frag`)).toBe(true);
    });

    it("exempts legacy SSE's separate message endpoint", () => {
      // The case a path rule gets wrong: `SSEClientTransport` opens the
      // configured URL and is handed a *different* pathname to POST every
      // JSON-RPC message to. Bounding those would sever a slow tool call over
      // SSE and report it as an OAuth timeout. The SDK enforces that the
      // message endpoint shares the stream URL's origin, which is what makes
      // an origin rule exact rather than approximate.
      const isExempt = exemptMcpEndpoint(() => "https://srv.example.com/sse");

      expect(isExempt("https://srv.example.com/messages?sessionId=abc")).toBe(
        true,
      );
      expect(isExempt("https://srv.example.com/")).toBe(true);
    });

    it("bounds OAuth work on a different origin", () => {
      const isExempt = exemptMcpEndpoint(() => SERVER);

      expect(isExempt("https://as.example.com/token")).toBe(false);
      expect(
        isExempt("https://as.example.com/.well-known/openid-configuration"),
      ).toBe(false);
      // Origin is scheme + host + port, so any of the three differing bounds it.
      expect(isExempt("http://srv.example.com/token")).toBe(false);
      expect(isExempt("https://srv.example.com:8443/token")).toBe(false);
    });

    it("exempts a same-origin OAuth endpoint, which is the cost of the rule", () => {
      // Stated as a test rather than left implicit: protected-resource metadata
      // lives on the resource's own origin, so it is exempt here. The OAuth
      // chain still bounds the Inspector's own requests to it; only the SDK's
      // transport-internal OAuth against a same-origin server falls back to the
      // SDK's per-request timeout.
      const isExempt = exemptMcpEndpoint(() => SERVER);

      expect(
        isExempt(
          "https://srv.example.com/.well-known/oauth-protected-resource/mcp",
        ),
      ).toBe(true);
    });

    it("fails open when the server URL is unknown or unparseable", () => {
      // The two errors are not symmetric: bounding what should not be bounded
      // severs a long-running tool call, while failing to bound leaves the
      // SDK's own per-request timeout as the backstop it already was.
      expect(
        exemptMcpEndpoint(() => undefined)("https://as.example.com/token"),
      ).toBe(true);
      expect(exemptMcpEndpoint(() => "")("https://as.example.com/token")).toBe(
        true,
      );
      expect(exemptMcpEndpoint(() => "not a url")(SERVER)).toBe(true);
      expect(exemptMcpEndpoint(() => SERVER)("not a url")).toBe(true);
    });

    it("reads the server URL per call, since it changes between connects", () => {
      let current = SERVER;
      const isExempt = exemptMcpEndpoint(() => current);

      expect(isExempt("https://other.example.com/mcp")).toBe(false);
      current = "https://other.example.com/mcp";
      expect(isExempt("https://other.example.com/mcp")).toBe(true);
      expect(isExempt(SERVER)).toBe(false);
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
