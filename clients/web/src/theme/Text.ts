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
    // Two small, unobtrusive labels that sit in the footer row (#1682): the
    // build version (left) and the copyright notice (right), positioned by the
    // footer's `space-between` Group. Both are grey, single-line, and out of the
    // text-selection flow. (Superseded the fixed bottom-corner badges of #1639
    // now that the footer is a real, full-width AppShell row.)
    if (
      props.variant === "versionBadge" ||
      props.variant === "copyrightBadge"
    ) {
      return {
        root: {
          color: "var(--inspector-text-secondary)",
          fontSize: "var(--mantine-font-size-xs)",
          whiteSpace: "nowrap",
          userSelect: "none",
        },
      };
    }
    return { root: {} };
  },
});
