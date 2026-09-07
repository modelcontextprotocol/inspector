import { useLocalStorage } from "@mantine/hooks";

/**
 * Whether the tool detail panel's schema-portability section is expanded
 * (#2205).
 *
 * The preference is **global rather than per tool**, and that is the whole
 * point of the issue: the findings sit above the argument form, so on a server
 * whose schemas are broadly unportable every tool selection put a wall of
 * identical text between the user and the first input — 26 findings across
 * four tools in `unportable-schemas-many-http.json`, none of which the caller
 * needs in order to fill the form. A per-tool disclosure would have to be
 * re-collapsed on every selection, which is the same scrolling by another
 * route.
 *
 * Collapsed is the default. Nothing is lost by it: the summary line still
 * names the counts, the tool list still carries its per-tool severity icon,
 * and one click re-opens the detail — for the whole session and every later
 * one, since the choice persists.
 */
const SCHEMA_FINDINGS_EXPANDED_DEFAULT = false;

/** localStorage key. Shares the `inspector.<kind>.<scope>` namespace the other
 * UI preferences use, so the whole group is easy to inspect or clear in bulk. */
export const SCHEMA_FINDINGS_EXPANDED_KEY = "inspector.schemaFindings.expanded";

/**
 * Stores the boolean as `"true"` / `"false"` rather than Mantine's default
 * `JSON.stringify`, matching the sort/compact adapters in `InspectorView`:
 * the persisted value stays human-readable, and anything else — a manual edit,
 * a value written by an older build — clamps back to the default instead of
 * silently coercing to `false`.
 */
function deserialize(raw: string | undefined): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return SCHEMA_FINDINGS_EXPANDED_DEFAULT;
}

function serialize(value: boolean): string {
  return value ? "true" : "false";
}

export function useSchemaFindingsExpanded() {
  return useLocalStorage<boolean>({
    key: SCHEMA_FINDINGS_EXPANDED_KEY,
    defaultValue: SCHEMA_FINDINGS_EXPANDED_DEFAULT,
    deserialize,
    serialize,
    // Read synchronously on first render — SPA only, no SSR — so a persisted
    // "expanded" does not flash through the collapsed default.
    getInitialValueInEffect: false,
  });
}
