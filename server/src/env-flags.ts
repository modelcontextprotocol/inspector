/**
 * Strict parsing for the proxy's boolean `DANGEROUSLY_*` environment flags.
 *
 * Each of those flags weakens a security control, so it must take an explicit
 * opt-in to turn one on: a typo, `false`, `0` or an empty value has to leave
 * the control enforcing rather than read as "set". One parser serves every
 * such flag so they cannot drift apart in what they accept.
 */

const TRUTHY_FLAG_VALUES = new Set(["true", "1", "yes"]);

/**
 * Whether a flag's value is an explicit opt-in.
 *
 * Only `true`, `1` or `yes` (case-insensitive, surrounding whitespace ignored)
 * count. Anything else (unset, empty, `false`, `0`, or an unrecognized value)
 * returns false.
 */
export function isExplicitTruthyFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  return TRUTHY_FLAG_VALUES.has(value.trim().toLowerCase());
}
