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
    // A permanently-present transparent border reserves the space so the
    // hover border (`.filter-toggle:hover` in App.css) doesn't shift layout.
    if (props.variant === "filterToggle") {
      return {
        root: {
          borderRadius: "var(--mantine-radius-md)",
          border: "1px solid transparent",
        },
      };
    }
    return { root: {} };
  },
});
