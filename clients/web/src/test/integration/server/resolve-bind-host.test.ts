import { describe, it, expect } from "vitest";
import {
  BIND_ALL_INTERFACES_ENV,
  isAllInterfacesHost,
  resolveBindHostname,
} from "../../../../server/resolve-bind-host.js";

describe("isAllInterfacesHost", () => {
  it.each(["0.0.0.0", "::", "", "  0.0.0.0  ", "::"])(
    "flags the all-interfaces host %j",
    (host) => {
      expect(isAllInterfacesHost(host)).toBe(true);
    },
  );

  it.each(["localhost", "127.0.0.1", "::1", "[::1]", "example.com"])(
    "does not flag the loopback/named host %j",
    (host) => {
      expect(isAllInterfacesHost(host)).toBe(false);
    },
  );
});

describe("resolveBindHostname", () => {
  it("defaults to localhost when HOST is unset", () => {
    expect(resolveBindHostname({})).toBe("localhost");
  });

  it("returns a loopback HOST unchanged", () => {
    expect(resolveBindHostname({ HOST: "127.0.0.1" })).toBe("127.0.0.1");
  });

  it.each(["0.0.0.0", "::", ""])(
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
