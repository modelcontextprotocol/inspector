import { Accordion } from "@mantine/core";

export const ThemeAccordion = Accordion.extend({
  // The `disclosure` variant drives three behaviours via App.css (see #1462):
  //   - `disclosure-chevron` on the chevron slot rotates a right-pointing arrow
  //     90° (right → down) on open, instead of Mantine's default 180° flip.
  //   - `disclosure-sections` on the root makes the accordion a full-height
  //     flex column: section headers stay pinned and each open section's panel
  //     scrolls within its own (item-count-weighted) share of the space, so
  //     nothing scrolls until the panel is full.
  //   - `filter-toggle` on the control gives the section headers the same
  //     outline-on-hover treatment as the FilterToggleButton and the Protocol
  //     section headers: a thin border on hover (rather than a background fill)
  //     and a filled background when the section is open (`aria-expanded`).
  // Pair it with `chevron={<RiArrowRightSLine />}` and per-item `flex` weights.
  classNames: (_theme, props) => {
    if (props.variant === "disclosure")
      return {
        root: "disclosure-sections",
        chevron: "disclosure-chevron",
        control: "filter-toggle",
      };
    return {};
  },
});
