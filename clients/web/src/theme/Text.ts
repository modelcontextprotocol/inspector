import { Text } from "@mantine/core";

export const ThemeText = Text.extend({
  // `tabGlow` labels carry the `.tab-glow` class so a freshly-appeared tab can
  // pulse a red glow (the keyframe + `[data-glow="on"]` trigger live in
  // App.css). Auto-assigning the class keeps `className` out of the JSX (#1450).
  classNames: (_theme, props) => {
    if (props.variant === "tabGlow") return { root: "tab-glow" };
    return {};
  },
  styles: (_theme, props) => {
    if (props.variant === "monoBreak") {
      return {
        root: {
          wordBreak: "break-all",
        },
      };
    }
    // Single-line text that never wraps — used inside a horizontal ScrollArea so
    // a long value (e.g. a network URL in the compact column) scrolls instead of
    // wrapping to many lines (#1616).
    if (props.variant === "nowrap") {
      return {
        root: {
          whiteSpace: "nowrap",
        },
      };
    }
    // A line of captured server stderr (#1621): preserve the process's own
    // newlines/whitespace (`pre-wrap`) while still wrapping over-long lines
    // inside the narrow monitoring column (`break-word`).
    if (props.variant === "consoleLine") {
      return {
        root: {
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        },
      };
    }
    // A small, unobtrusive build-version label pinned to the lower-right corner
    // of the screen (#1639): grey, non-interactive (clicks pass through), and
    // out of the tab/selection flow so it never interferes with the UI beneath.
    if (props.variant === "versionBadge") {
      return {
        root: {
          position: "fixed",
          bottom: "0.35rem",
          right: "0.6rem",
          zIndex: 100,
          color: "var(--inspector-text-secondary)",
          fontSize: "var(--mantine-font-size-xs)",
          pointerEvents: "none",
          userSelect: "none",
        },
      };
    }
    return { root: {} };
  },
});
