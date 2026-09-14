import { Table } from "@mantine/core";

export const ThemeTable = Table.extend({
  // The Skills resource manifest (#2263). `striped`, `withTableBorder`,
  // `highlightOnHover` and `verticalSpacing` are Mantine's own API and stay
  // props at the call site; the font size is a flat CSS property, so it lives
  // here rather than as an `fz` prop on the screen's `.withProps()` constant.
  styles: (_theme, props) => {
    if (props.variant === "manifest") {
      return { table: { fontSize: "var(--mantine-font-size-xs)" } };
    }
    return {};
  },
});
