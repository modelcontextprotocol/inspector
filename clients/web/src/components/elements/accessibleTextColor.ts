/**
 * Maps a bare Mantine color name to its scheme-aware `*-light-color` variable
 * for use as **colored text**. A bare `c="yellow"` resolves to a mid `filled`
 * shade that fails WCAG AA on light surfaces (amber/green/red text on white or
 * on the `inspector-light` selected-chip tint land at ~3–4:1). The `-light-color`
 * variable is scheme-aware — the app darkens it to shade 8/9 in light mode (see
 * the `App.css` light-scheme block) and Mantine keeps a lighter shade in dark
 * mode — so the same token clears AA against both light and dark backgrounds.
 *
 * `"dimmed"` is passed through unchanged (already AA-tuned to gray-7 / dark-1 in
 * `App.css`), as is `undefined` (inherit the default body text color).
 */
export function accessibleTextColor(color?: string): string | undefined {
  if (!color || color === "dimmed") return color;
  return `var(--mantine-color-${color}-light-color)`;
}
