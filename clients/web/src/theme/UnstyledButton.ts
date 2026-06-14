import { UnstyledButton } from "@mantine/core";

export const ThemeUnstyledButton = UnstyledButton.extend({
  classNames: (_theme, props) => {
    if (props.variant === "listItem") return { root: "list-item" };
    if (props.variant === "filterToggle") return { root: "filter-toggle" };
    return {};
  },
  styles: (_theme, props) => {
    if (props.variant === "listItem") {
      return { root: { borderRadius: "var(--mantine-radius-md)" } };
    }
    // `filterToggle` is styled entirely via the `.filter-toggle` rules in
    // App.css (border-radius, the reserved transparent border, the :hover
    // border, and the active background). Crucially the border must NOT be set
    // here as an inline style — inline styles outrank stylesheet `:hover`
    // rules, which would stop the hover border from ever showing (see #1460).
    return { root: {} };
  },
});
