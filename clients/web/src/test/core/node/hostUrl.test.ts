import { describe, it, expect } from "vitest";
import {
  canonicalUrlHost,
  formatHostForUrl,
  isAllInterfacesHost,
  stripBrackets,
} from "@inspector/core/node/hostUrl.js";

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
