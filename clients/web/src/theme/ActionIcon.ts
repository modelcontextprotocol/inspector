import { ActionIcon } from "@mantine/core";

export const ThemeActionIcon = ActionIcon.extend({
  defaultProps: {
    variant: "subtle",
    // Neutral grey chrome icons (settings, theme toggle, sidebar, pin, sort,
    // replay). `subtle` otherwise inherits the primary color and renders blue.
    color: "gray",
    radius: "md",
  },
});
