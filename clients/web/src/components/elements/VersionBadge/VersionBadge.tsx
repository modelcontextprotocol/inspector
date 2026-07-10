import { Text } from "@mantine/core";

export interface VersionBadgeProps {
  /** The Inspector version to show, e.g. `"2.0.0"`. Renders nothing when absent. */
  version?: string;
}

// The `versionBadge` variant (src/theme/Text.ts) pins it to the lower-right
// corner in grey and makes it non-interactive.
const VersionText = Text.withProps({ variant: "versionBadge" });

/**
 * A small, unobtrusive build-version label fixed to the lower-right corner of
 * the screen (#1639). Sourced from the root `package.json` via the backend's
 * `GET /api/config`; renders nothing until the version is known (or on a legacy
 * backend that omits it).
 */
export function VersionBadge({ version }: VersionBadgeProps) {
  if (!version) return null;
  return (
    <VersionText aria-label={`Inspector version ${version}`}>
      v{version}
    </VersionText>
  );
}
