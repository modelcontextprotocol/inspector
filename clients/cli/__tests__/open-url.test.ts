import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openMock = vi.fn().mockResolvedValue(undefined);

vi.mock("open", () => ({
  default: (...args: unknown[]) => openMock(...args),
}));

// Suite-wide setup mocks open-url; this file exercises the real wrapper.
vi.unmock("../src/open-url.js");

describe("openUrl", () => {
  beforeEach(() => {
    openMock.mockClear();
    openMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("forwards a string URL to open", async () => {
    const { openUrl } = await import("../src/open-url.js");
    await openUrl("https://example.com/auth");
    expect(openMock).toHaveBeenCalledWith("https://example.com/auth");
  });

  it("forwards URL.href for URL instances", async () => {
    const { openUrl } = await import("../src/open-url.js");
    await openUrl(new URL("https://example.com/callback?code=1"));
    expect(openMock).toHaveBeenCalledWith(
      "https://example.com/callback?code=1",
    );
  });

  it("rejects when the opener rejects", async () => {
    openMock.mockRejectedValue(new Error("xdg-open not found"));
    const { openUrl } = await import("../src/open-url.js");
    await expect(openUrl("https://example.com/auth")).rejects.toThrow(
      "xdg-open not found",
    );
  });

  it("rejects when the opener does not settle within the timeout", async () => {
    vi.useFakeTimers();
    openMock.mockReturnValue(new Promise(() => {}));
    const { openUrl } = await import("../src/open-url.js");
    const pending = openUrl("https://example.com/auth", 2_000);
    const assertion = expect(pending).rejects.toThrow(
      "browser did not open within 2s",
    );
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
  });

  it("clears its timer once the opener resolves", async () => {
    vi.useFakeTimers();
    const { openUrl, OPEN_URL_TIMEOUT_MS } = await import("../src/open-url.js");
    await openUrl("https://example.com/auth");
    expect(vi.getTimerCount()).toBe(0);
    expect(OPEN_URL_TIMEOUT_MS).toBe(5_000);
  });
});
