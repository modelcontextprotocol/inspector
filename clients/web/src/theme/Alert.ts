import { Alert } from "@mantine/core";

export const ThemeAlert = Alert.extend({
  defaultProps: {
    radius: "md",
  },
  styles: (_theme, props) => {
    // Re-auth banner: body-colored surface with a red hairline border, used
    // for the persistent mid-session re-authentication banner.
    if (props.variant === "reauth") {
      return {
        root: {
          backgroundColor: "var(--mantine-color-body)",
          border: "1px solid var(--mantine-color-red-3)",
        },
      };
    }
    return { root: {} };
  },
});
