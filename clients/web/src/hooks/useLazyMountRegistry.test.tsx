import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLazyMountRegistry } from "./useLazyMountRegistry";

class FakeObserver {
  static disconnects = 0;
  observe() {}
  unobserve() {}
  disconnect() {
    FakeObserver.disconnects += 1;
  }
}

describe("useLazyMountRegistry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is null without an IntersectionObserver, so rows mount at once", () => {
    const { result } = renderHook(() =>
      useLazyMountRegistry({ current: null }),
    );
    expect(result.current).toBeNull();
  });

  it("keeps one registry across renders and disconnects it on unmount", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    FakeObserver.disconnects = 0;
    const root = document.createElement("div");
    const { result, rerender, unmount } = renderHook(() =>
      useLazyMountRegistry({ current: root }),
    );
    const registry = result.current;
    expect(registry).not.toBeNull();
    // The first checks a row queued run against the root on the next render.
    const onNear = vi.fn();
    registry!.checkOnFirstLayout(document.createElement("div"), onNear);
    root.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);
    rerender();
    expect(result.current).toBe(registry);
    expect(onNear).toHaveBeenCalledTimes(1);
    registry!.observe(document.createElement("div"), () => {});
    unmount();
    expect(FakeObserver.disconnects).toBe(1);
  });
});
