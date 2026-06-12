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
    // Brief fade used for navigation tab labels — when a content-gated tab
    // (Apps/Prompts/Resources/Tasks) appears after a list change, the label
    // mounts fresh and this animation draws the eye to it (#1450). The
    // keyframe lives in App.css; existing tabs don't remount, so they don't
    // re-animate.
    if (props.variant === "tabLabel") {
      return {
        root: {
          animation: "inspector-fade-in 450ms ease",
        },
      };
    }
    return { root: {} };
  },
});
