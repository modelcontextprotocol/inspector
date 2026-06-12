import { Text } from "@mantine/core";

export const ThemeText = Text.extend({
  styles: (_theme, props) => {
    if (props.variant === "monoBreak") {
      return {
        root: {
          wordBreak: "break-all",
        },
      };
    }
    return { root: {} };
  },
});
