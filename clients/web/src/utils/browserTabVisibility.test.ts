import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isBrowserTabVisible,
  onBrowserTabVisible,
} from "./browserTabVisibility.js";

describe("browserTabVisibility", () => {
  beforeEach(() => {
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("isBrowserTabVisible reflects document.visibilityState", () => {
    expect(isBrowserTabVisible()).toBe(true);
    (document as { visibilityState: string }).visibilityState = "hidden";
    expect(isBrowserTabVisible()).toBe(false);
  });

  it("onBrowserTabVisible invokes callback when becoming visible", () => {
    let handler: (() => void) | undefined;
    vi.mocked(document.addEventListener).mockImplementation((_event, fn) => {
      handler = fn as () => void;
    });

    const callback = vi.fn();
    onBrowserTabVisible(callback);
    expect(handler).toBeDefined();

    (document as { visibilityState: string }).visibilityState = "hidden";
    handler!();
    expect(callback).not.toHaveBeenCalled();

    (document as { visibilityState: string }).visibilityState = "visible";
    handler!();
    expect(callback).toHaveBeenCalledOnce();
  });
});
