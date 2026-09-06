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
    if (props.variant === "disclosure" || props.variant === "skillSections")
      return {
        root: "disclosure-sections",
        chevron: "disclosure-chevron",
        control: "filter-toggle",
      };
    return {};
  },
  // `skillSections` is `disclosure` plus a scrolling root (#2263).
  //
  // The Skills pane holds sections whose content is a rendered document or a
  // findings list, not a uniform row list, so they are sized to their content
  // and never shrink. That removes the mid-content clipping a shrinking panel
  // produced — the panel really was scrollable, but macOS overlay scrollbars
  // are invisible until hover, so a Resources table cut off mid-alert read as
  // broken rather than scrollable. Overflow moves up to the root, so in the
  // rare case the sections genuinely exceed the pane it is the *stack* that
  // scrolls, at a section boundary, instead of a panel slicing its own content.
  styles: (_theme, props) => {
    if (props.variant === "skillSections") {
      return {
        root: { overflowY: "auto", minHeight: 0 },
        // Every section gets the same breathing room under its header that its
        // banners get between each other — without it a panel's first item sits
        // flush against the control and reads as part of the header rather than
        // as the section's content.
        content: { paddingTop: "var(--mantine-spacing-sm)" },
      };
    }
    return {};
  },
});
