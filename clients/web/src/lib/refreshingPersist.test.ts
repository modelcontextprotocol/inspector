import { describe, it, expect, vi } from "vitest";
import { refreshingPersist } from "./refreshingPersist";

describe("refreshingPersist", () => {
  it("refreshes after the persist resolves, not before", async () => {
    // Ordering is the point: refreshing first would re-fetch the descriptor
    // that the pending write is about to invalidate, which is the stale read
    // this wrapper exists to prevent, one step earlier.
    const order: string[] = [];
    const persist = vi.fn(async () => {
      order.push("persist");
    });
    const refresh = vi.fn(() => {
      order.push("refresh");
    });

    await refreshingPersist(persist, refresh)();

    expect(order).toEqual(["persist", "refresh"]);
  });

  it("passes every argument through unchanged", async () => {
    // The server-settings caller is `(id, settings)`; the wrapper must be
    // transparent or it silently drops the entry it was meant to save.
    // Typed rather than given placeholder parameters: this scope's eslint
    // does not honour the `_` prefix, and the signature is what matters.
    const persist = vi
      .fn<(id: string, settings: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);
    const settings = { headers: [] };
    await refreshingPersist(persist, vi.fn())("srv-1", settings);
    expect(persist).toHaveBeenCalledWith("srv-1", settings);
  });

  it("refreshes even when the persist fails, and still propagates the error", async () => {
    // This asserted the opposite until round 22, on reasoning that sounded
    // right and was wrong for this write order: both persistence paths write
    // the secret store *before* the file, so a rejected disk write can follow
    // a `set` that already upgraded `secrets.json` from plaintext to
    // encrypted. Skipping the refresh there left the footer describing a file
    // that no longer exists in that form.
    //
    // The asymmetry decides it: a needless refresh costs one idempotent GET;
    // a missed one leaves a security statement wrong until reload.
    const boom = new Error("keychain unavailable");
    const persist = vi.fn().mockRejectedValue(boom);
    const refresh = vi.fn();

    await expect(refreshingPersist(persist, refresh)()).rejects.toBe(boom);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("returns a function usable as a persist callback more than once", async () => {
    const persist = vi.fn(async () => {});
    const refresh = vi.fn();
    const wrapped = refreshingPersist(persist, refresh);

    await wrapped();
    await wrapped();

    expect(persist).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
