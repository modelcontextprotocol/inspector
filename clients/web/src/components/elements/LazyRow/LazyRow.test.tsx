import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { LazyMountContext } from "../../../hooks/useLazyMountRegistry";
import { useKeepRowMounted } from "../../../hooks/useKeepRowMounted";
import type {
  LazyMountRegistry,
  LazyMountReport,
} from "../../../lib/lazyMountRegistry";
import { LazyRow } from "./LazyRow";

// A registry the test drives by hand: `near` answers the first-layout check
// at once (`null`: no answer, as after the observer's first report), and
// `report` plays the observer.
function fakeRegistry(near: boolean | null = false) {
  const listeners = new Map<Element, (report: LazyMountReport) => void>();
  const unsubscribed = vi.fn();
  const registry: LazyMountRegistry = {
    setRoot: () => {},
    observe(element, onChange) {
      listeners.set(element, onChange);
      return () => {
        listeners.delete(element);
        unsubscribed();
      };
    },
    checkOnFirstLayout(_element, onNear) {
      if (near) onNear();
      return () => {};
    },
    flushFirstChecks: () => {},
    disconnect: () => listeners.clear(),
  };
  const report = (value: LazyMountReport) =>
    act(() => {
      for (const listener of listeners.values()) listener(value);
    });
  return { registry, report, unsubscribed };
}

function inRegion(registry: LazyMountRegistry | null, children: ReactNode) {
  return (
    <LazyMountContext.Provider value={registry}>
      {children}
    </LazyMountContext.Provider>
  );
}

function row() {
  return document.querySelector<HTMLElement>("[data-lazy-row]")!;
}

// Mantine writes a numeric `h` in rem, scaled.
function heightOf(px: number): string {
  return `calc(${px / 16}rem * var(--mantine-scale))`;
}

// A control that refuses focus, as a browser refuses it for one that is not
// rendered (inside a closed `Collapse`); happy-dom has no rendering to refuse on.
const refusedFocus = vi.fn();
function RefusesFocus() {
  const refuse = (element: HTMLButtonElement | null) => {
    if (element) element.focus = refusedFocus;
  };
  return (
    <button type="button" ref={refuse}>
      hidden round
    </button>
  );
}

function Keeper({ keep }: { keep: boolean }) {
  useKeepRowMounted(keep);
  return <button type="button">content</button>;
}

