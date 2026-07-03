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

  it("returned unsubscribe removes the visibilitychange listener", () => {
    let handler: (() => void) | undefined;
    vi.mocked(document.addEventListener).mockImplementation((_event, fn) => {
      handler = fn as () => void;
    });

    const callback = vi.fn();
    const unsubscribe = onBrowserTabVisible(callback);
    expect(handler).toBeDefined();

    unsubscribe();
    expect(document.removeEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      handler,
    );

    // After unsubscribing the stored handler must no longer fire the callback
    // through the (now removed) listener path.
    vi.mocked(document.addEventListener).mockClear();
    expect(document.addEventListener).not.toHaveBeenCalled();
  });

  it("integrates with a real document: dispatch, hidden/visible, and unsubscribe", () => {
    vi.unstubAllGlobals();
    const original = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "visibilityState",
    );
    const setVisibility = (value: string): void => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => value,
      });
    };

    try {
      setVisibility("visible");
      expect(isBrowserTabVisible()).toBe(true);

      const callback = vi.fn();
      const unsubscribe = onBrowserTabVisible(callback);

      // Hidden branch: listener fires but callback is not invoked.
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(callback).not.toHaveBeenCalled();
      expect(isBrowserTabVisible()).toBe(false);

      // Visible branch: callback invoked.
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(callback).toHaveBeenCalledOnce();

      // Unsubscribe: further events must not re-invoke the callback.
      unsubscribe();
      document.dispatchEvent(new Event("visibilitychange"));
      expect(callback).toHaveBeenCalledOnce();
    } finally {
      if (original) {
        Object.defineProperty(document, "visibilityState", original);
      } else {
        delete (document as { visibilityState?: string }).visibilityState;
      }
    }
  });

  it("no-ops safely when document is undefined (SSR guard)", () => {
    vi.stubGlobal("document", undefined);

    expect(isBrowserTabVisible()).toBe(false);

    const callback = vi.fn();
    const unsubscribe = onBrowserTabVisible(callback);
    expect(typeof unsubscribe).toBe("function");
    // The returned no-op must be callable without throwing.
    expect(() => unsubscribe()).not.toThrow();
    expect(callback).not.toHaveBeenCalled();
  });
});
