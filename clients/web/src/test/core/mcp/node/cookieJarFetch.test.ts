/**
 * Unit coverage for the connection-scoped cookie jar (#2936).
 *
 * Cookies are credentials, so most of these cases are about where the jar
 * must NOT act: another origin (OAuth discovery and token requests share the
 * transport's fetch), an expired or deleted cookie, an oversized or malformed
 * line, and a second connection's jar. The live-transport half — that the real
 * SDK transports carry the replayed cookie through a sticky load balancer — is
 * `integration/mcp/cookie-jar-affinity.test.ts`.
 */
import { describe, it, expect, vi } from "vitest";
import {
  ConnectionCookieJar,
  createCookieJarFetch,
  parseSetCookie,
  MAX_COOKIES,
  MAX_COOKIE_BYTES,
} from "@inspector/core/mcp/node/cookieJarFetch.js";

const SERVER = new URL("https://mcp.example.com/mcp");

/**
 * A response carrying `Set-Cookie` lines. The unit project runs under
 * happy-dom, whose `Headers` drops `Set-Cookie` as a browser's would, so the
 * lines are served from a stand-in `headers` exposing the one method the
 * wrapper reads. Node's real `Headers` path is exercised end to end by the
 * integration test named above.
 */
function respondWith(...setCookie: string[]): Response {
  const response = new Response("ok", { status: 200 });
  Object.defineProperty(response, "headers", {
    value: { getSetCookie: () => setCookie },
  });
  return response;
}

/** The `Cookie` header the base fetch saw on call `n` (0-based). */
function sentCookie(
  baseFetch: ReturnType<typeof vi.fn>,
  n: number,
): string | null {
  const [input, init] = baseFetch.mock.calls[n] as Parameters<typeof fetch>;
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  return headers.get("cookie");
}

function setup(responses: Response[], now: () => number = Date.now) {
  const baseFetch = vi.fn(async () => responses.shift() ?? respondWith());
  const jar = new ConnectionCookieJar(now);
  return {
    baseFetch,
    jar,
    fetchFn: createCookieJarFetch(baseFetch, SERVER, jar),
  };
}

describe("createCookieJarFetch (#2936)", () => {
  it("stores Set-Cookie from the server's origin and replays it on later requests", async () => {
    const { baseFetch, fetchFn } = setup([
      respondWith("lb=pod-a; Path=/; HttpOnly", "other=1"),
    ]);
    await fetchFn(SERVER.href, { method: "POST" });
    expect(sentCookie(baseFetch, 0)).toBeNull();
    await fetchFn(SERVER.href, { method: "POST" });
    expect(sentCookie(baseFetch, 1)).toBe("lb=pod-a; other=1");
  });

  it("passes the request through untouched while the jar is empty", async () => {
    const { baseFetch, fetchFn } = setup([]);
    const init = { method: "POST", headers: { "x-a": "1" } };
    await fetchFn(SERVER.href, init);
    expect(baseFetch).toHaveBeenCalledWith(SERVER.href, init);
  });

  it("replays onto URL and Request inputs, keeping the Request's headers", async () => {
    const { baseFetch, fetchFn } = setup([respondWith("lb=pod-a")]);
    await fetchFn(new URL(SERVER.href));
    await fetchFn(new Request(SERVER.href, { headers: { "x-keep": "yes" } }));
    expect(sentCookie(baseFetch, 1)).toBe("lb=pod-a");
    const [, init] = baseFetch.mock.calls[1] as Parameters<typeof fetch>;
    expect(new Headers(init?.headers).get("x-keep")).toBe("yes");
  });

  it("merges onto an explicit Cookie header, which wins on a shared name", async () => {
    const { baseFetch, fetchFn } = setup([respondWith("lb=pod-a", "tok=jar")]);
    await fetchFn(SERVER.href);
    await fetchFn(SERVER.href, { headers: { cookie: "tok=static; =x; flag" } });
    expect(sentCookie(baseFetch, 1)).toBe("tok=static; =x; flag; lb=pod-a");
  });

  it("leaves an explicit Cookie header alone when the jar has nothing new", async () => {
    const { baseFetch, fetchFn } = setup([respondWith("tok=jar")]);
    await fetchFn(SERVER.href);
    const init = { headers: { cookie: "tok=static" } };
    await fetchFn(SERVER.href, init);
    expect(baseFetch.mock.calls[1]).toEqual([SERVER.href, init]);
  });

  it("neither stores from nor replays to another origin", async () => {
    const { baseFetch, fetchFn, jar } = setup([
      respondWith("auth=secret"),
      respondWith("lb=pod-a"),
    ]);
    await fetchFn("https://auth.example.com/token", { method: "POST" });
    expect(jar.size).toBe(0);
    await fetchFn(SERVER.href);
    await fetchFn("https://auth.example.com/token");
    await fetchFn("http://mcp.example.com/mcp");
    await fetchFn("https://mcp.example.com:8443/mcp");
    expect(sentCookie(baseFetch, 2)).toBeNull();
    expect(sentCookie(baseFetch, 3)).toBeNull();
    expect(sentCookie(baseFetch, 4)).toBeNull();
  });

  it("replays to any path on the server's origin", async () => {
    const { baseFetch, fetchFn } = setup([respondWith("lb=pod-a; Path=/mcp")]);
    await fetchFn(SERVER.href);
    await fetchFn("https://mcp.example.com/messages?sessionId=1");
    expect(sentCookie(baseFetch, 1)).toBe("lb=pod-a");
  });

  it("passes an unparseable URL through untouched", async () => {
    const { baseFetch, fetchFn } = setup([respondWith("lb=pod-a")]);
    await fetchFn("not a url");
    expect(baseFetch).toHaveBeenCalledWith("not a url", undefined);
  });

  it("keeps separate jars separate", async () => {
    const first = setup([respondWith("lb=pod-a")]);
    const second = setup([]);
    await first.fetchFn(SERVER.href);
    await second.fetchFn(SERVER.href);
    expect(sentCookie(second.baseFetch, 0)).toBeNull();
  });
});

