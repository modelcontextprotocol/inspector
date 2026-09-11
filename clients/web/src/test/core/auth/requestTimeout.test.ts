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
  it("passes a prompt response straight through", async () => {
    const ok = new Response("{}", { status: 200 });
    const inner = vi.fn<typeof fetch>().mockResolvedValue(ok);
    const wrapped = withOAuthRequestTimeout(inner, 1000);

    await expect(wrapped(URL_UNDER_TEST)).resolves.toBe(ok);
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

  it("preserves a caller-supplied signal, which still wins on its own", async () => {
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
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null)),
      1000,
    );

    await wrapped(URL_UNDER_TEST);

    expect(clearSpy).toHaveBeenCalled();
    // Nothing is left to fire, so no unhandled rejection can surface later.
    await vi.advanceTimersByTimeAsync(5000);
  });
});
