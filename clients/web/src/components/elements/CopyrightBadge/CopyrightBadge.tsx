import { Text } from "@mantine/core";

/** The project's copyright notice. */
export const COPYRIGHT_NOTICE =
  "Copyright © Model Context Protocol a Series of LF Projects, LLC.";

// The `copyrightBadge` variant (src/theme/Text.ts) pins it to the lower-right
// corner in grey, on the same row as the version badge, and non-interactive.
const CopyrightText = Text.withProps({ variant: "copyrightBadge" });

/**
 * The project copyright notice, fixed to the lower-right corner of the screen
 * (#1639) — the grey, non-interactive twin of the lower-left version badge,
 * sharing its row.
 */
export function CopyrightBadge() {
  return <CopyrightText>{COPYRIGHT_NOTICE}</CopyrightText>;
}
