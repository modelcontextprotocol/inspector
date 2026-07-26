import { describe, it, expect } from "vitest";
import {
  canonicalUrlHost,
  formatHostForUrl,
  stripBrackets,
} from "@inspector/core/node/hostUrl.js";

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
