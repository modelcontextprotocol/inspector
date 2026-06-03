import type { FetchRequestCategory } from "@inspector/core/mcp/types.js";

// Default visible-category filter: every category on. Shared by NetworkScreen
// (its fallback when the parent hasn't set `visibleCategories`) and App, which
// seeds and resets the lifted filter state from it (#1417). Lives in its own
// module so the screen file only exports a component (react-refresh constraint).
export const ALL_CATEGORIES_VISIBLE: Record<FetchRequestCategory, boolean> = {
  auth: true,
  transport: true,
};

export const NO_CATEGORIES_VISIBLE: Record<FetchRequestCategory, boolean> = {
  auth: false,
  transport: false,
};
