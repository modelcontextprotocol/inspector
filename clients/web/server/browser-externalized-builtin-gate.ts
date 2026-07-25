/**
 * Build-gate logic for #1769: fail a browser `vite build` when a Node built-in
 * reaches the browser graph.
 *
 * Vite 8 (rolldown) *externalizes* a `node:*` / bare Node built-in that leaks
 * into the browser bundle — it emits a warning and ships a `module.exports = {}`
 * stub, and the build still succeeds. That green build ships a broken bundle
 * (#1615). The runtime browser smoke (`smoke:web:browser`) only catches the
 * subset where the stub is *called* at module init (CASE 1); a stub that's
 * imported but never called ships silently (CASE 2) and nothing gates it.
 *
 * Promoting that specific warning to a hard build error moves CASE 1 detection
 * upstream into `npm run build` / `validate` and additionally catches CASE 2.
 *
 * This module holds the Vite-agnostic pieces so they can be unit-tested without
 * standing up a build; the thin Vite `Plugin` that wires them into `onLog` /
 * `buildEnd` lives in `vite.config.ts`, scoped there to the browser (`client`)
 * environment. The reason the throw can't happen in `onLog` directly (rolldown
 * swallows it there) is documented at that call site.
 */

// The phrase Vite 8 (rolldown) emits when a Node built-in was externalized for
// the browser. There is no stable rollup `code` on this rolldown log — verified
// against the pinned vite@8.0.0, the log carries only `message` +
// `plugin: "rolldown:vite-resolve"` — so the gate keys off this documented,
// user-facing phrasing, whose troubleshooting anchor
// (`module-externalized-for-browser-compatibility`) Vite treats as stable.
// The `verify:build-gate` script exercises a real build so a phrasing drift in a
// future Vite bump fails CI here rather than silently disabling the gate. That
// script also drift-guards its mirrored copy by regex against this assignment —
// keep it a single string literal (no concatenation/template) or the guard will
// report a false drift.
export const BROWSER_EXTERNALIZED_BUILTIN_PHRASE =
  "has been externalized for browser compatibility";

// True for a build log announcing a browser-externalized Node built-in. Typed
// as a `message is string` guard: a match implies a defined string, so callers
// can add it to a `Set<string>` without a separate `undefined` check.
export function isBrowserExternalizedBuiltinLog(
  message: string | undefined,
): message is string {
  return message?.includes(BROWSER_EXTERNALIZED_BUILTIN_PHRASE) ?? false;
}

/**
 * The actionable error a browser-externalized Node built-in fails the build
 * with. Takes every matched warning so a build that leaks several built-ins
 * reports them all in one pass, rather than one-per-rebuild.
 */
export function browserExternalizedBuiltinError(messages: string[]): Error {
  const list = messages.map((m) => `  - ${m}`).join("\n");
  // Keep the error's `#1769` lead contiguous in a single string fragment:
  // scripts/verify-build-gate.mjs mirrors that lead as ERROR_PREFIX (its success
  // key) and drift-guards on it as a whole-file substring, so it must occur
  // exactly ONCE here — do not quote the full lead in this comment, and don't
  // reflow it across fragments, or the guard would pass on a copy and mask a
  // reworded error.
  return new Error(
    "Build failed (#1769): a Node built-in reached the browser bundle and was " +
      "externalized to an empty stub, which ships a broken bundle. Remove the " +
      "node:* / Node built-in import(s) from the browser graph (or gate them " +
      "behind the Node-only dev backend). If an import comes from a dependency " +
      "(not first-party code — see the module path in the warning below), add a " +
      "`resolve.alias` in clients/web/vite.config.ts pointing it at a browser " +
      "shim.\n\nOriginal Vite warning(s):\n" +
      list,
  );
}

/** Records browser-externalization build logs and fails the build if any were seen. */
export interface BrowserExternalizedBuiltinGate {
  /** Feed each build log's message here; matching ones are collected (deduped). */
  recordLog(message: string | undefined): void;
  /** Throw {@link browserExternalizedBuiltinError} if any match was recorded. */
  assertClean(): void;
  /** Clear recorded state so a rebuild (e.g. `vite build --watch`) starts fresh. */
  reset(): void;
}

/**
 * A per-build detector: `recordLog` is called for every build log (from the
 * plugin's `onLog`), `assertClean` is called once resolution is complete (from
 * the plugin's `buildEnd`) and throws — listing every offender — if any Node
 * built-in was externalized. The plugin `reset`s it in `buildStart` so a
 * watch-mode rebuild doesn't inherit a previous build's recorded warnings.
 */
export function createBrowserExternalizedBuiltinGate(): BrowserExternalizedBuiltinGate {
  const externalized = new Set<string>();
  return {
    recordLog(message) {
      if (isBrowserExternalizedBuiltinLog(message)) {
        externalized.add(message);
      }
    },
    assertClean() {
      if (externalized.size > 0) {
        throw browserExternalizedBuiltinError([...externalized]);
      }
    },
    reset() {
      externalized.clear();
    },
  };
}
