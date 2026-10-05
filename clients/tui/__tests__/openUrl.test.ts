import { describe, it, expect, vi, beforeEach } from "vitest";
import { openUrl as openInBrowser } from "@inspector/core/node/openUrl.js";
import { browserOpenFailedMessage, openUrl } from "../src/utils/openUrl.js";

// Core's opener spawns the OS browser — stub it so these tests only check what
// the TUI wrapper forwards and how it owns a failure. The spawn-failure
// mechanics themselves are tested against core (web suite, #2533).
vi.mock("@inspector/core/node/openUrl.js", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

const openMock = vi.mocked(openInBrowser);

describe("openUrl", () => {
  beforeEach(() => {
    openMock.mockReset();
    openMock.mockResolvedValue(undefined);
  });

  it("passes a string URL straight through", async () => {
    await openUrl("https://example.com/auth");
    expect(openMock).toHaveBeenCalledWith("https://example.com/auth");
  });

  it("serializes a URL object via .href", async () => {
    await openUrl(new URL("https://example.com/callback?code=1"));
    expect(openMock).toHaveBeenCalledWith(
      "https://example.com/callback?code=1",
    );
  });

  it("does not report a failure when the browser opens", async () => {
    const onFailure = vi.fn();
    await openUrl("https://example.com/auth", onFailure);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("resolves and reports the manual-open note when the opener fails", async () => {
    openMock.mockRejectedValue(new Error("spawn xdg-open ENOENT"));
    const onFailure = vi.fn();
    await expect(
      openUrl(new URL("https://example.com/auth?x=1"), onFailure),
    ).resolves.toBeUndefined();
    expect(onFailure).toHaveBeenCalledWith(
      browserOpenFailedMessage("https://example.com/auth?x=1"),
    );
  });

  it("swallows a failure even with no callback", async () => {
    openMock.mockRejectedValue(new Error("spawn xdg-open ENOENT"));
    await expect(openUrl("https://example.com/auth")).resolves.toBeUndefined();
  });
});

describe("browserOpenFailedMessage", () => {
  it("names the URL to open by hand", () => {
    expect(browserOpenFailedMessage("https://example.com/auth")).toBe(
      "Could not open a browser automatically. Open this URL manually to authorize: https://example.com/auth",
    );
  });
});
