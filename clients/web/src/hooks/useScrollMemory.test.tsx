import { describe, it, expect, beforeEach } from "vitest";
import { renderWithMantine, act } from "../test/renderWithMantine";
import { useScrollMemory, clearScrollMemory } from "./useScrollMemory";

// happy-dom doesn't lay out scrollable content, so we drive scrollTop/scrollLeft
// directly on the viewport node and assert the hook saves on unmount and
// restores on the next mount. A fixed-height div with the ref is enough.
function ScrollProbe({ scrollKey }: { scrollKey: string }) {
  const ref = useScrollMemory(scrollKey);
  return <div data-testid="viewport" ref={ref} />;
}

describe("useScrollMemory", () => {
  beforeEach(() => {
    clearScrollMemory();
  });

  it("restores the saved scroll offset on remount under the same key", () => {
    const { getByTestId, unmount } = renderWithMantine(
      <ScrollProbe scrollKey="logs" />,
    );
    const viewport = getByTestId("viewport") as HTMLDivElement;
    // Simulate the user scrolling.
    viewport.scrollTop = 240;
    viewport.scrollLeft = 15;
    // Unmount (tab switch) captures the offset; remount restores it.
    unmount();

    const second = renderWithMantine(<ScrollProbe scrollKey="logs" />);
    const restored = second.getByTestId("viewport") as HTMLDivElement;
    expect(restored.scrollTop).toBe(240);
    expect(restored.scrollLeft).toBe(15);
  });

  it("does not cross-restore between different keys", () => {
    const first = renderWithMantine(<ScrollProbe scrollKey="logs" />);
    (first.getByTestId("viewport") as HTMLDivElement).scrollTop = 100;
    first.unmount();

    const other = renderWithMantine(<ScrollProbe scrollKey="history" />);
    expect((other.getByTestId("viewport") as HTMLDivElement).scrollTop).toBe(0);
  });

  it("forgets saved positions after clearScrollMemory()", () => {
    const first = renderWithMantine(<ScrollProbe scrollKey="logs" />);
    (first.getByTestId("viewport") as HTMLDivElement).scrollTop = 180;
    first.unmount();

    act(() => clearScrollMemory());

    const second = renderWithMantine(<ScrollProbe scrollKey="logs" />);
    expect((second.getByTestId("viewport") as HTMLDivElement).scrollTop).toBe(
      0,
    );
  });
});
