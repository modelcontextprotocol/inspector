import { describe, it, expect } from "vitest";
import {
  canonicalOriginHost,
  canonicalUrlHost,
  formatHostForUrl,
  isAllInterfacesHost,
  isLocalhostSubdomainHost,
  isLocalhostSubdomainOrigin,
  isLoopbackHost,
  stripBrackets,
} from "@inspector/core/node/hostUrl.js";

describe("isLoopbackHost", () => {
  it.each([
    "localhost",
    "LOCALHOST",
    "127.0.0.1",
    "127.5", // 127.0.0.0/8 shorthand
    "0x7f.0.0.1",
    "2130706433",
    "::1",
    "[::1]",
    "0:0:0:0:0:0:0:1",
    "::ffff:127.0.0.1", // IPv4-mapped loopback → unmapped to 127.0.0.1
    "::ffff:7f00:1", // its canonical serialization (what new URL().hostname yields)
    "127.255.255.255", // top of 127.0.0.0/8
    "localhost.", // root-anchored FQDN (WHATWG keeps the dot; binds loopback)
    "127.0.0.1.", // trailing dot on an IP literal (WHATWG strips it)
  ])("flags the loopback host %j", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each([
    "0.0.0.0",
    "::",
    "192.168.1.50",
    "example.com",
    "126.0.0.1", // adjacent to but outside 127/8
    "128.0.0.1",
    "0.0.0.127", // bare "127" resolves here, not loopback
    "", // empty is the wildcard (isAllInterfacesHost's job), not loopback
    // Out-of-range octets survive canonicalUrlHost's non-URL fallback — the
    // bounded regex must still reject them.
    "127.999.0.1",
    "127.0.0.256",
  ])("does not flag the non-loopback host %j", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});

describe("isAllInterfacesHost", () => {
  it.each([
    "0.0.0.0",
    "::",
    "",
    "  0.0.0.0  ",
    "  ::  ",
    "[::]",
    "0:0:0:0:0:0:0:0",
    "::ffff:0.0.0.0",
    "::ffff:0:0",
    // IPv6 wildcard spellings that canonicalize to `::`.
    "::0",
    "0::0",
    "::0.0.0.0",
    "0:0::0",
    "0000:0000:0000:0000:0000:0000:0000:0000",
    // Zone-scoped wildcard: net.isIPv6 accepts the %zone, new URL() rejects it,
    // so the zone must be stripped before canonicalizing (else it throws).
    "::%eth0",
    // Legacy inet_aton spellings the OS still binds as 0.0.0.0.
    "0",
    "0x0",
    "0x0.0.0.0",
    "000.000.000.000",
    "0.0", // short inet_aton form (1–3 parts) still binds the wildcard
    "0.0.0",
    "00000000000", // bare octal zero — parseAddressPart's [0-9]+ handles octal
    "0x00000000", // bare hex zero
    // Fullwidth (IDNA-mapped) spellings the resolver folds to 0.0.0.0 before
    // binding — the guard must canonicalize, not read the raw string.
    "０", // fullwidth "0"
    "０0.0.0", // fullwidth "0" + ".0.0"
    "0．0．0．0", // fullwidth dots
  ])("flags the all-interfaces host %j", (host) => {
    expect(isAllInterfacesHost(host)).toBe(true);
  });

  it.each([
    "localhost",
    "127.0.0.1",
    "::1",
    "[::1]",
    "example.com",
    "192.168.1.50",
    "1.0.0.0",
    "0.0.0.1",
    "::ffff:0", // canonicalizes to ::ffff:0, a distinct address — not the wildcard
    "0.0.0.0.0", // 5 octets — not a valid IPv4, must not be flagged (parts.length > 4)
    "fe80::1%eth0", // a zone-scoped link-local — a real bind host, not the wildcard
    "::1%lo0", // zone-scoped loopback — must not be flagged and must not throw
    "１２７.0.0.1", // fullwidth 127 → 127.0.0.1, a real loopback address, not the wildcard
  ])("does not flag the loopback/specific host %j", (host) => {
    expect(isAllInterfacesHost(host)).toBe(false);
  });
});

describe("formatHostForUrl", () => {
  it.each([
    ["::1", "[::1]"],
    ["fe80::1", "[fe80::1]"],
    ["  ::1  ", "[::1]"],
    ["fe80::1%eth0", "[fe80::1]"], // zone id dropped — a URL host can't carry one
    ["::1%lo0", "[::1]"],
    ["[fe80::1%eth0]", "[fe80::1]"], // bracketed-with-zone → still a valid URL host
  ])("brackets the IPv6 literal %j", (host, expected) => {
    expect(formatHostForUrl(host)).toBe(expected);
  });

  it.each(["localhost", "127.0.0.1", "192.168.1.50", "example.com", "[::1]"])(
    "passes the non-IPv6 / already-bracketed host %j through",
    (host) => {
      expect(formatHostForUrl(host)).toBe(host.trim());
    },
  );

  it("does not bracket a non-IPv6 value that merely contains a colon", () => {
    // A mistyped host:port must not be wrapped as [host:port].
    expect(formatHostForUrl("localhost:6274")).toBe("localhost:6274");
  });
});

describe("stripBrackets", () => {
  it.each([
    ["[::1]", "::1"],
    ["[fe80::1%eth0]", "fe80::1%eth0"],
    ["[]", ""], // zero-or-more: an empty bracket pair reduces to ""
    ["127.0.0.1", "127.0.0.1"],
  ])("strips a surrounding bracket pair from %j", (host, expected) => {
    expect(stripBrackets(host)).toBe(expected);
  });
});

describe("canonicalUrlHost", () => {
  it.each([
    ["127.1", "127.0.0.1"],
    ["0x7f.0.0.1", "127.0.0.1"],
    ["2130706433", "127.0.0.1"],
    ["0:0:0:0:0:0:0:1", "[::1]"],
    ["::0001", "[::1]"],
    ["LOCALHOST", "localhost"],
    ["Example.COM", "example.com"],
    ["fe80::1", "[fe80::1]"],
    // IPv4-mapped IPv6 → the dotted IPv4 the socket answers on (intentional
    // divergence from browser canonicalization).
    ["::ffff:127.0.0.1", "127.0.0.1"],
    ["::ffff:192.168.1.50", "192.168.1.50"],
    // A distinct address is unchanged.
    ["127.0.0.2", "127.0.0.2"],
  ])("canonicalizes %j to %j", (host, expected) => {
    expect(canonicalUrlHost(host)).toBe(expected);
  });

  it("falls back to the formatted value when the host isn't a parseable URL", () => {
    expect(canonicalUrlHost("")).toBe("");
  });
});

describe("isLocalhostSubdomainHost", () => {
  it.each([
    "app.localhost",
    "tenant.example.localhost",
    // Canonicalized first, so casing is normalized rather than rejected.
    "APP.LOCALHOST",
    // IDNA-mapped to punycode by `new URL`, exactly as a browser would.
    "münchen.localhost",
  ])("accepts %j", (host) => {
    expect(isLocalhostSubdomainHost(host)).toBe(true);
  });

  it.each([
    // The bare TLD is deliberately NOT matched: callers that want it carry it
    // as a literal origin already.
    "localhost",
    // The root-dotted form is rejected ON PURPOSE, and this is the case that
    // keeps it that way: CSP's `*.localhost` host-source cannot match it, so
    // accepting it here would let /api/* answer an embedder whose MCP Apps
    // frame the sandbox CSP then blanks.
    "app.localhost.",
    "localhost.",
    // Degenerate labels.
    ".localhost",
    "a..localhost",
    // The suffix trap: `.localhost` must be the END of the name, not a label
    // in the middle of an attacker-registrable one.
    "app.localhost.evil.com",
    "localhost.evil.com",
    // Near-misses that must not be read as the reserved suffix.
    "notlocalhost",
    "mylocalhost",
    "localhosts",
    "evil.com",
    "127.0.0.1",
    "[::1]",
    "",
  ])("rejects %j", (host) => {
    expect(isLocalhostSubdomainHost(host)).toBe(false);
  });
});

describe("isLocalhostSubdomainOrigin", () => {
  it.each([
    "http://app.localhost",
    "http://app.localhost:3300",
    // Any port, because the point is a reverse proxy on a port we don't know.
    "http://tenant.example.localhost:8080",
    // Both schemes: a locally-trusted certificate (mkcert) makes the same host
    // arrive over https.
    "https://app.localhost",
    "https://app.localhost:8443",
  ])("accepts %j", (origin) => {
    expect(isLocalhostSubdomainOrigin(origin)).toBe(true);
  });

  it.each([
    // The opaque-origin header value a sandboxed iframe or `data:` document
    // sends. Must never match — allow-listing it would erode the guard.
    "null",
    "http://localhost:6274",
    "http://evil.com",
    "http://app.localhost.evil.com",
    // Non-http(s) schemes, including ones that parse.
    "ws://app.localhost",
    "file://app.localhost",
    "chrome-extension://app.localhost",
    // Not a parseable URL at all.
    "app.localhost:3300",
    "",
  ])("rejects %j", (origin) => {
    expect(isLocalhostSubdomainOrigin(origin)).toBe(false);
  });
});

describe("canonicalOriginHost", () => {
  it.each([
    ["localhost.", "localhost"],
    ["LOCALHOST.", "localhost"],
    ["app.localhost.", "app.localhost"],
    ["tenant.example.localhost.", "tenant.example.localhost"],
  ])(
    "drops the root dot inside the loopback family: %j -> %j",
    (host, want) => {
      expect(canonicalOriginHost(host)).toBe(want);
    },
  );

  it.each([
    // A root dot is the ABSOLUTE form of a name, not noise. Dropping it changes
    // which host is meant: `service.example` is a distinct origin a resolver
    // may complete through a search suffix, or fail on. Advertising it for
    // `service.example.` would silently hand the user a different server.
    "service.example.",
    "example.com.",
    "inspector.internal.",
  ])("keeps the root dot on an absolute non-loopback name: %j", (host) => {
    expect(canonicalOriginHost(host)).toBe(host);
  });

  it.each([
    // Everything else behaves exactly as `canonicalUrlHost` does.
    "127.0.0.1",
    "localhost",
    "0.0.0.0",
    "example.com",
    "[::1]",
  ])("is canonicalUrlHost for %j", (host) => {
    expect(canonicalOriginHost(host)).toBe(canonicalUrlHost(host));
  });

  it("still unmaps an IPv4-mapped IPv6 bind host", () => {
    // That divergence belongs to bind hosts and is inherited deliberately; the
    // explicit-allow-list path deliberately does NOT use this helper for it.
    expect(canonicalOriginHost("[::ffff:127.0.0.1]")).toBe("127.0.0.1");
  });
});
