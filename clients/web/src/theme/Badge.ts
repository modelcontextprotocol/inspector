import { Badge } from "@mantine/core";

export const ThemeBadge = Badge.extend({
  defaultProps: {
    size: "sm",
    radius: "sm",
    fw: 600,
  },
  styles: (_theme, props) => {
    // Request-status chips (Protocol OK/Error/Pending, Network 2xx/4xx/…) read
    // as a tinted light-variant chip in light mode but a solid filled chip in
    // dark mode (matching the reference), keyed off the status `color`.
    // `light-dark()` tracks the scheme Mantine sets via the `color-scheme`
    // property, so light → light tokens, dark → filled + white text.
    if (props.variant === "status" && props.color) {
      const c = props.color;
      // Amber hues (orange 4xx / yellow 3xx) can't clear WCAG AA either way the
      // tinted status chip renders them — `-light-color` text is too light on
      // the light tint, and white is too light on the dark `-filled` fill. Pin
      // them to a mid amber fill with black text in both schemes instead (the
      // same autoContrast reasoning as `filledBadgeColor`); black-on-amber-5
      // clears ~9:1.
      if (c === "orange" || c === "yellow") {
        return {
          root: {
            backgroundColor: `var(--mantine-color-${c}-5)`,
            color: "var(--mantine-color-black)",
          },
        };
      }
      return {
        root: {
          backgroundColor: `light-dark(var(--mantine-color-${c}-light), var(--mantine-color-${c}-filled))`,
          color: `light-dark(var(--mantine-color-${c}-light-color), var(--mantine-color-white))`,
        },
      };
    }
    return { root: {} };
  },
});
