/**
 * Amber fills (`orange` / `yellow`) at Mantine's default filled shade land right
 * at `autoContrast`'s luminance threshold, so it picks WHITE text that fails
 * WCAG AA on amber (~2–4:1 in both schemes). Pinning those two colors to shade 5
 * keeps the fill bright while moving `autoContrast` decisively onto BLACK text
 * (~9–10:1). Every other color is returned unchanged — its default
 * filled + `autoContrast` pairing already clears AA.
 *
 * Used by the filled semantic badges (annotation / task-status / log-level) so
 * the amber-contrast fix lives in one place rather than each color map.
 */
export function filledBadgeColor(color: string): string {
  if (color === "yellow") return "yellow.5";
  if (color === "orange") return "orange.5";
  return color;
}
