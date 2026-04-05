import { UnstyledButton } from "@mantine/core";

export const ThemeUnstyledButton = UnstyledButton.extend({
  classNames: (_theme, props) => {
    if (props.variant === "listItem") return { root: "list-item" };
    return {};
  },
  styles: (_theme, props) => {
    if (props.variant === "listItem") {
      return { root: { borderRadius: "var(--mantine-radius-md)" } };
    }
    return { root: {} };
  },
});
