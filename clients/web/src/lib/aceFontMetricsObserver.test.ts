import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferAceFontMetricsObserver } from "./aceFontMetricsObserver";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  notify() {
    this.callback([], this);
  }
}

/** A renderer shaped like Ace's, as far as the helper looks. */
function fakeRenderer() {
  const original = new FakeResizeObserver(() => {});
  const fontMetrics: {
    $observer: FakeResizeObserver | undefined;
    $measureNode: Element;
    checkForSizeChanges: () => void;
  } = {
    $observer: original,
    $measureNode: document.createElement("div"),
    checkForSizeChanges: vi.fn(),
  };
  return { renderer: { $fontMetrics: fontMetrics }, fontMetrics, original };
}

describe("deferAceFontMetricsObserver", () => {
  beforeEach(() => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame"],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("swaps Ace's observer for one on the same measuring node", () => {
    const { renderer, fontMetrics, original } = fakeRenderer();

    expect(deferAceFontMetricsObserver(renderer)).toBe(true);

    const replacement = FakeResizeObserver.instances[1]!;
    expect(original.disconnected).toBe(true);
    expect(replacement.observed).toEqual([fontMetrics.$measureNode]);
    // Stored where Ace keeps its own, so `FontMetrics.destroy()` disconnects it.
    expect(fontMetrics.$observer).toBe(replacement);
  });

  it("re-measures on the next frame, not inside the observer callback", () => {
    const { renderer, fontMetrics } = fakeRenderer();
    deferAceFontMetricsObserver(renderer);
    const replacement = FakeResizeObserver.instances[1]!;

    replacement.notify();
    expect(fontMetrics.checkForSizeChanges).not.toHaveBeenCalled();

    vi.advanceTimersToNextFrame();
    expect(fontMetrics.checkForSizeChanges).toHaveBeenCalledTimes(1);
  });

  it("coalesces several notifications in one frame into one re-measurement", () => {
    const { renderer, fontMetrics } = fakeRenderer();
    deferAceFontMetricsObserver(renderer);
    const replacement = FakeResizeObserver.instances[1]!;

    replacement.notify();
    replacement.notify();
    replacement.notify();
    vi.advanceTimersToNextFrame();

    expect(fontMetrics.checkForSizeChanges).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a non-object renderer", undefined],
    ["a renderer with no font metrics", {}],
    ["font metrics that are not an object", { $fontMetrics: "nope" }],
  ])("leaves %s alone", (_label, renderer) => {
    expect(deferAceFontMetricsObserver(renderer)).toBe(false);
    expect(FakeResizeObserver.instances).toHaveLength(0);
  });

  // The environment Ace polls in: the global is not merely unused, it does not
  // exist, so even asking `instanceof` of it would throw.
  it("leaves the editor alone where ResizeObserver does not exist", () => {
    const { renderer, fontMetrics } = fakeRenderer();
    fontMetrics.$observer = undefined;
    vi.stubGlobal("ResizeObserver", undefined);

    expect(deferAceFontMetricsObserver(renderer)).toBe(false);
  });

  // Ace falls back to polling where `ResizeObserver` is unavailable, and a
  // future Ace may rename any of these — either way there is no synchronous
  // observer to replace, so the editor is left exactly as Ace built it.
  it.each([
    ["no observer", { $observer: undefined }],
    ["no measuring node", { $measureNode: undefined }],
    ["no re-measure method", { checkForSizeChanges: undefined }],
  ])("leaves font metrics with %s alone", (_label, override) => {
    const { renderer, fontMetrics, original } = fakeRenderer();
    Object.assign(fontMetrics, override);

    expect(deferAceFontMetricsObserver(renderer)).toBe(false);
    expect(original.disconnected).toBe(false);
    expect(FakeResizeObserver.instances).toHaveLength(1);
  });
});
