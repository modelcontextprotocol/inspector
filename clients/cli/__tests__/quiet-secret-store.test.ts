/**
 * Unit tests for `resolveSecretStoreQuietly` (#2435), with core's resolver
 * mocked so both the warning and the rejection path are deterministic.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const { resolveSecretStore } = vi.hoisted(() => ({
  resolveSecretStore: vi.fn(),
}));
vi.mock("@inspector/core/auth/node/secret-store-selection.js", () => ({
  resolveSecretStore,
}));

import { resolveSecretStoreQuietly } from "../src/quiet-secret-store.js";

describe("resolveSecretStoreQuietly", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resolveSecretStore.mockReset();
  });

  it("mutes the notice core prints while resolving, then restores console.warn", async () => {
    const original = console.warn;
    const sink = vi.fn();
    console.warn = sink;
    try {
      resolveSecretStore.mockImplementation(async () => {
        console.warn("[mcp-inspector] Secrets are not written anywhere");
        return {};
      });

      await resolveSecretStoreQuietly();

      expect(resolveSecretStore).toHaveBeenCalledOnce();
      expect(sink).not.toHaveBeenCalled();
      expect(console.warn).toBe(sink);
    } finally {
      console.warn = original;
    }
  });

  it("swallows a rejection (the cached promise re-raises it at first use) and still restores console.warn", async () => {
    const original = console.warn;
    resolveSecretStore.mockRejectedValue(new Error("keychain exploded"));

    await expect(resolveSecretStoreQuietly()).resolves.toBeUndefined();
    expect(console.warn).toBe(original);
  });
});
