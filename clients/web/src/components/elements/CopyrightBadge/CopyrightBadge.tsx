import { Text } from "@mantine/core";

/** The project's copyright notice. */
export const COPYRIGHT_NOTICE =
  "Copyright © Model Context Protocol a Series of LF Projects, LLC.";

// The `copyrightBadge` variant (src/theme/Text.ts) styles it as a small grey
// single-line label; the footer row positions it at the right (#1682).
const CopyrightText = Text.withProps({ variant: "copyrightBadge" });

/**
 * The project copyright notice, shown at the right of the footer row (#1682,
 * superseding the fixed lower-right badge of #1639) — the grey twin of the
 * left-aligned version badge, sharing the footer.
 */
export function CopyrightBadge() {
  return <CopyrightText>{COPYRIGHT_NOTICE}</CopyrightText>;
}
