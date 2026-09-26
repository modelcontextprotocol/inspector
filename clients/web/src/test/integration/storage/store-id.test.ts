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

  it("rejects `__proto__` but keeps other Object.prototype names valid", () => {
    // A plain `map[id] = …` assignment with `__proto__` would invoke the
    // prototype setter and silently drop the entry, so it alone is refused.
    // Other inherited names (`constructor`, `toString`, …) were valid ids
    // before this check existed and must stay valid — pre-existing mcp.json
    // entries would otherwise list in GET but be refused by PUT/DELETE.
    // They are safe because all dynamic-key map access is own-property
    // based (`Object.hasOwn`, `getOwnEntry`/`setOwnEntry`).
    expect(validateStoreId("__proto__")).toBe(false);
    for (const name of Object.getOwnPropertyNames(Object.prototype)) {
      if (name === "__proto__") continue;
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) continue; // out of charset anyway
      expect(validateStoreId(name), name).toBe(true);
    }
    // Ordinary underscore names stay valid too.
    expect(validateStoreId("__internal__")).toBe(true);
  });

  it("is re-exported from store-io for back-compat", () => {
    expect(reexported).toBe(validateStoreId);
  });
});
