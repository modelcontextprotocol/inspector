import { Code } from "@mantine/core";

export const ThemeCode = Code.extend({
  styles: (_theme, props) => {
    const root: Record<string, string> = {
      // Reads an overridable cascade variable so a host context can raise the
      // surface (e.g. the Protocol/Network `inset` message cards set
      // `--inspector-code-surface` to white in light mode); falls back to the
      // standard grey inset everywhere else.
      backgroundColor:
        "var(--inspector-code-surface, var(--inspector-surface-code))",
    };
    if (props.variant === "wrapping") {
      root.wordBreak = "break-all";
      root.whiteSpace = "pre-wrap";
    }
    if (props.block) {
      root.margin = "0";
    }
    if (props.variant === "nowrap") {
      // Single line, fixed height: clip overflow with an ellipsis rather than
      // wrapping onto new lines (which would grow the container's height). The
      // full value stays available via the adjacent copy button.
      root.whiteSpace = "nowrap";
      root.overflow = "hidden";
      root.textOverflow = "ellipsis";
    }
    return { root };
  },
});
