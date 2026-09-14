import { Paper } from "@mantine/core";

// The re-auth popup. A `Paper` so every static style is a prop; the stacking
// order and the centering offset go through the `reauth` variant in
// `theme/Paper.ts`, since Mantine exposes neither `transform` nor `zIndex` as a
// style prop and flat CSS belongs in the theme layer rather than in inline
// `styles` (#2218).
//
// Floats rather than spanning the top as a sticky full-bleed bar. The bar cost
// the whole view a band of vertical space for what is a notification about one
// server, and it sat directly above the monitoring sidebar that an OAuth
// failure now opens (#2108) — the two things a user needs at once here are this
// affordance and those requests, so it must not push them around. `fixed`, not
// `sticky`, so scrolling the server list leaves it put.
//
// Centered, and deliberately WITHOUT an overlay. Every corner is spoken for —
// the toast stack owns bottom-right (see `main.tsx`), the right edge is the
// monitoring sidebar whose toolbar this would cover, and top-left is the
// Servers header — so anchoring it anywhere hides something. Centering is the
// one placement that reads as addressed to the whole window rather than
// attached to the wrong panel.
//
// The missing overlay is the point, not an omission: this is a notification,
// not a decision that must be made now. An OAuth failure opens the monitoring
// sidebar (#2108), and blocking the page would force a choice between reading
// those requests and keeping the affordance — dismissing is not free, since
// "Authorize again" also clears the stale OAuth state, which a plain reconnect
// does not do. So it floats above the page and leaves it usable.
//
// The width is CAPPED at 420, not fixed at it. Because the banner is centered
// by `left: 50%` plus a -50% translate, a fixed width wider than the viewport
// overflows BOTH edges equally — clipping the close button on one side and
// "Authorize again" on the other, which are the only two controls it has. That
// is reachable on a narrow desktop window, not just a phone, since the element
// is positioned against the viewport rather than a panel. `maw` caps it while
// `w` keeps a 1rem gutter on each side so the shadow and radius still read.
export const ReAuthBannerBar = Paper.withProps({
  variant: "reauth",
  pos: "fixed",
  top: "50%",
  left: "50%",
  w: "calc(100vw - 2rem)",
  maw: 420,
  bg: "var(--mantine-color-body)",
  shadow: "xl",
  radius: "md",
});
