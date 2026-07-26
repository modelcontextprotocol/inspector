import { describe, it, expect } from "vitest";
import { formatHostForUrl } from "@inspector/core/node/hostUrl.js";

describe("formatHostForUrl", () => {
  it.each([
    ["::1", "[::1]"],
    ["fe80::1", "[fe80::1]"],
    ["  ::1  ", "[::1]"],
    ["fe80::1%eth0", "[fe80::1]"], // zone id dropped — a URL host can't carry one
    ["::1%lo0", "[::1]"],
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
