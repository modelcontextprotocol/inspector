import type { Decorator } from "@storybook/react-vite";

// The monitoring sidebar's narrowest width: the divider clamps it to 320px
// (`inspector.monitor.width`, 320–720). A story that must not clip is held to
// the strictest case rather than the 420px default.
export const NARROWEST_SIDEBAR_WIDTH_PX = 320;

// A fixed-height flex host, like the sidebar column, so an `embedded` panel
// fills it and its list scrolls instead of growing the story.
const SIDEBAR_HEIGHT_PX = 600;

/**
 * Hosts a story inside a box the shape of the monitoring sidebar at its
 * narrowest, for the stories asserting that nothing in a sidebar entry clips
 * (#2675). A raw `div` with inline style is deliberate: this is test harness,
 * not app UI, and it stands in for the sidebar's own sized column.
 */
export const narrowSidebarDecorator: Decorator = (Story) => (
  <div
    style={{
      width: NARROWEST_SIDEBAR_WIDTH_PX,
      height: SIDEBAR_HEIGHT_PX,
      display: "flex",
    }}
  >
    <Story />
  </div>
);
