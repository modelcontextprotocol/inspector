import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Node 22+ exposes an experimental `localStorage` placeholder that overrides
// happy-dom's implementation. Without `--localstorage-file`, it's an empty
// stub with no methods, which breaks anything that calls setItem/getItem.
// Install a minimal in-memory Storage shim before any test runs.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: new MemoryStorage(),
});

// Benign default `fetch`. Several components hit the backend on mount — e.g.
// the app reads `GET /api/config` via `useInitialConfig`.
// Under happy-dom (no server) those real requests 404 and log alarming
// `GET .../api/config 404 (Not Found)` lines that make a green run look broken.
// Returning an empty 200 keeps such *incidental* calls quiet. Tests that care
// about fetch install their own per-test spy/stub (e.g. `vi.spyOn(globalThis,
// "fetch")`), which Vitest only auto-reverts to this baseline if the test
// registers it through Vitest's mock APIs — this project doesn't set
// `restoreMocks` globally, so a test that mutates `globalThis.fetch` directly
// must restore it itself. Note the tradeoff: this default is permissive, so a
// test meaning to assert on a fetch FAILURE must set up its own rejecting/
// erroring stub rather than relying on the absence of a server.
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  writable: true,
  value: () =>
    Promise.resolve(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
});

// happy-dom (v20) *does* implement `matchMedia`/`MediaQueryList`, so this isn't
// a polyfill for a missing API — it's a deliberate **override** of happy-dom's
// implementation, pinning `prefers-reduced-motion: reduce` and reporting `false`
// for every other query (preserving the historical absent-matchMedia layout
// behavior for `useMediaQuery`-driven code). Note this does *not*, on its own,
// disable Mantine transitions: `useTransition` only honors reduced motion when
// `theme.respectReducedMotion` is true, and Mantine 8 defaults it to `false`
// (the project theme doesn't override it). The actual protection against the
// #1760 post-teardown `window is not defined` leak is `env="test"` in
// `renderWithMantine`, which forces transitions synchronous regardless. Tests
// that need specific media results still mock `@mantine/hooks` or stub
// `matchMedia` themselves.
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  // Partial `matchMedia` mock: happy-dom doesn't implement it, and the members
  // below are all the app touches. The stub omits the rest of `MediaQueryList`,
  // so the double cast bridges the deliberately-incomplete shape.
  value: (query: string): MediaQueryList =>
    ({
      matches: /prefers-reduced-motion/.test(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList,
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
