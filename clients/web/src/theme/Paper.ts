import { Paper } from "@mantine/core";

export const ThemePaper = Paper.extend({
  classNames: (_theme, props) => {
    if (props.variant === "code") return { root: "paper-code" };
    return {};
  },
  styles: (_theme, props) => {
    if (props.variant === "code") {
      return {
        root: {
          padding: "var(--mantine-spacing-md)",
          backgroundColor: "var(--inspector-surface-code)",
          fontFamily: "var(--mantine-font-family-monospace)",
          fontSize: "var(--mantine-font-size-sm)",
          overflow: "auto",
        },
      };
    }
    if (props.variant === "contained") {
      return {
        root: {
          overflow: "hidden",
          minWidth: 0,
        },
      };
    }
    if (props.variant === "panel") {
      return {
        root: {
          display: "flex",
          flexDirection: "column" as const,
          overflow: "hidden",
          minHeight: 0,
        },
      };
    }
    return { root: {} };
  },
});
