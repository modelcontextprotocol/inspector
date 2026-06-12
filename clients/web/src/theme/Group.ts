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
    // `tabBar` clips the tab SegmentedControl to an animated width so the bar
    // grows/shrinks smoothly when a content-gated tab is added or removed
    // (#1450). `display: block` overrides Group's flex so the inner control
    // isn't shrunk below its natural (max-content) width; `overflow: hidden`
    // reveals/collapses the change as the runtime `width` (the control's
    // measured border-box size) transitions.
    if (props.variant === "tabBar") {
      return {
        root: {
          display: "block",
          overflow: "hidden",
          transition: "width 300ms ease-in",
        },
      };
    }
    return { root: {} };
  },
});
