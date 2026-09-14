import { describe, it, expect } from "vitest";
import {
  computeScopeUnion,
  isStrictScopeSuperset,
  resolveEffectiveGrantedScope,
  resolvePersistedScopeAfterGrant,
  scopeForDeclinedRefreshGrant,
} from "@inspector/core/auth/scopes.js";

describe("scopes", () => {
  describe("computeScopeUnion", () => {
    it("unions and dedupes scope tokens", () => {
      expect(
        computeScopeUnion("mcp tools:read", "tools:read weather:read"),
      ).toBe("mcp tools:read weather:read");
    });

    it("returns undefined when all inputs are empty", () => {
      expect(computeScopeUnion(undefined, "", undefined)).toBeUndefined();
    });
  });

  describe("isStrictScopeSuperset", () => {
    it("returns true when union adds a new scope", () => {
      expect(
        isStrictScopeSuperset("mcp tools:read weather:read", "mcp tools:read"),
      ).toBe(true);
    });

    it("returns false when union is covered by current grant", () => {
      expect(isStrictScopeSuperset("mcp tools:read", "mcp tools:read")).toBe(
        false,
      );
    });

    it("treats missing token scope as empty (forces re-auth)", () => {
      expect(isStrictScopeSuperset("mcp weather:read", undefined)).toBe(true);
    });
  });

  describe("resolvePersistedScopeAfterGrant", () => {
    it("prefers explicit granted scope over requested", () => {
      expect(resolvePersistedScopeAfterGrant("mcp", "mcp weather:read")).toBe(
        "mcp",
      );
    });

    it("falls back to requested scope when grant omits scope", () => {
      expect(
        resolvePersistedScopeAfterGrant(undefined, "mcp weather:read"),
      ).toBe("mcp weather:read");
    });
  });

  describe("resolveEffectiveGrantedScope", () => {
    it("uses token scope when present even if storage overstates grant", () => {
      expect(resolveEffectiveGrantedScope("mcp weather:read", "mcp")).toBe(
        "mcp",
      );
    });

    it("falls back to stored scope when token omits scope", () => {
      expect(resolveEffectiveGrantedScope("mcp tools:read", undefined)).toBe(
        "mcp tools:read",
      );
    });
  });
});

describe("scopeForDeclinedRefreshGrant (#2068)", () => {
  it("drops an inherited offline_access from the requested scope", () => {
    expect(scopeForDeclinedRefreshGrant("mcp offline_access", "mcp")).toBe(
      "mcp",
    );
  });

  // The persisted scope is what a previous default-on grant left behind, and
  // the configured scope may be unset entirely (DCR + resource-advertised
  // scopes). An inherited token is still inherited.
  it("drops it when no scope is configured at all", () => {
    expect(scopeForDeclinedRefreshGrant("mcp offline_access", undefined)).toBe(
      "mcp",
    );
  });

  it("keeps an offline_access the user explicitly configured", () => {
    expect(
      scopeForDeclinedRefreshGrant("mcp offline_access", "mcp offline_access"),
    ).toBe("mcp offline_access");
  });

  // Storage can predate the settings change — `createOAuthProvider` preserves a
  // stored scope rather than reseeding from current settings. Merely declining
  // to strip would silently omit a scope the user just typed, and the form's
  // "still requested" warning would be lying.
  it("adds a newly configured offline_access that stale storage lacks", () => {
    expect(scopeForDeclinedRefreshGrant("mcp", "mcp offline_access")).toBe(
      "mcp offline_access",
    );
  });

  // Only the token itself is added; unrelated configured scopes are not unioned
  // in, since widening the request could force a step-up authorization.
  it("does not union unrelated configured scopes into the request", () => {
    expect(
      scopeForDeclinedRefreshGrant("mcp", "tools:read offline_access"),
    ).toBe("mcp offline_access");
  });

  it("does not duplicate an offline_access already present", () => {
    expect(
      scopeForDeclinedRefreshGrant("  mcp  offline_access ", "offline_access"),
    ).toBe("mcp offline_access");
  });

  it("leaves a scope without offline_access untouched", () => {
    expect(scopeForDeclinedRefreshGrant("mcp tools:read", "mcp")).toBe(
      "mcp tools:read",
    );
  });

  // Requesting `scope=` empty is not the same as omitting it; collapse to
  // undefined so the SDK falls back to its own resolution.
  it("collapses to undefined when nothing is left and nothing is configured", () => {
    expect(scopeForDeclinedRefreshGrant("offline_access", "")).toBeUndefined();
    expect(
      scopeForDeclinedRefreshGrant("offline_access", undefined),
    ).toBeUndefined();
  });

  // Returning undefined here would read as "nothing stored" to
  // OAuthManager.createOAuthProvider, whose seeding branch writes the
  // configured scope to storage — turning a request-only filter into a silent
  // overwrite. The configured scope is both the right request and inert to that
  // branch.
  it("falls back to the configured scope rather than emptying out", () => {
    expect(scopeForDeclinedRefreshGrant("offline_access", "mcp")).toBe("mcp");
    expect(
      scopeForDeclinedRefreshGrant("  offline_access  ", "  mcp tools:read "),
    ).toBe("mcp tools:read");
  });

  it("passes an absent scope through", () => {
    expect(scopeForDeclinedRefreshGrant(undefined, "mcp")).toBeUndefined();
  });

  it("matches whole tokens, not substrings", () => {
    expect(
      scopeForDeclinedRefreshGrant("mcp offline_access_extra", "mcp"),
    ).toBe("mcp offline_access_extra");
  });

  it("tolerates irregular whitespace", () => {
    expect(
      scopeForDeclinedRefreshGrant("  mcp   offline_access  ", "mcp"),
    ).toBe("mcp");
  });
});
