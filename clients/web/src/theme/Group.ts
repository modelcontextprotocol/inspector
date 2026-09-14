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
  styles: (_theme, props) => {
    // `stickyModalFooter` is the permanent band at the bottom of the
    // Client/Server Settings modals naming where secrets are stored (#1950).
    // Flat properties, so they belong here rather than in App.css.
    //
    // `position: sticky` is the load-bearing part, and it is the mirror of how
    // Mantine pins the modal header. `Modal.Content` wraps *all* of its
    // children — header, body, and this band — in one scroll area sized to the
    // viewport, so a plain block at the end simply scrolls off the bottom with
    // the body (measured: at 900px tall the band landed 140px below the fold).
    // A footer the user has to scroll to find is not the permanent statement
    // this is supposed to be, so it sticks to the bottom edge instead, with
    // the same opaque body background and z-index the sticky header uses so
    // content passes underneath rather than through it.
    // Structural, not domain: this says "a band pinned to the bottom of a
    // modal", which is all the theme layer should know. What the band *means*
    // — that it names where your secrets go — belongs to `SecretStorageFooter`,
    // the element that owns those semantics.
    if (props.variant === "stickyModalFooter") {
      return {
        root: {
          position: "sticky",
          bottom: 0,
          zIndex: 1000,
          backgroundColor: "var(--mantine-color-body)",
          borderTop: "1px solid var(--inspector-border-default)",
          flexShrink: 0,
        },
      };
    }
    return { root: {} };
  },
});
