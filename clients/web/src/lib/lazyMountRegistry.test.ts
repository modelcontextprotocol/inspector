import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLazyMountRegistry,
  LAZY_MOUNT_MARGIN,
} from "./lazyMountRegistry";

type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void;

// A stand-in observer: records what it was asked to watch and lets the test
// deliver reports. happy-dom's own is a stub that never reports.
class FakeObserver {
  static instances: FakeObserver[] = [];
  observed = new Set<Element>();
  disconnected = false;
  readonly callback: Callback;
  readonly options: IntersectionObserverInit;
  constructor(callback: Callback, options: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    FakeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.add(element);
  }
  unobserve(element: Element) {
    this.observed.delete(element);
  }
  disconnect() {
    this.disconnected = true;
    this.observed.clear();
  }
  report(target: Element, isIntersecting: boolean, height: number) {
    this.callback([
      {
        target,
        isIntersecting,
        boundingClientRect: { height } as DOMRectReadOnly,
      },
    ]);
  }
}

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 100,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function elementAt(top: number, height: number): HTMLElement {
  const element = document.createElement("div");
  element.getBoundingClientRect = () => rect(top, height);
  return element;
}

describe("createLazyMountRegistry", () => {
  beforeEach(() => {
    FakeObserver.instances = [];
    vi.stubGlobal("IntersectionObserver", FakeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates one observer, lazily, against the root with the margin", () => {
    const root = elementAt(0, 400);
    const registry = createLazyMountRegistry(0.25);
    registry.setRoot(root);
    expect(FakeObserver.instances).toHaveLength(0);
    registry.observe(document.createElement("div"), () => {});
    registry.observe(document.createElement("div"), () => {});
    expect(FakeObserver.instances).toHaveLength(1);
    // In px from the root's height: a percentage would resolve against its
    // width.
    expect(FakeObserver.instances[0]!.options).toEqual({
      root,
      rootMargin: "100px 0px",
    });
  });

  it("defaults to the shared margin", () => {
    const registry = createLazyMountRegistry();
    registry.setRoot(elementAt(0, 1000));
    registry.observe(document.createElement("div"), () => {});
    expect(FakeObserver.instances[0]!.options.rootMargin).toBe(
      `${1000 * LAZY_MOUNT_MARGIN}px 0px`,
    );
  });

  it("observes against the document with no root", () => {
    const registry = createLazyMountRegistry();
    registry.observe(document.createElement("div"), () => {});
    expect(FakeObserver.instances[0]!.options).toEqual({
      root: null,
      rootMargin: "0px 0px",
    });
  });

  describe("following the root", () => {
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
      resize(target: Element) {
        this.callback([{ target } as ResizeObserverEntry], this);
      }
    }

    beforeEach(() => {
      FakeResizeObserver.instances = [];
      vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    });

    it("rebuilds the observer, rows included, when the root's height changes", () => {
      let height = 400;
      const root = document.createElement("div");
      root.getBoundingClientRect = () => rect(0, height);
      const registry = createLazyMountRegistry(0.25);
      registry.setRoot(root);
      const row = document.createElement("div");
      registry.observe(row, () => {});
      const watcher = FakeResizeObserver.instances[0]!;
      expect(watcher.observed).toEqual([root]);

      // The same height changes nothing.
      watcher.resize(root);
      expect(FakeObserver.instances).toHaveLength(1);

      height = 800;
      watcher.resize(root);
      expect(FakeObserver.instances).toHaveLength(2);
      expect(FakeObserver.instances[0]!.disconnected).toBe(true);
      expect(FakeObserver.instances[1]!.options.rootMargin).toBe("200px 0px");
      expect(FakeObserver.instances[1]!.observed.has(row)).toBe(true);
    });

    it("ignores a resize before anything is observed, and an empty report", () => {
      const root = elementAt(0, 400);
      const registry = createLazyMountRegistry();
      registry.setRoot(root);
      expect(FakeResizeObserver.instances).toHaveLength(0);
      registry.observe(document.createElement("div"), () => {});
      const watcher = FakeResizeObserver.instances[0]!;
      watcher.callback([], watcher);
      registry.disconnect();
      expect(watcher.disconnected).toBe(true);
      watcher.resize(root);
      expect(FakeObserver.instances).toHaveLength(1);
    });

    it("moves to a new root, and ignores setting the same one", () => {
      const first = elementAt(0, 400);
      const second = elementAt(0, 200);
      const registry = createLazyMountRegistry(0.25);
      registry.setRoot(first);
      registry.observe(document.createElement("div"), () => {});
      registry.setRoot(first);
      expect(FakeObserver.instances).toHaveLength(1);

      registry.setRoot(second);
      expect(FakeResizeObserver.instances[0]!.disconnected).toBe(true);
      expect(FakeObserver.instances).toHaveLength(2);
      expect(FakeObserver.instances[1]!.options).toEqual({
        root: second,
        rootMargin: "50px 0px",
      });
      expect(FakeResizeObserver.instances[1]!.observed).toEqual([second]);
    });

    it("swaps roots before any observer exists without building one", () => {
      const registry = createLazyMountRegistry();
      registry.setRoot(elementAt(0, 400));
      registry.setRoot(null);
      expect(FakeObserver.instances).toHaveLength(0);
    });
  });

  it("reports each change to the row's own callback", () => {
    const registry = createLazyMountRegistry();
    const a = document.createElement("div");
    const b = document.createElement("div");
    const onA = vi.fn();
    const onB = vi.fn();
    registry.observe(a, onA);
    registry.observe(b, onB);
    const observer = FakeObserver.instances[0]!;
    observer.report(a, true, 120);
    observer.report(a, false, 130);
    expect(onA).toHaveBeenNthCalledWith(1, { near: true, height: 120 });
    expect(onA).toHaveBeenNthCalledWith(2, { near: false, height: 130 });
    expect(onB).not.toHaveBeenCalled();
  });

  it("stops reporting to a row that unsubscribed", () => {
    const registry = createLazyMountRegistry();
    const element = document.createElement("div");
    const onChange = vi.fn();
    const unsubscribe = registry.observe(element, onChange);
    const observer = FakeObserver.instances[0]!;
    unsubscribe();
    expect(observer.observed.has(element)).toBe(false);
    observer.report(element, true, 10);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disconnects, and builds a fresh observer when used again", () => {
    const registry = createLazyMountRegistry();
    const element = document.createElement("div");
    const onChange = vi.fn();
    registry.observe(element, onChange);
    const first = FakeObserver.instances[0]!;
    registry.disconnect();
    expect(first.disconnected).toBe(true);
    first.report(element, true, 10);
    expect(onChange).not.toHaveBeenCalled();

    registry.observe(element, onChange);
    expect(FakeObserver.instances).toHaveLength(2);
  });

  it("tolerates a disconnect before anything was observed", () => {
    expect(() => createLazyMountRegistry().disconnect()).not.toThrow();
  });

  describe("first-layout checks", () => {
    function queued(registry: ReturnType<typeof createLazyMountRegistry>) {
      const onNear = vi.fn();
      return {
        onNear,
        check: (el: Element) => registry.checkOnFirstLayout(el, onNear),
      };
    }

    it("treats every row as near with no root to measure against", () => {
      const registry = createLazyMountRegistry();
      const { onNear, check } = queued(registry);
      check(elementAt(5000, 100));
      registry.flushFirstChecks();
      expect(onNear).toHaveBeenCalledTimes(1);
    });

    it("measures against the root plus its margin, once per queued row", () => {
      // Root 0–400, so a quarter's margin reaches from -100 to 500.
      const registry = createLazyMountRegistry(0.25);
      registry.setRoot(elementAt(0, 400));
      const near = [
        elementAt(100, 50),
        elementAt(450, 100),
        elementAt(-180, 100),
      ];
      const far = [elementAt(501, 100), elementAt(-250, 100)];
      const calls: Element[] = [];
      for (const el of [...near, ...far]) {
        registry.checkOnFirstLayout(el, () => calls.push(el));
      }
      registry.flushFirstChecks();
      expect(calls).toEqual(near);
      registry.flushFirstChecks();
      expect(calls).toEqual(near);
    });

    it("drops a cancelled check", () => {
      const registry = createLazyMountRegistry();
      const { onNear, check } = queued(registry);
      const cancel = check(elementAt(0, 10));
      cancel();
      registry.flushFirstChecks();
      expect(onNear).not.toHaveBeenCalled();
    });

    it("defers to the observer once it has reported, until a disconnect", () => {
      const registry = createLazyMountRegistry();
      const element = elementAt(100, 50);
      registry.observe(element, () => {});
      FakeObserver.instances[0]!.report(element, true, 50);
      const { onNear, check } = queued(registry);
      check(element)();
      registry.flushFirstChecks();
      expect(onNear).not.toHaveBeenCalled();

      registry.disconnect();
      check(element);
      registry.flushFirstChecks();
      expect(onNear).toHaveBeenCalledTimes(1);
    });
  });
});
