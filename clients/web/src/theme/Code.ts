import { Code } from "@mantine/core";

export const ThemeCode = Code.extend({
  styles: (_theme, props) => {
    const root: Record<string, string> = {
      backgroundColor: "var(--inspector-surface-code)",
    };
    if (props.variant === "wrapping") {
      root.wordBreak = "break-all";
      root.whiteSpace = "pre-wrap";
    }
    return { root };
  },
});
