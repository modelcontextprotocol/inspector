import { describe, it, expect } from "vitest";
import { formatHostForUrl } from "@inspector/core/node/hostUrl.js";

describe("formatHostForUrl", () => {
  it.each([
    ["::1", "[::1]"],
    ["fe80::1", "[fe80::1]"],
    ["  ::1  ", "[::1]"],
  ])("brackets the IPv6 literal %j", (host, expected) => {
    expect(formatHostForUrl(host)).toBe(expected);
  });

  it.each(["localhost", "127.0.0.1", "192.168.1.50", "example.com", "[::1]"])(
    "passes the non-IPv6 / already-bracketed host %j through",
    (host) => {
      expect(formatHostForUrl(host)).toBe(host.trim());
    },
  );
});
