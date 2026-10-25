/**
 * `fetchGuard` — the `/api/fetch` destination guard (#2749).
 *
 * The block-list, the redirect rewrite and the pinning lookup hook are driven
 * directly; the hop loop is driven through an injected `proxyFetch`, which is
 * the guard's best-effort (proxied) mode and needs no socket. The direct path,
 * which connects through undici, is covered in the integration project
 * (`src/test/integration/mcp/remote/fetchGuard.test.ts`).
 */

import { describe, expect, it, vi } from "vitest";
import type { LookupAddress } from "node:dns";
import {
  FetchTargetError,
  MAX_FETCH_REDIRECTS,
  createPinningLookup,
  findFetchTargetError,
  guardedFetch,
  isBlockedAddress,
  nextRedirectRequest,
  normalizeFetchHeaders,
  type FetchHopRequest,
  type GuardedFetchInit,
  type ResolveHost,
} from "@inspector/core/mcp/remote/node/fetchGuard.js";

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
    lookup("host.test", { all }, (err, address, family) =>
      resolve({ err, address, family }),
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
    signal: new AbortController().signal,
    ...overrides,
  };
}

function redirect(status: number, location: string | null): Response {
  return new Response("moved", {
    status,
    headers: location === null ? {} : { location },
  });
}

/** A proxyFetch answering each call from `responses`, in order. */
function scripted(...responses: Response[]) {
  const proxyFetch = vi.fn<typeof fetch>();
  for (const res of responses) proxyFetch.mockResolvedValueOnce(res);
  return proxyFetch;
}

const resolvesNowhere: ResolveHost = () =>
  Promise.reject(new Error("ENOTFOUND"));

describe("guardedFetch (proxied mode)", () => {
  it("passes a non-redirect response straight through", async () => {
    const proxyFetch = scripted(new Response("ok"));
    const res = await guardedFetch("http://as.example/x", init(), {
      proxyFetch,
      resolveHost: resolvesNowhere,
    });
    expect(await res.text()).toBe("ok");
    expect(proxyFetch).toHaveBeenCalledWith(
      "http://as.example/x",
      expect.objectContaining({ redirect: "manual", method: "GET" }),
    );
  });

  it("follows a redirect and re-checks the new hop", async () => {
    const proxyFetch = scripted(
      redirect(302, "http://169.254.169.254/latest/meta-data/"),
    );
    await expect(
      guardedFetch("http://as.example/x", init(), {
        proxyFetch,
        resolveHost: resolvesNowhere,
      }),
    ).rejects.toThrow(FetchTargetError);
    expect(proxyFetch).toHaveBeenCalledTimes(1);
  });

  it("follows a permitted redirect to its end", async () => {
    const proxyFetch = scripted(redirect(301, "/next"), new Response("landed"));
    const res = await guardedFetch("http://as.example/x", init(), {
      proxyFetch,
      resolveHost: resolvesNowhere,
    });
    expect(await res.text()).toBe("landed");
    expect(proxyFetch.mock.calls[1]?.[0]).toBe("http://as.example/next");
  });

  it("returns a 3xx with no Location as the response", async () => {
    const proxyFetch = scripted(redirect(304, null));
    const res = await guardedFetch("http://as.example/x", init(), {
      proxyFetch,
      resolveHost: resolvesNowhere,
    });
    expect(res.status).toBe(304);
  });

  it("gives up after the redirect limit", async () => {
    const proxyFetch = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => redirect(302, "/loop"));
    await expect(
      guardedFetch("http://as.example/x", init(), {
        proxyFetch,
        resolveHost: resolvesNowhere,
      }),
    ).rejects.toThrow(/more than 5 redirects/);
    expect(proxyFetch).toHaveBeenCalledTimes(MAX_FETCH_REDIRECTS + 1);
  });

  it.each(["file:///etc/passwd", "ftp://as.example/", "data:text/plain,x"])(
    "refuses the %s scheme before any request",
    async (url) => {
      const proxyFetch = scripted();
      await expect(guardedFetch(url, init(), { proxyFetch })).rejects.toThrow(
        /only http and https/,
      );
      expect(proxyFetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    "http://169.254.169.254/",
    "http://[fe80::1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://2852039166/",
  ])("refuses the IP literal in %s", async (url) => {
    const proxyFetch = scripted();
    await expect(guardedFetch(url, init(), { proxyFetch })).rejects.toThrow(
      FetchTargetError,
    );
    expect(proxyFetch).not.toHaveBeenCalled();
  });

  it("allows loopback and private literals", async () => {
    const proxyFetch = scripted(new Response("a"), new Response("b"));
    await guardedFetch("http://127.0.0.1:6274/", init(), { proxyFetch });
    await guardedFetch("http://192.168.1.10/", init(), { proxyFetch });
    expect(proxyFetch).toHaveBeenCalledTimes(2);
  });

  it("refuses a hostname that resolves locally to a blocked address", async () => {
    const proxyFetch = scripted();
    await expect(
      guardedFetch("http://metadata.test/", init(), {
        proxyFetch,
        resolveHost: async () => ["169.254.169.254"],
      }),
    ).rejects.toThrow(FetchTargetError);
    expect(proxyFetch).not.toHaveBeenCalled();
  });

  it("allows a hostname that resolves locally to a permitted address", async () => {
    const proxyFetch = scripted(new Response("ok"));
    await guardedFetch("http://as.example/", init(), {
      proxyFetch,
      resolveHost: async () => ["10.1.2.3"],
    });
    expect(proxyFetch).toHaveBeenCalledTimes(1);
  });

  it("forwards method, headers, body and signal on each hop", async () => {
    const proxyFetch = scripted(new Response("ok"));
    const controller = new AbortController();
    await guardedFetch(
      "http://as.example/token",
      init({
        method: "POST",
        headers: { "x-probe": "1" },
        body: "a=b",
        signal: controller.signal,
      }),
      { proxyFetch, resolveHost: resolvesNowhere },
    );
    const sent = proxyFetch.mock.calls[0]?.[1];
    expect(sent?.method).toBe("POST");
    expect(sent?.body).toBe("a=b");
    expect(sent?.signal).toBe(controller.signal);
    expect(new Headers(sent?.headers).get("x-probe")).toBe("1");
  });
});
