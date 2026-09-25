import { describe, it, expect } from "vitest";
import { validateStoreId } from "@inspector/core/storage/store-id.js";
import { validateStoreId as reexported } from "@inspector/core/storage/store-io.js";

describe("validateStoreId", () => {
  it("accepts alphanumerics, hyphens, and underscores", () => {
    expect(validateStoreId("my-server_1")).toBe(true);
    expect(validateStoreId("Server")).toBe(true);
  });

  it("rejects empty or out-of-charset ids", () => {
    expect(validateStoreId("")).toBe(false);
    expect(validateStoreId("bad id")).toBe(false);
    expect(validateStoreId("nope!")).toBe(false);
    expect(validateStoreId("a/b")).toBe(false);
  });

  it("rejects every Object.prototype name despite matching the character class", () => {
    // As a map key a plain `map[id] = …` assignment with `__proto__` would
    // invoke the prototype setter and silently drop the entry, and any
    // inherited name makes `id in map` answer true on an empty map — a
    // permanent false "duplicate" on create.
    expect(validateStoreId("__proto__")).toBe(false);
    for (const name of Object.getOwnPropertyNames(Object.prototype)) {
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) continue; // out of charset anyway
      expect(validateStoreId(name), name).toBe(false);
    }
    // Ordinary underscore names stay valid.
    expect(validateStoreId("__internal__")).toBe(true);
  });

  it("is re-exported from store-io for back-compat", () => {
    expect(reexported).toBe(validateStoreId);
  });
});
