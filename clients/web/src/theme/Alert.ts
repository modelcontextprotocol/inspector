import { Alert } from "@mantine/core";

export const ThemeAlert = Alert.extend({
  defaultProps: {
    radius: "md",
  },
  styles: (_theme, props) => {
    // Warning alert: a bright, cheerful yellow. In light mode a light-yellow
    // fill (`yellow-1`) with crisp near-black text (≈18:1) — replacing the
    // muddy brown that a tinted `yellow` alert produced once `yellow-light-color`
    // was darkened to `yellow-9` for contrast. Dark mode keeps Mantine's
    // light-yellow-on-dark-tint (already AA). A bright `yellow-5` left accent
    // reads as "warning" in both schemes.
    if (props.variant === "warning") {
      return {
        root: {
          backgroundColor:
            "light-dark(var(--mantine-color-yellow-1), var(--mantine-color-yellow-light))",
          borderInlineStart: "3px solid var(--mantine-color-yellow-5)",
        },
        title: {
          color:
            "light-dark(var(--mantine-color-black), var(--mantine-color-yellow-light-color))",
        },
        message: {
          color:
            "light-dark(var(--mantine-color-black), var(--mantine-color-yellow-light-color))",
        },
      };
    }
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
