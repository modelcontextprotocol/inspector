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
    // The four typographic treatments the Skills screen repeats (#2263). They
    // live here rather than as `fw`/`size`/`c`/`ff` props on the screen's
    // `.withProps()` constants because they are flat CSS properties, which
    // AGENTS.md places in the theme; the constants keep only layout.
    //
    // `sectionHeading` labels a collapsible section; `skillTitle` names the
    // selected skill; `monoCaption` is the dimmed monospace line used for URIs
    // and digests; `emptyState` is the centred placeholder shown before a
    // selection exists.
    if (props.variant === "sectionHeading") {
      return {
        root: { fontWeight: 600, fontSize: "var(--mantine-font-size-sm)" },
      };
    }
    if (props.variant === "skillTitle") {
      return {
        root: { fontWeight: 600, fontSize: "var(--mantine-font-size-lg)" },
      };
    }
    if (props.variant === "monoCaption") {
      return {
        root: {
          fontSize: "var(--mantine-font-size-xs)",
          fontFamily: "var(--mantine-font-family-monospace)",
          color: "var(--inspector-text-secondary)",
        },
      };
    }
    if (props.variant === "emptyState") {
      return {
        root: {
          color: "var(--inspector-text-secondary)",
          textAlign: "center",
        },
      };
    }
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
