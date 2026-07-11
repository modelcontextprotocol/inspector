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
// the app reads `GET /api/config` via `useSandboxUrl` / `useServerListWritable`.
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

// happy-dom doesn't implement `matchMedia`, so Mantine's `useReducedMotion`
// resolves to "motion allowed" and every `Transition` (ScreenStage, Modal, …)
// schedules real enter/exit `setTimeout`s. A timer that outlives its test fires
// after the environment is torn down and throws `window is not defined` from
// deep in react-dom — an unhandled error that fails the run even though every
// test passed. Report `prefers-reduced-motion: reduce` so Mantine transitions
// render instantly (no timers); all other queries stay `false`, matching the
// prior (absent-matchMedia) behavior so `useMediaQuery`-driven layout is
// unchanged. Tests that need specific media results still mock `@mantine/hooks`
// or stub `matchMedia` themselves.
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
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
