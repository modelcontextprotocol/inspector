/**
 * Returns true when a numeric text input should defer committing its parsed
 * value. This keeps in-progress decimals (e.g. "1." or "1.0") visible while
 * typing instead of collapsing to an integer display value.
 */
export function shouldDeferNumericCommit(value: string): boolean {
  if (!value || value.endsWith(".")) {
    return true;
  }

  // Preserve trailing zeros after the decimal point (e.g. "1.0", "-74.0").
  return /^-?\d+\.\d*0$/.test(value);
}
