import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLatestCallback } from "./useLatestCallback";

describe("useLatestCallback", () => {
  it("keeps one identity across renders", () => {
    const { result, rerender } = renderHook(({ fn }) => useLatestCallback(fn), {
      initialProps: { fn: vi.fn() },
    });
    const first = result.current;
    rerender({ fn: vi.fn() });
    expect(result.current).toBe(first);
  });

  it("calls the function from the latest render, with its arguments", () => {
    const stale = vi.fn();
    const latest = vi.fn((a: number, b: string) => `${a}${b}`);
    const { result, rerender } = renderHook(({ fn }) => useLatestCallback(fn), {
      initialProps: { fn: stale as typeof latest },
    });
    rerender({ fn: latest });

    expect(result.current(1, "x")).toBe("1x");
    expect(latest).toHaveBeenCalledWith(1, "x");
    expect(stale).not.toHaveBeenCalled();
  });
});
