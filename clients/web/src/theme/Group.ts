import { Group } from "@mantine/core";

export const ThemeGroup = Group.extend({
  // `sectionHeader` styles a Group as a collapsible-section header "pleat". It
  // shares the `.filter-toggle` treatment used by the FilterToggleButton: a thin
  // outline on hover (rather than a background fill) so hover stays visually
  // distinct from the active state. The active (open) background is passed
  // per-instance via the `bg` prop. The border-radius and the reserved
  // transparent border both come from `.filter-toggle` in App.css — the border
  // must NOT be set here as an inline style, since inline styles outrank the
  // stylesheet `:hover` rule (see #1460).
  classNames: (_theme, props) => {
    if (props.variant === "sectionHeader") return { root: "filter-toggle" };
    return {};
  },
});
