import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { KeepRowMountedContext, useKeepRowMounted } from "./useKeepRowMounted";

function withHold(hold: () => () => void) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <KeepRowMountedContext.Provider value={hold}>
        {children}
      </KeepRowMountedContext.Provider>
    );
  };
}

describe("useKeepRowMounted", () => {
  it("is a no-op outside a LazyRow", () => {
    expect(() => renderHook(() => useKeepRowMounted(true))).not.toThrow();
  });

  it("holds the row while keep is true and releases it after", () => {
    const release = vi.fn();
    const hold = vi.fn(() => release);
    const { rerender, unmount } = renderHook(
      ({ keep }) => useKeepRowMounted(keep),
      { initialProps: { keep: false }, wrapper: withHold(hold) },
    );
    expect(hold).not.toHaveBeenCalled();

    rerender({ keep: true });
    expect(hold).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();

    rerender({ keep: false });
    expect(release).toHaveBeenCalledTimes(1);

    rerender({ keep: true });
    unmount();
    expect(release).toHaveBeenCalledTimes(2);
  });
});