describe("LazyRow", () => {
  it("mounts at once outside a lazy region", () => {
    renderWithMantine(
      <LazyRow estimatedHeight={100}>
        <span>content</span>
      </LazyRow>,
    );
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(row()).toHaveAttribute("data-lazy-row", "mounted");
  });

  it("mounts at once when the region has no registry", () => {
    renderWithMantine(
      inRegion(
        null,
        <LazyRow estimatedHeight={100}>
          <span>content</span>
        </LazyRow>,
      ),
    );
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("holds a hidden, estimated-height place until the row comes near", () => {
    const { registry, report } = fakeRegistry(false);
    renderWithMantine(
      inRegion(
        registry,
        <LazyRow estimatedHeight={123}>
          <span>content</span>
        </LazyRow>,
      ),
    );
    expect(screen.queryByText("content")).not.toBeInTheDocument();
    expect(row()).toHaveAttribute("data-lazy-row", "placeholder");
    expect(row()).toHaveAttribute("tabindex", "0");
    expect(row().style.height).toBe(heightOf(123));

    report({ near: true, height: 123 });
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(row()).not.toHaveAttribute("tabindex");
  });

  it("mounts before the first paint when the first render finds it near", () => {
    const { registry } = fakeRegistry(true);
    renderWithMantine(
      inRegion(
        registry,
        <LazyRow estimatedHeight={100}>
          <span>content</span>
        </LazyRow>,
      ),
    );
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("waits for the observer when the registry defers to it", () => {
    const { registry } = fakeRegistry(null);
    renderWithMantine(
      inRegion(
        registry,
        <LazyRow estimatedHeight={100}>
          <span>content</span>
        </LazyRow>,
      ),
    );
    expect(screen.queryByText("content")).not.toBeInTheDocument();
  });

  it("unmounts when it leaves, keeping its measured height", () => {
    const { registry, report } = fakeRegistry(true);
    renderWithMantine(
      inRegion(
        registry,
        <LazyRow estimatedHeight={100}>
          <span>content</span>
        </LazyRow>,
      ),
    );
    report({ near: false, height: 140 });
    expect(screen.queryByText("content")).not.toBeInTheDocument();
    expect(row().style.height).toBe(heightOf(140));
  });

  it("ignores a zero height, as from a row in a collapsed section", () => {
    const { registry, report } = fakeRegistry(true);
    renderWithMantine(
      inRegion(
        registry,
        <LazyRow estimatedHeight={100}>
          <span>content</span>
        </LazyRow>,
      ),
    );
    report({ near: false, height: 140 });
    report({ near: true, height: 140 });
    report({ near: false, height: 0 });
    expect(row().style.height).toBe(heightOf(140));
  });

  it("mounts a stand-in Tab lands on and moves into its first control", () => {
    const { registry } = fakeRegistry(false);
    renderWithMantine(
      inRegion(
        registry,
        <>
          <button type="button">before</button>
          <LazyRow estimatedHeight={100}>
            <button type="button">first</button>
            <button type="button">last</button>
          </LazyRow>
        </>,
      ),
    );
    act(() => screen.getByText("before").focus());
    act(() => row().focus());
    expect(screen.getByText("first")).toHaveFocus();
  });

  it("moves into the last control when Shift+Tab lands on a stand-in", () => {
    const { registry } = fakeRegistry(false);
    renderWithMantine(
      inRegion(
        registry,
        <>
          <LazyRow estimatedHeight={100}>
            <button type="button">first</button>
            <button type="button">last</button>
          </LazyRow>
          <button type="button">after</button>
        </>,
      ),
    );
    act(() => screen.getByText("after").focus());
    act(() => row().focus());
    expect(screen.getByText("last")).toHaveFocus();
  });

  it("skips a control that will not take focus, as in a closed Collapse", () => {
    const { registry } = fakeRegistry(false);
    renderWithMantine(
      inRegion(
        registry,
        <>
          <LazyRow estimatedHeight={100}>
            <button type="button">toggle</button>
            <RefusesFocus />
          </LazyRow>
          <button type="button">after</button>
        </>,
      ),
    );
    act(() => screen.getByText("after").focus());
    act(() => row().focus());
    expect(screen.getByText("toggle")).toHaveFocus();
    expect(refusedFocus).toHaveBeenCalled();
  });

  it("treats focus from nowhere as forward, and tolerates a row with no controls", () => {
    const { registry } = fakeRegistry(false);
    renderWithMantine(
      inRegion(
        registry,
        <LazyRow estimatedHeight={100}>
          <span>content</span>
        </LazyRow>,
      ),
    );
    act(() => row().focus());
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("drops a measured height when the estimate changes shape", () => {
    const { registry, report } = fakeRegistry(true);
    const { rerender } = renderWithMantine(
      inRegion(
        registry,
        <LazyRow estimatedHeight={100}>
          <span>content</span>
        </LazyRow>,
      ),
    );
    report({ near: false, height: 140 });
    rerender(
      inRegion(
        registry,
        <LazyRow estimatedHeight={300}>
          <span>content</span>
        </LazyRow>,
      ),
    );
    expect(row().style.height).toBe(heightOf(300));
  });

  it("stays mounted while its content holds it", () => {
    const { registry, report } = fakeRegistry(true);
    const { rerender } = renderWithMantine(
      inRegion(
        registry,
        <LazyRow estimatedHeight={100}>
          <Keeper keep />
        </LazyRow>,
      ),
    );
    report({ near: false, height: 100 });
    expect(screen.getByText("content")).toBeInTheDocument();

    rerender(
      inRegion(
        registry,
        <LazyRow estimatedHeight={100}>
          <Keeper keep={false} />
        </LazyRow>,
      ),
    );
    expect(screen.queryByText("content")).not.toBeInTheDocument();
  });

  it("takes the row's current height as a hold or focus releases it", () => {
    const { registry, report } = fakeRegistry(true);
    const { rerender } = renderWithMantine(
      inRegion(
        registry,
        <>
          <LazyRow estimatedHeight={100}>
            <Keeper keep />
          </LazyRow>
          <button type="button">outside</button>
        </>,
      ),
    );
    act(() => screen.getByText("content").focus());
    report({ near: false, height: 100 });
    // The row grew while held off-screen; the observer did not say so.
    row().getBoundingClientRect = () => new DOMRect(0, 0, 100, 260);
    rerender(
      inRegion(
        registry,
        <>
          <LazyRow estimatedHeight={100}>
            <Keeper keep={false} />
          </LazyRow>
          <button type="button">outside</button>
        </>,
      ),
    );
    expect(screen.getByText("content")).toBeInTheDocument();
    row().getBoundingClientRect = () => new DOMRect(0, 0, 100, 300);
    act(() => screen.getByText("outside").focus());
    expect(screen.queryByText("content")).not.toBeInTheDocument();
    expect(row().style.height).toBe(heightOf(300));
  });

  it("stays mounted while it holds focus", () => {
    const { registry, report } = fakeRegistry(true);
    renderWithMantine(
      inRegion(
        registry,
        <>
          <LazyRow estimatedHeight={100}>
            <button type="button">first</button>
            <button type="button">second</button>
          </LazyRow>
          <button type="button">outside</button>
        </>,
      ),
    );
    act(() => screen.getByText("first").focus());
    report({ near: false, height: 100 });
    // Moving focus within the row keeps it.
    act(() => screen.getByText("second").focus());
    expect(screen.getByText("first")).toBeInTheDocument();

    act(() => screen.getByText("outside").focus());
    expect(screen.queryByText("first")).not.toBeInTheDocument();
  });

  it("mounts while forced, then lets the observer decide", () => {
    const { registry, report } = fakeRegistry(false);
    const { rerender } = renderWithMantine(
      inRegion(
        registry,
        <LazyRow estimatedHeight={100} forceMount>
          <span>content</span>
        </LazyRow>,
      ),
    );
    expect(screen.getByText("content")).toBeInTheDocument();

    // Released: it is assumed to be arriving in view.
    rerender(
      inRegion(
        registry,
        <LazyRow estimatedHeight={100}>
          <span>content</span>
        </LazyRow>,
      ),
    );
    expect(screen.getByText("content")).toBeInTheDocument();

    report({ near: false, height: 100 });
    expect(screen.queryByText("content")).not.toBeInTheDocument();
  });

  it("stops observing when it unmounts", () => {
    const { registry, unsubscribed } = fakeRegistry(false);
    const { unmount } = renderWithMantine(
      inRegion(
        registry,
        <LazyRow estimatedHeight={100}>
          <span>content</span>
        </LazyRow>,
      ),
    );
    unmount();
    expect(unsubscribed).toHaveBeenCalledTimes(1);
  });
});
