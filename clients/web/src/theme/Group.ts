import { Group } from "@mantine/core";

export const ThemeGroup = Group.extend({
  // `sectionHeader` styles a Group as a collapsible-section header "pleat":
  // rounded, with the same hover highlight as the listItem toggles. The active
  // (open) background is passed per-instance via the `bg` prop.
  classNames: (_theme, props) => {
    if (props.variant === "sectionHeader") return { root: "list-item" };
    return {};
  },
  styles: (_theme, props) => {
    if (props.variant === "sectionHeader") {
      return { root: { borderRadius: "var(--mantine-radius-md)" } };
    }
    return { root: {} };
  },
});
