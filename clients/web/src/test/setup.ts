import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// Testing Library's own `asyncUtilTimeout` default is 1000ms
// (`@testing-library/dom/dist/config.js`), and it governs every `waitFor` and
// `findBy*` in the unit project — 788 call sites — none of which chose it. One
// `configure` call is the whole surface, which is why it is here rather than
// argued a site at a time (#2323).
//
// 5x, because a contended happy-dom render is the worst-measured case on this
// team's machine (8 logical cores, three or four concurrent worktree sessions
// each free to run the full `local:gate`), and because once the project's
// `testTimeout` rises to 15000 this becomes the *binding* constraint on every
// async assertion in the project — the enclosing budget stops being the thing
// that cuts a wait short and this starts being it.
//
// The trade-off, stated rather than hidden: a genuinely-failing async
// assertion now takes 5s to report instead of 1s. Only failing assertions pay
// it, once each, on runs that are already the slow path. A *passing* `waitFor`
// returns the instant its callback stops throwing and is unaffected.
configure({ asyncUtilTimeout: 5000 });

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
// #1760 post-teardown `window is not defined` leak is the leaked-timer safety
// net below — NOT `env="test"`, which an earlier version of this comment
// claimed. `env` is read only by `Transition.mjs`, and only at its *render*
// branch (`transitionDuration === 0 || env === "test"`); `useTransition()` is
// called before that check, since hooks cannot be conditional, so it still
// schedules real `window.setTimeout`s on every `mounted` change. Measured:
// opening a `<Modal>` through `renderWithMantine` schedules three 200ms timers
// (#1984). Tests that need specific media results still mock `@mantine/hooks`
// or stub `matchMedia` themselves.
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  // Partial `matchMedia` override: the members below are all the app touches.
  // The stub omits the rest of `MediaQueryList`, so the double cast bridges the
  // deliberately-incomplete shape. The `matches` regex is anchored to the
  // `reduce` form so the stub doesn't also answer `true` to
  // `(prefers-reduced-motion: no-preference)` (claiming both preferences at
  // once); Mantine only ever queries the `reduce` form.
  value: (query: string): MediaQueryList =>
    ({
      matches: /prefers-reduced-motion:\s*reduce/.test(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList,
});

// ---------------------------------------------------------------------------
// Leaked-timer safety net (#1984)
//
// A `window.setTimeout` that outlives its test file fires after happy-dom has
// disposed that file's `window`, and React's `dispatchSetState` then throws an
// uncaught `ReferenceError: window is not defined`. Vitest attributes that to
// whichever file happened to be running, and one such error fails the ENTIRE
// run with every test passing — so it reads as a defect in an innocent file.
//
// Mantine's own hooks do clear their timers on unmount (`useTransition`'s
// `clearAllTimeouts`, `useLockScroll`'s effect cleanup), so this is not a
// library bug. It is a race: `clearAllTimeouts` cancels the *pending* rAF, but
// if that rAF callback is already in flight when the unmount lands,
// `cancelAnimationFrame` is a no-op and the callback goes on to schedule a
// `setTimeout` after cleanup has already run. Nothing owns that timer. It needs
// a loaded machine to hit, which is why it only ever appears in CI.
//
// Rather than chase each component, track every timer *and every animation
// frame*, and clear whatever is still outstanding once the test's own teardown
// has had its turn. Ordering is load-bearing twice over: this runs *after*
// `cleanup()` below, so legitimate unmount cleanups clear their own timers and
// only true leaks are left; and frames are cancelled *before* timers are swept,
// because a queued frame callback would otherwise run after the sweep and
// register a fresh timer. See the ordering note on the `afterEach` itself.
//
// Under `vi.useFakeTimers()` the wrapper is swapped out for vitest's fake
// implementation, so nothing is tracked while fake timers are installed — which
// is correct, since a fake timer cannot outlive the environment.
// Handles are held as `unknown`, deliberately. The DOM lib declares these as
// `number`, but happy-dom returns objects at runtime — verified here:
// `setTimeout` yields a `Timeout` and `requestAnimationFrame` an `Immediate`.
// An earlier revision typed the sets `Set<number>` and guarded removal with
// `typeof id === "number"`; that guard never matched, so explicitly-cleared
// timers were never untracked. Harmless in effect (the teardown sweep clears
// them again and `clearTimeout` is idempotent) but the bookkeeping was a
// fiction, and the test asserting it passed vacuously. Treat the handle as
// opaque and pass it straight back to the matching canceller.
const pendingTimers = new Set<unknown>();
const pendingFrames = new Set<unknown>();
const realSetTimeout = window.setTimeout.bind(window);
const realClearTimeout = window.clearTimeout.bind(window);
const realRequestAnimationFrame = window.requestAnimationFrame.bind(window);
const realCancelAnimationFrame = window.cancelAnimationFrame.bind(window);

/** Cancel an opaque handle through the real canceller it came from. */
function cancelTimer(id: unknown): void {
  // The handle came from `realSetTimeout`, so it is exactly what
  // `realClearTimeout` expects; only the *declared* type disagrees.
  realClearTimeout(id as Parameters<typeof realClearTimeout>[0]);
}

function cancelFrame(handle: unknown): void {
  // As above, for the rAF pair.
  realCancelAnimationFrame(
    handle as Parameters<typeof realCancelAnimationFrame>[0],
  );
}

/** Test-only introspection, so the regression tests can assert on the
 *  bookkeeping itself rather than on behavior that would hold anyway. */
export function pendingTimerCount(): number {
  return pendingTimers.size;
}

window.setTimeout = ((
  handler: TimerHandler,
  timeout?: number,
  ...args: unknown[]
): unknown => {
  const id: unknown = realSetTimeout(
    (...cbArgs: unknown[]) => {
      pendingTimers.delete(id);
      if (typeof handler === "function") {
        handler(...cbArgs);
      }
    },
    timeout,
    ...args,
  );
  pendingTimers.add(id);
  return id;
  // The wrapper's public signature must match the DOM declaration the app codes
  // against, while its body traffics in the runtime handle described above. TS
  // cannot relate the two, hence the cast.
}) as unknown as typeof window.setTimeout;

window.clearTimeout = ((id?: unknown): void => {
  // No `typeof` guard: the handle is an object here, so a numeric test would
  // reject every real one. Anything defined is worth untracking.
  if (id !== undefined && id !== null) {
    pendingTimers.delete(id);
  }
  cancelTimer(id);
  // Same declaration-vs-runtime mismatch as `setTimeout` above.
}) as unknown as typeof window.clearTimeout;

window.requestAnimationFrame = ((callback: FrameRequestCallback): unknown => {
  const handle: unknown = realRequestAnimationFrame((time: number) => {
    pendingFrames.delete(handle);
    callback(time);
  });
  pendingFrames.add(handle);
  return handle;
  // Same declaration-vs-runtime mismatch as `setTimeout` above.
}) as unknown as typeof window.requestAnimationFrame;

window.cancelAnimationFrame = ((handle?: unknown): void => {
  if (handle !== undefined && handle !== null) {
    pendingFrames.delete(handle);
  }
  cancelFrame(handle);
  // Same declaration-vs-runtime mismatch as `setTimeout` above.
}) as unknown as typeof window.cancelAnimationFrame;

afterEach(() => {
  cleanup();
  window.localStorage.clear();

  // Order is the whole point, and it is not interchangeable.
  //
  // Cancel queued animation frames FIRST. This `afterEach` is synchronous, so a
  // frame callback already queued cannot run until it returns — at which point
  // it would register a fresh `setTimeout` *after* the sweep below had already
  // drained, and on the file's last test that timer would survive teardown.
  // That is precisely the rAF race this net exists for, so sweeping timers
  // without cancelling frames first would leave the original hole open.
  //
  // Cancelling first closes it deterministically: JS is single-threaded and
  // nothing here yields, so no frame callback can run between these two loops.
  for (const handle of pendingFrames) {
    cancelFrame(handle);
  }
  pendingFrames.clear();

  // Then drop the timers. After cleanup(), anything still pending is a leak.
  for (const id of pendingTimers) {
    cancelTimer(id);
  }
  pendingTimers.clear();
});
