import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWebEnvironment } from "./environmentFactory";
import { RemoteOAuthStorage } from "@inspector/core/auth/remote/index.js";

describe("createWebEnvironment", () => {
  beforeEach(() => {
    // RemoteOAuthStorage's persist adapter issues a hydration GET on
    // construction; stub global fetch so the test doesn't depend on a backend.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
  });

  it("uses RemoteOAuthStorage so OAuth state lands on the backend", () => {
    const { environment } = createWebEnvironment(
      "test-auth-token",
      { getRedirectUrl: () => "http://localhost/callback" },
      undefined,
    );
    expect(environment.oauth?.storage).toBeInstanceOf(RemoteOAuthStorage);
  });

  it("returns the same RemoteOAuthStorage for the same {baseUrl, authToken}", () => {
    const redirect = { getRedirectUrl: () => "http://localhost/callback" };
    const a = createWebEnvironment("token-1", redirect, undefined);
    const b = createWebEnvironment("token-1", redirect, undefined);
    expect(a.environment.oauth?.storage).toBe(b.environment.oauth?.storage);
  });

  it("returns a distinct RemoteOAuthStorage when the authToken differs", () => {
    const redirect = { getRedirectUrl: () => "http://localhost/callback" };
    const a = createWebEnvironment("token-A", redirect, undefined);
    const b = createWebEnvironment("token-B", redirect, undefined);
    expect(a.environment.oauth?.storage).not.toBe(b.environment.oauth?.storage);
  });
});
