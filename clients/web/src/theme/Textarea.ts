import { Textarea } from "@mantine/core";

export const ThemeTextarea = Textarea.extend({
  // `code`: a textarea holding JSON, such as the load panel's pasted scenario
  // (#2911). Only the input is monospace — an `ff` prop would set the whole
  // root, label and description included.
  styles: (_theme, props) => {
    if (props.variant === "code") {
      return { input: { fontFamily: "var(--mantine-font-family-monospace)" } };
    }
    return {};
  },
});
