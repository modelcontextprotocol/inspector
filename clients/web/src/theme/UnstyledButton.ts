import { UnstyledButton } from "@mantine/core";

export const ThemeUnstyledButton = UnstyledButton.extend({
  styles: (_theme, props) => {
    if (props.variant === "listItem") {
      return { root: { borderRadius: "var(--mantine-radius-md)" } };
    }
    return { root: {} };
  },
});
