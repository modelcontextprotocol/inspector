import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DEFAULT_OAUTH_REQUEST_TIMEOUT_MS,
  OAuthRequestTimeoutError,
  withOAuthRequestTimeout,
} from "@inspector/core/auth/requestTimeout.js";

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

  it("still enforces the deadline when the signal is dropped in flight", async () => {
    vi.useFakeTimers();
    // The browser's `createRemoteFetch` re-issues the call to `/api/fetch` and
    // forwards no signal, so aborting locally cancels nothing. The race is what
    // has to bound it.
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
    // Forwarding alone is not enough on the browser's `createRemoteFetch` path,
    // which drops the signal: without the race the caller's abort would sit
    // pending for the whole budget instead of winning.
    const wrapped = withOAuthRequestTimeout(neverSettles, 60_000);

    const caller = new AbortController();
    const pending = wrapped(URL_UNDER_TEST, { signal: caller.signal });
    const reason = new Error("caller gave up");
    caller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it("rejects immediately when the caller's signal is already aborted", async () => {
    const wrapped = withOAuthRequestTimeout(neverSettles, 60_000);
    const reason = new Error("already gone");

    await expect(
      wrapped(URL_UNDER_TEST, { signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
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
    const wrapped = withOAuthRequestTimeout(
      vi.fn<typeof fetch>().mockResolvedValue(original),
      1000,
    );

    const response = await wrapped(URL_UNDER_TEST);

    expect(response.status).toBe(201);
    expect(response.statusText).toBe("Created");
    expect(response.ok).toBe(true);
    expect(response.headers.get("x-probe")).toBe("kept");
    expect(response.url).toBe(original.url);
    expect(response.redirected).toBe(original.redirected);
    expect(response.type).toBe(original.type);
    await expect(response.json()).resolves.toEqual({
      issuer: "https://as.example.com",
    });
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

  it("rounds a fractional budget, because setTimeout takes an integer", async () => {
    vi.useFakeTimers();
    // A budget derived from `performance.now()` arrives fractional; a fractional
    // delay throws ERR_OUT_OF_RANGE before the request is ever made.
    const wrapped = withOAuthRequestTimeout(neverSettles, 1000.4);

    const assertion = wrapped(URL_UNDER_TEST).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(1000);

    expect((await assertion) as OAuthRequestTimeoutError).toMatchObject({
      timeoutMs: 1000,
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
