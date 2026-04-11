import { Flex } from "@mantine/core";

export const ThemeFlex = Flex.extend({
  styles: (_theme, props) => {
    if (props.variant === "screen") {
      return {
        root: {
          overflow: "hidden",
        },
      };
    }
    return { root: {} };
  },
});
