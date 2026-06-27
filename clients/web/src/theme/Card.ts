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
      // Sidebar container that grows with its content but never taller than the
      // screen's available area (`max-height: 100%` of the full-height column
      // wrapper) — like the Tools panel. Lays its content out as a column and
      // hides overflow so that, once capped, the flex accordion below the fixed
      // title/search takes over per-section scrolling rather than the card
      // bleeding past the viewport (#1462).
      return {
        root: {
          backgroundColor: "var(--inspector-surface-card)",
          maxHeight: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        },
      };
    }
    if (props.variant === "highlighted") {
      // Freshly-added / called-out server card: a prominent green border draws
      // the eye until the highlight is dismissed (#1535).
      return {
        root: {
          backgroundColor: "var(--inspector-surface-card)",
          borderColor: "var(--inspector-highlight-border)",
          borderWidth: 2,
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
