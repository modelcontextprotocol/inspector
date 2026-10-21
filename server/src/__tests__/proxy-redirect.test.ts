/**
 * Unit tests for proxy-redirect.ts — the per-hop request rewrite the `/fetch`
 * proxy's manual redirect loop applies.
 *
 * Tests cover:
 *  - every redirect status (301/302/303/307/308): method/body semantics
 *  - same-origin hops keep credentials; scheme, host and port changes drop them
 *  - header names are matched case-insensitively
 *  - a dropped header does not come back on a later hop
 *  - the caller's headers object is never mutated
 *  - normalizeProxyHeaders: the JSON-supplied headers shape
 */

import { describe, it, expect } from "vitest";
import {
  nextRedirectRequest,
  normalizeProxyHeaders,
  type ProxyHopRequest,
} from "../proxy-redirect.js";

const CREDENTIALS = {
  Authorization: "Bearer secret-token",
  "Proxy-Authorization": "Basic cHJveHk6c2VjcmV0",
  Cookie: "session=abc123",
  Cookie2: "$Version=1",
  "WWW-Authenticate": "Bearer",
};

function request(overrides: Partial<ProxyHopRequest> = {}): ProxyHopRequest {
  return {
    url: new URL("https://auth.example.com/token"),
    method: "POST",
    body: "grant_type=refresh_token&refresh_token=r1",
    headers: {
      ...CREDENTIALS,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    ...overrides,
  };
}

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

describe("nextRedirectRequest", () => {
  describe("method and body", () => {
    it.each([301, 302])("%i turns a POST into a bodyless GET", (status) => {
      const next = nextRedirectRequest(request(), status, "/token2");
      expect(next.method).toBe("GET");
      expect(next.body).toBeUndefined();
      expect(next.headers).not.toHaveProperty("Content-Type");
      expect(next.headers.Accept).toBe("application/json");
    });

    it.each([301, 302])("%i keeps a non-POST method and body", (status) => {
      const next = nextRedirectRequest(
        request({ method: "PUT", body: "payload" }),
        status,
        "/token2",
      );
      expect(next.method).toBe("PUT");
      expect(next.body).toBe("payload");
      expect(next.headers["Content-Type"]).toBe(
        "application/x-www-form-urlencoded",
      );
    });

    it("301/302 match the method case-insensitively", () => {
      const next = nextRedirectRequest(request({ method: "post" }), 302, "/b");
      expect(next.method).toBe("GET");
      expect(next.body).toBeUndefined();
    });

    it.each(["POST", "PUT", "DELETE", "PATCH"])(
      "303 turns %s into a bodyless GET",
      (method) => {
        const next = nextRedirectRequest(request({ method }), 303, "/done");
        expect(next.method).toBe("GET");
        expect(next.body).toBeUndefined();
        expect(next.headers).not.toHaveProperty("Content-Type");
      },
    );

    it.each(["GET", "HEAD", "head"])("303 keeps %s", (method) => {
      const next = nextRedirectRequest(
        request({ method, body: undefined }),
        303,
        "/done",
      );
      expect(next.method).toBe(method);
    });

    it.each([307, 308])("%i keeps the method and body", (status) => {
      const next = nextRedirectRequest(request(), status, "/token2");
      expect(next.method).toBe("POST");
      expect(next.body).toBe("grant_type=refresh_token&refresh_token=r1");
      expect(next.headers["Content-Type"]).toBe(
        "application/x-www-form-urlencoded",
      );
    });

    it("drops every body-describing header when the body is dropped", () => {
      const next = nextRedirectRequest(
        request({
          headers: {
            "content-type": "text/plain",
            "Content-Length": "9",
            "Content-Encoding": "gzip",
            "Content-Language": "en",
            "Content-Location": "/x",
            Accept: "*/*",
          },
        }),
        303,
        "/done",
      );
      expect(next.headers).toEqual({ Accept: "*/*" });
    });
  });

  describe("same-origin hops", () => {
    it.each(REDIRECT_STATUSES)("%i keeps credential headers", (status) => {
      const next = nextRedirectRequest(request(), status, "/token2");
      expect(next.url.href).toBe("https://auth.example.com/token2");
      expect(next.headers).toMatchObject(CREDENTIALS);
    });

    it("treats an explicit default port as the same origin", () => {
      const next = nextRedirectRequest(
        request(),
        307,
        "https://auth.example.com:443/token2",
      );
      expect(next.headers).toMatchObject(CREDENTIALS);
    });
  });

  describe("cross-origin hops", () => {
    it.each(REDIRECT_STATUSES)(
      "%i to another host drops every credential header",
      (status) => {
        const next = nextRedirectRequest(
          request(),
          status,
          "https://attacker.example.net/collect",
        );
        expect(next.url.href).toBe("https://attacker.example.net/collect");
        for (const name of Object.keys(CREDENTIALS)) {
          expect(next.headers).not.toHaveProperty(name);
        }
        expect(next.headers.Accept).toBe("application/json");
      },
    );

    it.each([
      ["a subdomain", "https://evil.auth.example.com/token"],
      ["a parent domain", "https://example.com/token"],
      ["another port", "https://auth.example.com:8443/token"],
      ["an https→http downgrade", "http://auth.example.com/token"],
      ["a protocol-relative URL", "//other.example.org/token"],
    ])("drops credentials on a hop to %s", (_label, location) => {
      const next = nextRedirectRequest(request(), 307, location);
      expect(Object.keys(next.headers).map((n) => n.toLowerCase())).toEqual([
        "content-type",
        "accept",
      ]);
    });

    it("drops credentials on an http→https upgrade (still another origin)", () => {
      const next = nextRedirectRequest(
        request({ url: new URL("http://auth.example.com/token") }),
        308,
        "https://auth.example.com/token",
      );
      expect(next.headers).not.toHaveProperty("Authorization");
    });

    it("matches credential header names case-insensitively", () => {
      const next = nextRedirectRequest(
        request({
          headers: {
            authorization: "Bearer a",
            AUTHORIZATION: "Bearer b",
            "proxy-AUTHORIZATION": "Basic c",
            cOoKiE: "s=1",
            cookie2: "$Version=1",
            "www-authenticate": "Bearer",
            "X-Custom": "kept",
          },
        }),
        302,
        "https://other.example.org/",
      );
      expect(next.headers).toEqual({ "X-Custom": "kept" });
    });

    it("does not restore a dropped header on a later same-origin hop", () => {
      const first = nextRedirectRequest(
        request(),
        307,
        "https://other.example.org/a",
      );
      const second = nextRedirectRequest(first, 307, "/b");
      const back = nextRedirectRequest(
        second,
        307,
        "https://auth.example.com/token",
      );
      for (const hop of [first, second, back]) {
        expect(hop.headers).not.toHaveProperty("Authorization");
        expect(hop.headers).not.toHaveProperty("Cookie");
      }
    });
  });

  it("never mutates the caller's headers object", () => {
    const current = request();
    const before = { ...current.headers };
    nextRedirectRequest(current, 303, "https://other.example.org/");
    expect(current.headers).toEqual(before);
  });

  it("resolves a relative Location against the current URL", () => {
    const next = nextRedirectRequest(
      request({ url: new URL("https://auth.example.com/a/b") }),
      302,
      "../c?x=1",
    );
    expect(next.url.href).toBe("https://auth.example.com/c?x=1");
  });

  it("drops credentials on a hop to a non-http scheme", () => {
    // The loop rejects the scheme before fetching; the rewrite still treats
    // the opaque origin as a different one.
    const next = nextRedirectRequest(request(), 302, "file:///etc/passwd");
    expect(next.url.protocol).toBe("file:");
    expect(next.headers).not.toHaveProperty("Authorization");
  });
});

describe("normalizeProxyHeaders", () => {
  it("copies string-valued entries", () => {
    const raw = { Authorization: "Bearer x", accept: "*/*" };
    const headers = normalizeProxyHeaders(raw);
    expect(headers).toEqual(raw);
    expect(headers).not.toBe(raw);
  });

  it("ignores entries whose value is not a string", () => {
    expect(
      normalizeProxyHeaders({ a: "1", b: 2, c: null, d: ["x"], e: {} }),
    ).toEqual({ a: "1" });
  });

  it.each([undefined, null, "Authorization: x", 42, [["a", "b"]]])(
    "returns no headers for %j",
    (raw) => {
      expect(normalizeProxyHeaders(raw)).toEqual({});
    },
  );
});
