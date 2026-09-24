import { describe, it, expect } from "vitest";
import {
  customHeadersChanged,
  effectiveCustomHeaders,
} from "./transportHeaders";

const rows = (...pairs: [string, string][]) => ({
  headers: pairs.map(([key, value]) => ({ key, value })),
});

describe("effectiveCustomHeaders", () => {
  it("is empty for undefined settings", () => {
    expect(effectiveCustomHeaders(undefined)).toEqual({});
  });

  it("skips blank keys, lowercases names and lets a later row win", () => {
    expect(
      effectiveCustomHeaders(
        rows(["X-Tenant", "a"], ["  ", "ignored"], ["x-tenant", "b"]),
      ),
    ).toEqual({ "x-tenant": "b" });
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

  it("is false when neither side has headers", () => {
    expect(customHeadersChanged(undefined, rows())).toBe(false);
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

  it("is true when a header is renamed with the same count", () => {
    expect(customHeadersChanged(rows(["X-A", "1"]), rows(["X-B", "1"]))).toBe(
      true,
    );
  });

  it("is true when a value changes", () => {
    expect(customHeadersChanged(rows(["X-A", "1"]), rows(["X-A", "2"]))).toBe(
      true,
    );
  });
});
