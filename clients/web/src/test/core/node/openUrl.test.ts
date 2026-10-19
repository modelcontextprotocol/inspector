import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A stand-in for `open` v11, which resolves with the `ChildProcess` only once
 * the opener has emitted `'spawn'` (and rejects when it cannot be spawned),
 * then stops listening for `'error'` on it.
 */
const openMock = vi.fn<(...args: unknown[]) => Promise<EventEmitter>>(
  async () => new EventEmitter(),
);

vi.mock("open", () => ({
  default: (...args: unknown[]) => openMock(...args),
}));

describe("openUrl", () => {
  beforeEach(() => {
    openMock.mockClear();
    openMock.mockImplementation(async () => new EventEmitter());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("forwards a string URL to open", async () => {
    const { openUrl } = await import("@inspector/core/node/openUrl.js");
    await openUrl("https://example.com/auth");
    expect(openMock).toHaveBeenCalledWith("https://example.com/auth");
  });

  it("forwards URL.href for URL instances", async () => {
    const { openUrl } = await import("@inspector/core/node/openUrl.js");
    await openUrl(new URL("https://example.com/callback?code=1"));
    expect(openMock).toHaveBeenCalledWith(
      "https://example.com/callback?code=1",
    );
  });

  it("forwards a plain http URL (the web backend's own local address)", async () => {
    const { openUrl } = await import("@inspector/core/node/openUrl.js");
    await openUrl("http://localhost:6274/?MCP_INSPECTOR_API_TOKEN=abc");
    expect(openMock).toHaveBeenCalledWith(
      "http://localhost:6274/?MCP_INSPECTOR_API_TOKEN=abc",
    );
  });

  it.each([
    ["file:", "file:///C:/Windows/System32/calc.exe"],
    ["javascript:", "javascript:alert(1)"],
    ["ms-settings:", "ms-settings:privacy"],
    ["smb:", "smb://attacker.example/share"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
  ])("refuses a %s URL without calling open", async (protocol, href) => {
    const { openUrl } = await import("@inspector/core/node/openUrl.js");
    await expect(openUrl(href)).rejects.toThrow(
      `refusing to open a non-http(s) URL (${protocol})`,
    );
    expect(openMock).not.toHaveBeenCalled();
  });

  it("refuses a non-http(s) URL instance without calling open", async () => {
    const { openUrl } = await import("@inspector/core/node/openUrl.js");
    await expect(openUrl(new URL("file:///etc/passwd"))).rejects.toThrow(
      "refusing to open a non-http(s) URL (file:)",
    );
    expect(openMock).not.toHaveBeenCalled();
  });

  it("refuses an unparseable URL without calling open", async () => {
    const { openUrl } = await import("@inspector/core/node/openUrl.js");
    await expect(openUrl("not a url")).rejects.toThrow(
      "refusing to open an invalid URL",
    );
    expect(openMock).not.toHaveBeenCalled();
  });

  it("rejects when the opener rejects", async () => {
    openMock.mockRejectedValue(new Error("xdg-open not found"));
    const { openUrl } = await import("@inspector/core/node/openUrl.js");
    await expect(openUrl("https://example.com/auth")).rejects.toThrow(
      "xdg-open not found",
    );
  });

  it("rejects when the opener cannot be spawned, instead of crashing", async () => {
    const enoent = Object.assign(new Error("spawn open ENOENT"), {
      code: "ENOENT",
    });
    openMock.mockRejectedValue(enoent);
    const { openUrl } = await import("@inspector/core/node/openUrl.js");
    await expect(openUrl("https://example.com/auth")).rejects.toBe(enoent);
  });

  it("absorbs an opener error that arrives after launch", async () => {
    const child = new EventEmitter();
    openMock.mockResolvedValue(child);
    const { openUrl } = await import("@inspector/core/node/openUrl.js");
    await openUrl("https://example.com/auth");
    expect(() => child.emit("error", new Error("late"))).not.toThrow();
  });

  it("rejects when the opener does not settle within the timeout", async () => {
    vi.useFakeTimers();
    openMock.mockReturnValue(new Promise(() => {}));
    const { openUrl } = await import("@inspector/core/node/openUrl.js");
    const pending = openUrl("https://example.com/auth", 2_000);
    const assertion = expect(pending).rejects.toThrow(
      "browser did not open within 2s",
    );
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
  });

  it("clears its timer once the opener resolves", async () => {
    vi.useFakeTimers();
    const { openUrl, OPEN_URL_TIMEOUT_MS } =
      await import("@inspector/core/node/openUrl.js");
    await openUrl("https://example.com/auth");
    expect(vi.getTimerCount()).toBe(0);
    expect(OPEN_URL_TIMEOUT_MS).toBe(5_000);
  });
});
