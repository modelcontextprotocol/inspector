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

  it("rejects __proto__ despite matching the character class", () => {
    // As a map key a plain `map[id] = …` assignment would invoke the
    // prototype setter and silently drop the entry.
    expect(validateStoreId("__proto__")).toBe(false);
    // Ordinary underscore names stay valid.
    expect(validateStoreId("__internal__")).toBe(true);
  });

  it("is re-exported from store-io for back-compat", () => {
    expect(reexported).toBe(validateStoreId);
  });
});
