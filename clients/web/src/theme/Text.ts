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
    // inside the narrow monitoring sidebar (`break-word`).
    if (props.variant === "consoleLine") {
      return {
        root: {
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        },
      };
    }
    // Two small, unobtrusive labels pinned to the bottom corners of the screen
    // on the same row (#1639): the build version (bottom-left) and the
    // copyright notice (bottom-right). Each occupies the full-height `xl` bottom
    // margin band (`height: xl` + flex centering) so the text sits vertically
    // centered in it, and insets by `xl` horizontally to line up with the
    // content's left/right margins. Both are grey, non-interactive (clicks pass
    // through), and out of the tab/selection flow.
    if (
      props.variant === "versionBadge" ||
      props.variant === "copyrightBadge"
    ) {
      const horizontal =
        props.variant === "versionBadge"
          ? { left: "var(--mantine-spacing-xl)" }
          : { right: "var(--mantine-spacing-xl)" };
      return {
        root: {
          position: "fixed",
          bottom: 0,
          height: "var(--mantine-spacing-xl)",
          display: "flex",
          alignItems: "center",
          ...horizontal,
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
