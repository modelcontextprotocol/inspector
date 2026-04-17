import { Input } from "@mantine/core";

export const ThemeInput = Input.extend({
  styles: () => ({
    input: {
      backgroundColor: "var(--inspector-input-background)",
    },
  }),
});
