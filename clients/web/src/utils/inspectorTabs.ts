/**
 * Inspector main-view tab identifiers. Match labels used in ViewHeader /
 * InspectorView (`"Tools"`, `"Resources"`, …).
 */

export const INSPECTOR_SERVERS_TAB = "Servers";

/** Tabs with liftable `*UiState` in App.tsx (Servers has no ui snapshot). */
export const INSPECTOR_TAB_IDS = [
  "Apps",
  "Tools",
  "Prompts",
  "Resources",
  "Tasks",
  "Logs",
  "History",
  "Network",
] as const;

export type InspectorTabId = (typeof INSPECTOR_TAB_IDS)[number];

export function isInspectorTabId(value: string): value is InspectorTabId {
  return (INSPECTOR_TAB_IDS as readonly string[]).includes(value);
}
