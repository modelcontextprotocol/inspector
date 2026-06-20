import { describe, it, expect, vi, beforeEach } from "vitest";
import open from "open";
import { openUrl } from "../src/utils/openUrl.js";

// `open` shells out to the OS browser opener — stub it so the test only checks
// that openUrl forwards the right string.
vi.mock("open", () => ({ default: vi.fn().mockResolvedValue(undefined) }));

const openMock = vi.mocked(open);

describe("openUrl", () => {
  beforeEach(() => {
    openMock.mockClear();
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
});
