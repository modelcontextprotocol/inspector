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
    // A single line that scrolls sideways in place of wrapping or clipping —
    // the compact sidebar row's target / URL (#2675). A native scroller rather
    // than a Mantine `ScrollArea`: the row is mounted per message, and a
    // `ScrollArea` root keeps its element refs in state, so it re-renders
    // several times on every mount (#2932). The host is made focusable at the
    // call site so the overflow is keyboard-scrollable (WCAG SC 2.1.1).
    if (props.variant === "hscroll") {
      return {
        root: {
          whiteSpace: "nowrap",
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarWidth: "thin",
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
    // The reason a server card's last connect attempt failed (#2783), kept on
    // the card after the toast that first reported it auto-closes. The text
    // is often a raw transport error carrying a URL or a JSON body, so it has
    // to wrap inside the card rather than run under its border.
    if (props.variant === "connectError") {
      return {
        root: {
          color: "var(--inspector-danger-text)",
          fontSize: "var(--mantine-font-size-sm)",
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
    if (props.variant === "skillDescription") {
      return { root: { fontSize: "var(--mantine-font-size-sm)" } };
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
    // One line of a tool-run diff (#2830): monospace, whitespace preserved so
    // the JSON indentation survives, and a tinted background on a changed
    // line. `diffSame` is the unchanged context line.
    if (
      props.variant === "diffAdded" ||
      props.variant === "diffRemoved" ||
      props.variant === "diffSame"
    ) {
      return {
        root: {
          fontFamily: "var(--mantine-font-family-monospace)",
          fontSize: "var(--mantine-font-size-xs)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          backgroundColor:
            props.variant === "diffAdded"
              ? "var(--inspector-diff-added-bg)"
              : props.variant === "diffRemoved"
                ? "var(--inspector-diff-removed-bg)"
                : undefined,
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
