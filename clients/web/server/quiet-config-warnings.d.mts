/** Type declarations for the dev-only `quiet-config-warnings.mjs` hook so its
 * pure helpers can be imported (and unit-tested) from TypeScript. */

/** (package-quote, repo-relative-source-path) pairs of benign warnings to drop. */
export declare const BENIGN_PAIRS: ReadonlyArray<readonly [string, string]>;

/** True when `text` is a benign node-only UNRESOLVED_IMPORT warning. */
export declare function isBenignWarning(text: string): boolean;
