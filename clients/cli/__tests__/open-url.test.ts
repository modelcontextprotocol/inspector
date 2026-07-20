import { beforeEach, describe, expect, it, vi } from "vitest";

const openMock = vi.fn().mockResolvedValue(undefined);

vi.mock("open", () => ({
  default: (...args: unknown[]) => openMock(...args),
}));

describe("openUrl", () => {
  beforeEach(() => {
    openMock.mockClear();
    openMock.mockResolvedValue(undefined);
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
});
