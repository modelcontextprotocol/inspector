/**
 * `fetchGuard` — the OAuth destination guard (#2749).
 *
 * The block-list, the redirect rewrite and the pinning lookup hook are driven
 * directly; the hop loop and the `typeof fetch` adapter are driven through an
 * injected `hopFetch`, so no socket is needed. The undici path — direct and
 * through `EnvHttpProxyAgent` — is covered in the integration project
 * (`src/test/integration/mcp/node/fetchGuard.test.ts`).
 */

import { describe, expect, it, vi } from "vitest";
import type { LookupAddress } from "node:dns";
import {
  FetchTargetError,
  MAX_FETCH_REDIRECTS,
  createGuardedFetch,
  createPinningLookup,
  findFetchTargetError,
  guardedFetch,
  isBlockedAddress,
  nextRedirectRequest,
  normalizeFetchHeaders,
  type FetchHopRequest,
  type GuardedFetchInit,
  type HopFetch,
  type ResolveHost,
} from "@inspector/core/mcp/node/fetchGuard.js";

describe("isBlockedAddress", () => {
  it.each([
    "169.254.169.254",
    "169.254.0.1",
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "fe80::1",
    "FEBF::1",
    "fd00:ec2::254",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "192.168.1.10",
    "172.16.0.1",
    "169.255.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:not-an-address",
    "fec0::1",
    "fd00:ec2::253",
    "example.com",
  ])("allows %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

describe("normalizeFetchHeaders", () => {
  it("keeps string-valued entries only", () => {
    expect(normalizeFetchHeaders({ a: "1", b: 2, c: null })).toEqual({
      a: "1",
    });
  });

  it.each([null, "x", ["a"], undefined])("returns {} for %j", (raw) => {
    expect(normalizeFetchHeaders(raw)).toEqual({});
  });
});

function hop(overrides: Partial<FetchHopRequest> = {}): FetchHopRequest {
  return {
    url: new URL("https://as.example/token"),
    method: "POST",
    body: "grant_type=refresh_token",
    headers: {
      Authorization: "Bearer x",
      Cookie: "c=1",
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    ...overrides,
  };
}

describe("nextRedirectRequest", () => {
  it("rewrites a 302 POST into a bodyless GET and drops body headers", () => {
    const next = nextRedirectRequest(hop(), 302, "/elsewhere");
    expect(next.url.href).toBe("https://as.example/elsewhere");
    expect(next.method).toBe("GET");
    expect(next.body).toBeUndefined();
    expect(next.headers).toEqual({
      Authorization: "Bearer x",
      Cookie: "c=1",
      Accept: "application/json",
    });
  });

  it("keeps a 301 GET as-is", () => {
    const next = nextRedirectRequest(
      hop({ method: "GET", body: undefined }),
      301,
      "/moved",
    );
    expect(next.method).toBe("GET");
    expect(next.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("rewrites a 303 PUT but not a 303 HEAD", () => {
    expect(nextRedirectRequest(hop({ method: "PUT" }), 303, "/x").method).toBe(
      "GET",
    );
    expect(
      nextRedirectRequest(hop({ method: "HEAD", body: undefined }), 303, "/x")
        .method,
    ).toBe("HEAD");
  });

  it("keeps method and body on a same-origin 307", () => {
    const next = nextRedirectRequest(hop(), 307, "/again");
    expect(next.method).toBe("POST");
    expect(next.body).toBe("grant_type=refresh_token");
  });

  it("drops credentials on a cross-origin hop", () => {
    const next = nextRedirectRequest(
      hop({ method: "GET", body: undefined }),
      302,
      "https://other.example/",
    );
    expect(next.headers).not.toHaveProperty("Authorization");
    expect(next.headers).not.toHaveProperty("Cookie");
    expect(next.headers.Accept).toBe("application/json");
  });

  it("refuses a cross-origin hop that would still carry a body", () => {
    expect(() =>
      nextRedirectRequest(hop(), 307, "https://other.example/"),
    ).toThrow(FetchTargetError);
  });

  it("does not mutate the current request's headers", () => {
    const current = hop();
    nextRedirectRequest(current, 302, "https://other.example/");
    expect(current.headers.Authorization).toBe("Bearer x");
  });
});

describe("findFetchTargetError", () => {
  it("finds the error itself or one in its cause chain", () => {
    const refused = new FetchTargetError("no");
    expect(findFetchTargetError(refused)).toBe(refused);
    expect(
      findFetchTargetError(new TypeError("fetch failed", { cause: refused })),
    ).toBe(refused);
  });

  it("returns undefined for anything else", () => {
    expect(findFetchTargetError(new Error("x"))).toBeUndefined();
    expect(findFetchTargetError("x")).toBeUndefined();
    const cyclic = new Error("a");
    cyclic.cause = cyclic;
    expect(findFetchTargetError(cyclic)).toBeUndefined();
  });
});

type LookupResult = {
  err: NodeJS.ErrnoException | null;
  address: string | LookupAddress[];
  family?: number;
};

function runLookup(
  resolveHost: ResolveHost,
  all: boolean,
): Promise<LookupResult> {
  const lookup = createPinningLookup(resolveHost);
  return new Promise((resolve) => {
    lookup(
      "host.test",
      { all },
      (
        err: NodeJS.ErrnoException | null,
        address: string | LookupAddress[],
        family?: number,
      ) => resolve({ err, address, family }),
    );
  });
}

describe("createPinningLookup", () => {
  it("hands back every validated address when asked for all", async () => {
    const result = await runLookup(async () => ["127.0.0.1", "::1"], true);
    expect(result.err).toBeNull();
    expect(result.address).toEqual([
      { address: "127.0.0.1", family: 4 },
      { address: "::1", family: 6 },
    ]);
  });

  it("hands back the first address in the scalar form", async () => {
    const result = await runLookup(async () => ["::1", "127.0.0.1"], false);
    expect(result).toEqual({ err: null, address: "::1", family: 6 });
  });

  it("refuses if any resolved address is blocked", async () => {
    const result = await runLookup(
      async () => ["127.0.0.1", "169.254.169.254"],
      true,
    );
    expect(result.err).toBeInstanceOf(FetchTargetError);
    expect(result.err?.message).toContain("169.254.169.254");
  });

  it("refuses an empty answer", async () => {
    const result = await runLookup(async () => [], true);
    expect(result.err).toBeInstanceOf(FetchTargetError);
  });

  it("passes a resolver failure through", async () => {
    const failure = Object.assign(new Error("ENOTFOUND"), {
      code: "ENOTFOUND",
    });
    const result = await runLookup(() => Promise.reject(failure), true);
    expect(result.err).toBe(failure);
  });
});

function init(overrides: Partial<GuardedFetchInit> = {}): GuardedFetchInit {
  return {
    method: "GET",
    headers: {},
    body: undefined,
    ...overrides,
  };
}

function redirect(status: number, location: string | null): Response {
  return new Response(status === 304 ? null : "moved", {
    status,
    headers: location === null ? {} : { location },
  });
}

/** A hopFetch answering each call from `responses`, in order. */
function scripted(...responses: Response[]) {
  const hopFetch = vi.fn<HopFetch>();
  for (const res of responses) hopFetch.mockResolvedValueOnce(res);
  return hopFetch;
}

const resolvesNowhere: ResolveHost = () =>
  Promise.reject(new Error("ENOTFOUND"));

describe("guardedFetch hop loop", () => {
  it("passes a non-redirect response straight through", async () => {
    const hopFetch = scripted(new Response("ok"));
    const res = await guardedFetch("http://as.example/x", init(), {
      hopFetch,
    });
    expect(await res.text()).toBe("ok");
    expect(hopFetch).toHaveBeenCalledWith(
      "http://as.example/x",
      expect.objectContaining({ redirect: "manual", method: "GET" }),
    );
  });

  it("follows a redirect and re-checks the new hop", async () => {
    const hopFetch = scripted(
      redirect(302, "http://169.254.169.254/latest/meta-data/"),
    );
    await expect(
      guardedFetch("http://as.example/x", init(), { hopFetch }),
    ).rejects.toThrow(FetchTargetError);
    expect(hopFetch).toHaveBeenCalledTimes(1);
  });

  it.each([301, 302, 303, 307, 308])(
    "follows a %i to its end",
    async (status) => {
      const hopFetch = scripted(
        redirect(status, "/next"),
        new Response("landed"),
      );
      const res = await guardedFetch("http://as.example/x", init(), {
        hopFetch,
      });
      expect(await res.text()).toBe("landed");
      expect(hopFetch.mock.calls[1]?.[0]).toBe("http://as.example/next");
    },
  );

  // Copilot: only the Fetch-defined redirect statuses are followed.
  it.each([300, 304, 305, 306])(
    "relays a %i as the response even with a Location",
    async (status) => {
      const hopFetch = scripted(redirect(status, "/elsewhere"));
      const res = await guardedFetch(
        "http://as.example/x",
        init({ method: "POST", body: "a=b" }),
        { hopFetch },
      );
      expect(res.status).toBe(status);
      expect(hopFetch).toHaveBeenCalledTimes(1);
    },
  );

  it("returns a redirect status with no Location as the response", async () => {
    const hopFetch = scripted(redirect(302, null));
    const res = await guardedFetch("http://as.example/x", init(), {
      hopFetch,
    });
    expect(res.status).toBe(302);
  });

  it("gives up after the redirect limit", async () => {
    const hopFetch = vi
      .fn<HopFetch>()
      .mockImplementation(async () => redirect(302, "/loop"));
    await expect(
      guardedFetch("http://as.example/x", init(), { hopFetch }),
    ).rejects.toThrow(/more than 5 redirects/);
    expect(hopFetch).toHaveBeenCalledTimes(MAX_FETCH_REDIRECTS + 1);
  });

  it.each(["file:///etc/passwd", "ftp://as.example/", "data:text/plain,x"])(
    "refuses the %s scheme before any request",
    async (url) => {
      const hopFetch = scripted();
      await expect(guardedFetch(url, init(), { hopFetch })).rejects.toThrow(
        /only http and https/,
      );
      expect(hopFetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    "http://169.254.169.254/",
    "http://[fe80::1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://2852039166/",
  ])("refuses the IP literal in %s", async (url) => {
    const hopFetch = scripted();
    await expect(guardedFetch(url, init(), { hopFetch })).rejects.toThrow(
      FetchTargetError,
    );
    expect(hopFetch).not.toHaveBeenCalled();
  });

  it("allows loopback and private literals", async () => {
    const hopFetch = scripted(new Response("a"), new Response("b"));
    await guardedFetch("http://127.0.0.1:6274/", init(), { hopFetch });
    await guardedFetch("http://192.168.1.10/", init(), { hopFetch });
    expect(hopFetch).toHaveBeenCalledTimes(2);
  });

  it("does not resolve a hostname itself when no proxy is in play", async () => {
    const resolveHost = vi.fn<ResolveHost>();
    const hopFetch = scripted(new Response("ok"));
    await guardedFetch("http://as.example/", init(), {
      hopFetch,
      resolveHost,
      viaProxy: false,
    });
    expect(resolveHost).not.toHaveBeenCalled();
  });

  it("forwards method, headers, body and signal on each hop", async () => {
    const hopFetch = scripted(new Response("ok"));
    const controller = new AbortController();
    await guardedFetch(
      "http://as.example/token",
      init({
        method: "POST",
        headers: { "x-probe": "1" },
        body: "a=b",
        signal: controller.signal,
      }),
      { hopFetch },
    );
    const sent = hopFetch.mock.calls[0]?.[1];
    expect(sent?.method).toBe("POST");
    expect(sent?.body).toBe("a=b");
    expect(sent?.signal).toBe(controller.signal);
    expect(new Headers(sent?.headers).get("x-probe")).toBe("1");
  });
});

describe("guardedFetch behind a proxy (best-effort hostname check)", () => {
  const viaProxy = true;

  it("refuses a hostname that resolves locally to a blocked address", async () => {
    const hopFetch = scripted();
    await expect(
      guardedFetch("http://metadata.test/", init(), {
        hopFetch,
        viaProxy,
        resolveHost: async () => ["169.254.169.254"],
      }),
    ).rejects.toThrow(FetchTargetError);
    expect(hopFetch).not.toHaveBeenCalled();
  });

  it("allows a hostname that resolves locally to a permitted address", async () => {
    const hopFetch = scripted(new Response("ok"));
    await guardedFetch("http://as.example/", init(), {
      hopFetch,
      viaProxy,
      resolveHost: async () => ["10.1.2.3"],
    });
    expect(hopFetch).toHaveBeenCalledTimes(1);
  });

  it("allows a hostname that does not resolve locally", async () => {
    const hopFetch = scripted(new Response("ok"));
    await guardedFetch("http://as.example/", init(), {
      hopFetch,
      viaProxy,
      resolveHost: resolvesNowhere,
    });
    expect(hopFetch).toHaveBeenCalledTimes(1);
  });

  // Copilot: a stalled local resolver must not outlive the caller's abort.
  it("rejects promptly when the request aborts mid-lookup", async () => {
    const controller = new AbortController();
    const hopFetch = scripted();
    const pending = guardedFetch(
      "http://as.example/",
      init({ signal: controller.signal }),
      { hopFetch, viaProxy, resolveHost: () => new Promise(() => {}) },
    );
    const reason = new Error("deadline");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(hopFetch).not.toHaveBeenCalled();
  });

  it("rejects at once on an already-aborted signal", async () => {
    const resolveHost = vi.fn<ResolveHost>();
    await expect(
      guardedFetch(
        "http://as.example/",
        init({ signal: AbortSignal.abort(new Error("gone")) }),
        { hopFetch: scripted(), viaProxy, resolveHost },
      ),
    ).rejects.toThrow("gone");
    expect(resolveHost).not.toHaveBeenCalled();
  });

  it("applies a refusal from a lookup that settles on a live signal", async () => {
    const controller = new AbortController();
    await expect(
      guardedFetch(
        "http://metadata.test/",
        init({ signal: controller.signal }),
        {
          hopFetch: scripted(),
          viaProxy,
          resolveHost: async () => ["169.254.169.254"],
        },
      ),
    ).rejects.toThrow(FetchTargetError);
  });

  it("treats a failed lookup on a live signal as unresolvable", async () => {
    const controller = new AbortController();
    const hopFetch = scripted(new Response("ok"));
    await guardedFetch(
      "http://as.example/",
      init({ signal: controller.signal }),
      { hopFetch, viaProxy, resolveHost: resolvesNowhere },
    );
    expect(hopFetch).toHaveBeenCalledTimes(1);
  });
});

describe("createGuardedFetch", () => {
  it("passes a string URL, method, headers and string body through", async () => {
    const hopFetch = scripted(new Response("ok"));
    const guarded = createGuardedFetch({ hopFetch });
    await guarded("http://as.example/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"a":1}',
    });
    const [url, sent] = hopFetch.mock.calls[0] ?? [];
    expect(url).toBe("http://as.example/register");
    expect(sent?.method).toBe("POST");
    expect(sent?.body).toBe('{"a":1}');
    expect(new Headers(sent?.headers).get("content-type")).toBe(
      "application/json",
    );
  });

  it("defaults to GET with no body for a URL input", async () => {
    const hopFetch = scripted(new Response("ok"));
    await createGuardedFetch({ hopFetch })(new URL("http://as.example/m"));
    const [url, sent] = hopFetch.mock.calls[0] ?? [];
    expect(url).toBe("http://as.example/m");
    expect(sent?.method).toBe("GET");
    expect(sent?.body).toBeUndefined();
  });

  it("serializes a URLSearchParams form and sets its media type", async () => {
    const hopFetch = scripted(new Response("ok"));
    await createGuardedFetch({ hopFetch })("http://as.example/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "refresh_token", r: "x y" }),
    });
    const sent = hopFetch.mock.calls[0]?.[1];
    expect(sent?.body).toBe("grant_type=refresh_token&r=x+y");
    expect(new Headers(sent?.headers).get("content-type")).toBe(
      "application/x-www-form-urlencoded;charset=UTF-8",
    );
  });

  it("keeps a caller's own media type on a URLSearchParams form", async () => {
    const hopFetch = scripted(new Response("ok"));
    await createGuardedFetch({ hopFetch })("http://as.example/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ a: "b" }),
    });
    expect(
      new Headers(hopFetch.mock.calls[0]?.[1]?.headers).get("content-type"),
    ).toBe("application/x-www-form-urlencoded");
  });

  it("reads a Request input's method, headers, body and signal", async () => {
    const hopFetch = scripted(new Response("ok"));
    const controller = new AbortController();
    await createGuardedFetch({ hopFetch })(
      new Request("http://as.example/token", {
        method: "POST",
        headers: { "x-probe": "1" },
        body: "a=b",
        signal: controller.signal,
      }),
    );
    const [url, sent] = hopFetch.mock.calls[0] ?? [];
    expect(url).toBe("http://as.example/token");
    expect(sent?.method).toBe("POST");
    expect(sent?.body).toBe("a=b");
    expect(new Headers(sent?.headers).get("x-probe")).toBe("1");
    expect(sent?.signal?.aborted).toBe(false);
  });

  it("reads a bodyless Request input", async () => {
    const hopFetch = scripted(new Response("ok"));
    await createGuardedFetch({ hopFetch })(
      new Request("http://as.example/meta"),
    );
    expect(hopFetch.mock.calls[0]?.[1]?.body).toBeUndefined();
  });

  it("treats a null body as no body", async () => {
    const hopFetch = scripted(new Response("ok"));
    await createGuardedFetch({ hopFetch })("http://as.example/m", {
      body: null,
    });
    expect(hopFetch.mock.calls[0]?.[1]?.body).toBeUndefined();
  });

  it("refuses a body it cannot replay across a redirect", async () => {
    await expect(
      createGuardedFetch({ hopFetch: scripted() })("http://as.example/m", {
        method: "POST",
        body: new Uint8Array([1, 2]),
      }),
    ).rejects.toThrow(/string or URLSearchParams body only/);
  });

  it("rejects with the FetchTargetError itself", async () => {
    const refused = new FetchTargetError("refused here");
    const hopFetch = vi
      .fn<HopFetch>()
      .mockRejectedValue(new TypeError("fetch failed", { cause: refused }));
    await expect(
      createGuardedFetch({ hopFetch })("http://as.example/m"),
    ).rejects.toBe(refused);
  });

  it("passes any other failure through unchanged", async () => {
    const failure = new TypeError("fetch failed");
    const hopFetch = vi.fn<HopFetch>().mockRejectedValue(failure);
    await expect(
      createGuardedFetch({ hopFetch })("http://as.example/m"),
    ).rejects.toBe(failure);
  });
});
