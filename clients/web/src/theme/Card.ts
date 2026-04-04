import { Card } from "@mantine/core";

export const ThemeCard = Card.extend({
  defaultProps: {
    padding: "lg",
    radius: "md",
    withBorder: true,
  },
  classNames: (_theme, props) => {
    if (props.variant === "responsive") return { root: "card-responsive" };
    return {};
  },
  styles: (_theme, props) => {
    if (props.variant === "disabled") {
      return {
        root: {
          backgroundColor: "var(--inspector-surface-card)",
          opacity: 0.4,
          pointerEvents: "none",
        },
      };
    }
    return {
      root: { backgroundColor: "var(--inspector-surface-card)" },
    };
  },
});
