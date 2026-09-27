// Pins the reconnect notice's header comparison (#2460) to what the transport
// actually sends: rows resolved as `headersFromSettings` resolves them, then
// normalized as the Fetch spec's `Headers` normalizes them. A difference the
// server cannot see must not prompt a reconnect, and one it can must.
import { describe, it, expect } from "vitest";
import {
  customHeadersChanged,
  transportHeaderRecord,
  wireHeaderLines,
} from "./transportHeaders";

const rows = (...pairs: [string, string][]) => ({
  headers: pairs.map(([key, value]) => ({ key, value })),
});

describe("transportHeaderRecord", () => {
  it("is empty for undefined settings", () => {
    expect(transportHeaderRecord(undefined)).toEqual({});
  });

  it("skips blank keys, keeps case variants apart and lets a later identical name win", () => {
    expect(
      transportHeaderRecord(
        rows(
          ["X-Tenant", "a"],
          ["  ", "ignored"],
          ["x-tenant", "b"],
          ["X-Tenant", "c"],
        ),
      ),
    ).toEqual({ "X-Tenant": "c", "x-tenant": "b" });
  });
});

describe("wireHeaderLines", () => {
  it("joins case-variant duplicates and trims values, as Headers does", () => {
    expect(
      wireHeaderLines(rows(["X-Tenant", "a"], ["x-tenant", " b "])),
    ).toEqual(["x-tenant: a, b"]);
  });
});

describe("customHeadersChanged", () => {
  it("is false for the same headers in a different order and case", () => {
    expect(
      customHeadersChanged(
        rows(["X-A", "1"], ["X-B", "2"]),
        rows(["x-b", "2"], ["x-a", "1"], ["", "blank row"]),
      ),
    ).toBe(false);
  });

  it("is false when only a value's surrounding whitespace changed", () => {
    expect(customHeadersChanged(rows(["X-A", "1"]), rows(["X-A", " 1 "]))).toBe(
      false,
    );
  });

  it("is false when neither side has headers", () => {
    expect(customHeadersChanged(undefined, rows())).toBe(false);
  });

  it("is true when removing a case-variant duplicate changes the joined value", () => {
    expect(
      customHeadersChanged(
        rows(["X-Tenant", "a"], ["x-tenant", "b"]),
        rows(["X-Tenant", "a"]),
      ),
    ).toBe(true);
  });

  it("is true when a header is added", () => {
    expect(
      customHeadersChanged(
        rows(["X-Auth-Token", "tok"]),
        rows(["X-Auth-Token", "tok"], ["X-Provider-Username", "user"]),
      ),
    ).toBe(true);
  });

  it("is true when a header is removed", () => {
    expect(customHeadersChanged(rows(["X-A", "1"]), undefined)).toBe(true);
  });

  it("is true when a value changes", () => {
    expect(customHeadersChanged(rows(["X-A", "1"]), rows(["X-A", "2"]))).toBe(
      true,
    );
  });
});
