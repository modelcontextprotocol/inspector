import { describe, it, expect } from "vitest";
import {
  BIND_ALL_INTERFACES_ENV,
  isAllInterfacesHost,
  resolveBindHostname,
} from "../../../../server/resolve-bind-host.js";

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
  ])("does not flag the loopback/specific host %j", (host) => {
    expect(isAllInterfacesHost(host)).toBe(false);
  });
});

describe("resolveBindHostname", () => {
  it("defaults to localhost when HOST is unset", () => {
    expect(resolveBindHostname({})).toBe("localhost");
  });

  it("returns a loopback HOST unchanged", () => {
    expect(resolveBindHostname({ HOST: "127.0.0.1" })).toBe("127.0.0.1");
  });

  it("trims the returned host so detection and the bind value agree", () => {
    expect(resolveBindHostname({ HOST: "  127.0.0.1  " })).toBe("127.0.0.1");
  });

  it("returns a bracketed IPv6 HOST bare so listen() can bind it", () => {
    expect(resolveBindHostname({ HOST: "[::1]" })).toBe("::1");
  });

  it("keeps the zone index on a link-local HOST for listen()", () => {
    // The guard must not throw on a zone-scoped host, and must return it with
    // the zone intact (listen() needs the zone to pick the interface).
    expect(resolveBindHostname({ HOST: "fe80::1%eth0" })).toBe("fe80::1%eth0");
  });

  it.each(["0.0.0.0", "::", "", "0", "0x0.0.0.0", "::ffff:0.0.0.0", "  0  "])(
    "refuses the all-interfaces host %j without the opt-in",
    (host) => {
      expect(() => resolveBindHostname({ HOST: host })).toThrow(
        new RegExp(BIND_ALL_INTERFACES_ENV),
      );
    },
  );

  it.each(["true", "TRUE", "1", " true "])(
    "allows 0.0.0.0 when the opt-in is %j",
    (flag) => {
      expect(
        resolveBindHostname({
          HOST: "0.0.0.0",
          [BIND_ALL_INTERFACES_ENV]: flag,
        }),
      ).toBe("0.0.0.0");
    },
  );

  it.each(["false", "0", "", "yes", "no"])(
    "still refuses 0.0.0.0 when the opt-in reads %j",
    (flag) => {
      expect(() =>
        resolveBindHostname({
          HOST: "0.0.0.0",
          [BIND_ALL_INTERFACES_ENV]: flag,
        }),
      ).toThrow();
    },
  );
});
