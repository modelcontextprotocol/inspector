import { Badge } from "@mantine/core";
import type { FetchRequestCategory } from "@inspector/core/mcp/types.js";

export interface CategoryBadgeProps {
  /**
   * Network request category: `transport` (MCP protocol traffic, blue) or
   * `auth` (OAuth discovery/token requests, violet).
   */
  category: FetchRequestCategory;
}

const BG: Record<FetchRequestCategory, string> = {
  transport: "var(--inspector-badge-transport-bg)",
  auth: "var(--inspector-badge-auth-bg)",
};

const FG: Record<FetchRequestCategory, string> = {
  transport: "var(--inspector-badge-transport-fg)",
  auth: "var(--inspector-badge-auth-fg)",
};

/**
 * Badge tagging a Network entry's request category — `transport` (blue) or
 * `auth` (violet). Surfaces come from `--inspector-badge-*` tokens: a tinted
 * fill in light mode, a deep saturated fill with light text in dark mode
 * (matching the Protocol direction badges). Used by `NetworkEntry`.
 */
export function CategoryBadge({ category }: CategoryBadgeProps) {
  return (
    <Badge autoContrast={false} bg={BG[category]} c={FG[category]}>
      {category}
    </Badge>
  );
}
