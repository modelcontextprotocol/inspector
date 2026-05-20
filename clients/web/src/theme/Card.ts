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
    if (props.variant === "preview") {
      // Container for the resource preview / template form panels: sizes to
      // content (no forced height) but caps at the screen's available area
      // via consumer-set `mah`. `overflow: hidden` lets a flex-shrunk inner
      // ScrollArea take over scrolling when content exceeds the cap, instead
      // of the whole card bleeding past the viewport.
      return {
        root: {
          backgroundColor: "var(--inspector-surface-card)",
          overflow: "hidden",
        },
      };
    }
    return {
      root: { backgroundColor: "var(--inspector-surface-card)" },
    };
  },
});
