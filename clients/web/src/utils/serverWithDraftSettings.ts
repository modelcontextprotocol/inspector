import type {
  InspectorServerSettings,
  ServerEntry,
} from "@inspector/core/mcp/types.js";

/**
 * A server entry whose `settings` reflect the **unsaved** settings draft.
 *
 * Actions taken from inside the Server Settings modal have to act on what the
 * user is looking at, not on what has been persisted. The entry comes from the
 * `servers` list, which the debounced save has not reached yet, so reading its
 * `settings` means a control toggled a moment ago is still at its previous
 * value. That is invisible for most settings — they are read on the next
 * connect — but not for one consumed by a button in the same dialog:
 * unchecking "Revoke tokens on clear" and immediately clearing would still
 * revoke, and re-checking it would still skip (#2144).
 *
 * `draft` is nullish before the modal has produced one — `useSettingsDraft`
 * types it `| null` and callers may hold `| undefined` — in which case the
 * entry's own settings are already the current answer. Both are accepted so a
 * caller never has to normalize one into the other at the call site, which is
 * exactly where the distinction would get lost.
 *
 * Extracted rather than inlined at the call site so the rule has a test: the
 * hook tests below `clearServerOAuthAndDisconnect` receive whatever they are
 * handed and cannot tell a draft from a persisted entry, and `App.tsx`'s own
 * settings harness connects a stdio server, where the OAuth section never
 * renders at all.
 */
export function serverWithDraftSettings<
  T extends Pick<ServerEntry, "settings">,
>(entry: T, draft: InspectorServerSettings | null | undefined): T {
  return draft == null ? entry : { ...entry, settings: draft };
}
