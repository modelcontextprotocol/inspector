/**
 * Commander-style parsers for the numeric `--load-*` flags, shared by both
 * CLIs so they refuse the same inputs.
 *
 * A module of their own (#2841) so that `load-thresholds.ts` can use them
 * without a value import from `load-test.ts`, which now imports the
 * thresholds' breach check to stop a stepped run at its first breach.
 */

/**
 * Commander-style parser for a positive integer flag (`--load-concurrency`,
 * `--load-requests`). Plain decimal digits only, so `1.5`, `1e3` and `0x10`
 * are refused rather than coerced.
 */
export function positiveIntegerParser(flag: string): (value: string) => number {
  return (value: string): number => {
    const trimmed = value.trim();
    const n = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
    if (!Number.isSafeInteger(n) || n <= 0) {
      throw new Error(`${flag} must be a positive integer.`);
    }
    return n;
  };
}

/** Commander-style parser for a positive, finite number flag. */
export function positiveNumberParser(flag: string): (value: string) => number {
  return (value: string): number => {
    const n = value.trim() === "" ? NaN : Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`${flag} must be a positive number.`);
    }
    return n;
  };
}
