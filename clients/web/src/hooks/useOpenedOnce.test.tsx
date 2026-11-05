import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOpenedOnce } from "./useOpenedOnce";

describe("useOpenedOnce", () => {
  it("is false while the thing has never been open", () => {
    const { result, rerender } = renderHook(({ open }) => useOpenedOnce(open), {
      initialProps: { open: false },
    });
    expect(result.current).toBe(false);
    rerender({ open: false });
    expect(result.current).toBe(false);
  });

  it("is true from the first render when it starts open", () => {
    const { result } = renderHook(() => useOpenedOnce(true));
    expect(result.current).toBe(true);
  });

  it("latches on the first open and stays true after closing", () => {
    const { result, rerender } = renderHook(({ open }) => useOpenedOnce(open), {
      initialProps: { open: false },
    });
    rerender({ open: true });
    expect(result.current).toBe(true);
    rerender({ open: false });
    expect(result.current).toBe(true);
  });
});
