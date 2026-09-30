/**
 * Direct tests of the own-property map helpers. The OAuth persistence and
 * catalog paths exercise these through their own suites; this file pins the
 * helper contract itself — every branch, with the `__proto__` key that
 * motivates the module.
 */
import { describe, it, expect } from "vitest";
import { setOwnEntry, getOwnEntry } from "@inspector/core/storage/own-entry.js";

describe("setOwnEntry", () => {
  it("creates an own, enumerable, writable entry for __proto__", () => {
    const map: Record<string, string> = {};
    setOwnEntry(map, "__proto__", "value");
    expect(Object.hasOwn(map, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(map)).toBe(Object.prototype);
    expect(JSON.stringify(map)).toContain("value");
    // Writable + configurable: a second write and a delete both work.
    setOwnEntry(map, "__proto__", "next");
    expect(getOwnEntry(map, "__proto__")).toBe("next");
    delete map["__proto__"];
    expect(Object.hasOwn(map, "__proto__")).toBe(false);
  });
});

describe("getOwnEntry", () => {
  it("returns an own entry", () => {
    expect(getOwnEntry({ a: 1 }, "a")).toBe(1);
  });

  it("returns undefined for a missing inherited name instead of the prototype member", () => {
    expect(getOwnEntry({}, "__proto__")).toBeUndefined();
    expect(getOwnEntry({}, "constructor")).toBeUndefined();
    expect(getOwnEntry({}, "toString")).toBeUndefined();
  });

  it("returns undefined for an undefined map", () => {
    expect(getOwnEntry(undefined, "a")).toBeUndefined();
  });
});