describe("ConnectionCookieJar (#2936)", () => {
  it("overwrites a same-name cookie", () => {
    const jar = new ConnectionCookieJar();
    jar.store(["lb=pod-a"]);
    jar.store(["lb=pod-b"]);
    expect(jar.cookieHeader()).toBe("lb=pod-b");
  });

  it("expires by Max-Age, which wins over Expires", () => {
    let now = 1_000_000;
    const jar = new ConnectionCookieJar(() => now);
    const farFuture = new Date(now + 3_600_000).toUTCString();
    jar.store([`lb=pod-a; Expires=${farFuture}; Max-Age=10`]);
    expect(jar.cookieHeader()).toBe("lb=pod-a");
    now += 10_000;
    expect(jar.cookieHeader()).toBeUndefined();
  });

  it("expires by Expires when there is no Max-Age", () => {
    let now = Date.parse("2026-01-01T00:00:00Z");
    const jar = new ConnectionCookieJar(() => now);
    jar.store(["lb=pod-a; Expires=Thu, 01 Jan 2026 00:01:00 GMT"]);
    expect(jar.size).toBe(1);
    now += 60_000;
    expect(jar.size).toBe(0);
  });

  it("deletes a cookie the server expires", () => {
    const jar = new ConnectionCookieJar();
    jar.store(["lb=pod-a", "keep=1"]);
    jar.store(["lb=; Max-Age=0"]);
    expect(jar.cookieHeader()).toBe("keep=1");
    jar.store(["keep=; Expires=Thu, 01 Jan 1970 00:00:00 GMT"]);
    expect(jar.cookieHeader()).toBeUndefined();
  });

  it("evicts the oldest entry past MAX_COOKIES", () => {
    const jar = new ConnectionCookieJar();
    jar.store(Array.from({ length: MAX_COOKIES + 1 }, (_, i) => `c${i}=${i}`));
    expect(jar.size).toBe(MAX_COOKIES);
    expect(jar.cookieHeader()).not.toMatch(/(^|; )c0=/);
    expect(jar.cookieHeader()).toMatch(new RegExp(`c${MAX_COOKIES}=`));
  });

  it("refreshes an overwritten cookie's age so it is not evicted first", () => {
    const jar = new ConnectionCookieJar();
    jar.store(Array.from({ length: MAX_COOKIES }, (_, i) => `c${i}=${i}`));
    jar.store(["c0=again", "extra=1"]);
    expect(jar.cookieHeader()).toMatch(/c0=again/);
    expect(jar.cookieHeader()).not.toMatch(/(^|; )c1=/);
  });

  it("drops malformed and oversized lines", () => {
    const jar = new ConnectionCookieJar();
    jar.store([
      "no-equals-sign",
      "=no-name",
      `big=${"x".repeat(MAX_COOKIE_BYTES)}`,
      "ok=1",
    ]);
    expect(jar.cookieHeader()).toBe("ok=1");
  });
});

describe("parseSetCookie (#2936)", () => {
  const now = 1_000;

  it("reads name, value and session lifetime, ignoring other attributes", () => {
    expect(
      parseSetCookie(" lb = pod-a ; Path=/; Secure; HttpOnly; Domain=x", now),
    ).toEqual({ name: "lb", value: "pod-a", expiresAt: undefined });
  });

  it("ignores a non-numeric Max-Age and an unparseable Expires", () => {
    expect(
      parseSetCookie("lb=a; Max-Age=soon; Expires=never", now)?.expiresAt,
    ).toBeUndefined();
  });

  it("treats a negative Max-Age as already expired", () => {
    expect(parseSetCookie("lb=a; max-age=-1", now)?.expiresAt).toBe(now);
  });

  it("accepts a pair exactly at the byte limit", () => {
    const value = "x".repeat(MAX_COOKIE_BYTES - "lb=".length);
    expect(parseSetCookie(`lb=${value}`, now)?.value).toBe(value);
  });
});
