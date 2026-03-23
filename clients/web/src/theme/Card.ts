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
  styles: () => ({
    root: { backgroundColor: "var(--inspector-surface-card)" },
  }),
});
