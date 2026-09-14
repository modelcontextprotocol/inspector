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
  // The Skills pane's metadata sections use `flex: 0 1 auto` with a `mih`
  // floor: they give up space until they reach that floor and then scroll their
  // own panels, which is what leaves the file viewer its share no matter how
  // large a manifest or findings list gets.
  //
  // The scrolling root is the FALLBACK for when even the combined floors do not
  // fit — with several sections open in a short window there is no arrangement
  // that shows everything, and scrolling the stack at a section boundary beats
  // crushing a panel below its floor.
  //
  // ⚠️ The floor is load-bearing, not decoration. Without it a section can be
  // squeezed far below its content and slice it mid-line; with `flex-shrink: 0`
  // instead, a 512-row manifest keeps its full height and pushes the viewer off
  // the bottom of the pane. `SECTION_FLEX` in `SkillsScreen.tsx` records both
  // failures — this variant only works in combination with it.
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
