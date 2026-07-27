import { describe, it, expect } from "vitest";
import {
  BIND_ALL_INTERFACES_ENV,
  resolveBindHostname,
} from "../../../../server/resolve-bind-host.js";

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

  it.each([
    "0.0.0.0",
    "::",
    "",
    "0",
    "0x0.0.0.0",
    "::ffff:0.0.0.0",
    "  0  ",
    "０", // fullwidth "0" — the resolver binds it as 0.0.0.0, so the guard must refuse it
  ])("refuses the all-interfaces host %j without the opt-in", (host) => {
    expect(() => resolveBindHostname({ HOST: host })).toThrow(
      new RegExp(BIND_ALL_INTERFACES_ENV),
    );
  });

  it("names the resolved wildcard address when the spelling differs (fullwidth)", () => {
    // `HOST="０"` renders like `0`, so the message shows it resolves to 0.0.0.0.
    expect(() => resolveBindHostname({ HOST: "０" })).toThrow(
      /resolves to 0\.0\.0\.0/,
    );
  });

  it("does not add a resolved-address hint for an already-canonical bracketed HOST", () => {
    // `HOST="[::]"` is accepted-then-refused as the wildcard; the message must
    // not read "(resolves to [::])" — same value, just bracketed. Capture the
    // message outside try/catch so a stopped-throwing regression reports clearly.
    let message = "";
    expect(() => {
      try {
        resolveBindHostname({ HOST: "[::]" });
      } catch (err) {
        message = (err as Error).message;
        throw err;
      }
    }).toThrow(BIND_ALL_INTERFACES_ENV);
    expect(message).not.toContain("resolves to");
  });

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
