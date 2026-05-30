import { Title } from "@mantine/core";

export const ThemeTitle = Title.extend({
  styles: (_theme, props) => {
    if (props.variant === "section") {
      return {
        root: {
          backgroundColor: "var(--inspector-surface-subtle)",
          padding: "0.375rem 0.75rem",
          borderRadius: "var(--mantine-radius-sm)",
        },
      };
    }
    return { root: {} };
  },
});
