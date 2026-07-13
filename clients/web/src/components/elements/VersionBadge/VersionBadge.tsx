import { Text } from "@mantine/core";

export interface VersionBadgeProps {
  /** The Inspector version to show, e.g. `"2.0.0"`. Renders nothing when absent. */
  version?: string;
}

// The `versionBadge` variant (src/theme/Text.ts) styles it as a small grey
// single-line label; the footer row positions it at the left (#1682).
const VersionText = Text.withProps({ variant: "versionBadge" });

/**
 * A small, unobtrusive build-version label shown at the left of the footer row
 * (#1682, superseding the fixed lower-left badge of #1639). Sourced from the
 * root `package.json` via the backend's `GET /api/config`; renders nothing until
 * the version is known (or on a legacy backend that omits it).
 */
export function VersionBadge({ version }: VersionBadgeProps) {
  if (!version) return null;
  return (
    <VersionText aria-label={`Inspector version ${version}`}>
      v{version}
    </VersionText>
  );
}
