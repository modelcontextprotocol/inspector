import { AppShell } from "@mantine/core";

export const ThemeAppShell = AppShell.extend({
  defaultProps: {
    // Each screen owns its `xl` padding and sizes itself to the viewport minus
    // the fixed header, so Main contributes only the header offset (no extra
    // inset). See the AppShell usage in InspectorView.
    padding: 0,
  },
  styles: {
    // Clamp Main to the viewport (minus the header offset Mantine already adds
    // as padding-top) and clip overflow so the InspectorView as a whole never
    // scrolls — only the inner ScrollArea regions within each screen do. Guards
    // against sub-pixel rounding that could otherwise surface a page scrollbar.
    // `dvh` matches the unit the screens size themselves with (`calc(100dvh -
    // header)`), so a dynamic mobile toolbar can't make a screen taller than
    // this clipped box and lose its bottom edge.
    main: {
      height: "100dvh",
      overflow: "hidden",
    },
  },
});
