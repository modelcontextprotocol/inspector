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
 * `buildEnd` lives in `vite.config.ts`. The reason the throw can't happen in
 * `onLog` directly (rolldown swallows it there) is documented at that call site.
 */

// The phrase Vite 8 (rolldown) emits when a Node built-in was externalized for
// the browser. There is no stable rollup `code` on this rolldown log — verified
// against the pinned vite@8.0.0, the log carries only `message` +
// `plugin: "rolldown:vite-resolve"` — so the gate keys off this documented,
// user-facing phrasing, whose troubleshooting anchor
// (`module-externalized-for-browser-compatibility`) Vite treats as stable.
// The `verify:build-gate` script exercises a real build so a phrasing drift in a
// future Vite bump fails CI here rather than silently disabling the gate.
export const BROWSER_EXTERNALIZED_BUILTIN_PHRASE =
  'has been externalized for browser compatibility';

/** True for a build log announcing a browser-externalized Node built-in. */
export function isBrowserExternalizedBuiltinLog(
  message: string | undefined,
): boolean {
  return message?.includes(BROWSER_EXTERNALIZED_BUILTIN_PHRASE) ?? false;
}

/** The actionable error a browser-externalized Node built-in fails the build with. */
export function browserExternalizedBuiltinError(message: string): Error {
  return new Error(
    'Build failed (#1769): a Node built-in reached the browser bundle and was ' +
      'externalized to an empty stub, which ships a broken bundle. Remove the ' +
      'node:* / Node built-in import from the browser graph (or gate it behind ' +
      'the Node-only dev backend).\n\nOriginal Vite warning: ' +
      message,
  );
}

/** Records browser-externalization build logs and fails the build if any were seen. */
export interface BrowserExternalizedBuiltinGate {
  /** Feed each build log's message here; the first matching one is retained. */
  recordLog(message: string | undefined): void;
  /** Throw {@link browserExternalizedBuiltinError} if a match was recorded. */
  assertClean(): void;
}

/**
 * A single-build detector: `recordLog` is called for every build log (from the
 * plugin's `onLog`), `assertClean` is called once resolution is complete (from
 * the plugin's `buildEnd`) and throws if a Node built-in was externalized. State
 * is per-instance so each build gets a fresh gate.
 */
export function createBrowserExternalizedBuiltinGate(): BrowserExternalizedBuiltinGate {
  let externalizedWarning: string | undefined;
  return {
    recordLog(message) {
      if (externalizedWarning === undefined && isBrowserExternalizedBuiltinLog(message)) {
        externalizedWarning = message;
      }
    },
    assertClean() {
      if (externalizedWarning !== undefined) {
        throw browserExternalizedBuiltinError(externalizedWarning);
      }
    },
  };
}
