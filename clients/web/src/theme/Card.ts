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
    if (props.variant === "sidebar") {
      // Full-height sidebar container — matches the detail panel's height so
      // the two columns line up. Lays its content out as a column and hides
      // overflow so a flex-grown inner ScrollArea (below the fixed title /
      // search) takes over scrolling, and only once the panel is genuinely
      // full rather than at a fixed sub-viewport cap (#1462).
      return {
        root: {
          backgroundColor: "var(--inspector-surface-card)",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
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
