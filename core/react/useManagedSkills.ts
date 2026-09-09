import { useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type {
  ManagedSkillsState,
  SkillsPaginationState,
} from "../mcp/state/managedSkillsState.js";
import type { SkillEntry } from "../mcp/skillsSchemas.js";
import { useListError } from "./useListError.js";
import { useStoreSnapshot } from "./useStoreSnapshot.js";

/**
 * Shared stable empty values for the no-server case. Module scope so the
 * snapshots don't change identity every render — see `useStoreSnapshot`.
 * Read-only by contract: nothing mutates a value this hook returns.
 */
const NO_SKILLS: SkillEntry[] = [];
const NO_SKILLS_PAGINATION: SkillsPaginationState = Object.freeze({
  pageCount: 0,
});

const readSkills = (state: ManagedSkillsState): SkillEntry[] =>
  state.getSkills();
const readPagination = (state: ManagedSkillsState): SkillsPaginationState =>
  state.getPagination();

export interface UseManagedSkillsResult {
  skills: SkillEntry[];
  /** Pages walked on the last completed refresh (a one-page list is 1). */
  pageCount: number;
  /**
   * The last walk's failure, or `null` when it succeeded. Includes the
   * connect-time load, whose failure has no caller to surface it.
   */
  error: Error | null;
  refresh: () => Promise<SkillEntry[]>;
}

/**
 * React hook over `ManagedSkillsState` (SEP-2640): the full skill list, the
 * page count the walk took, the last failure, and a refresh.
 *
 * Read during render via `useStoreSnapshot`, never `useState` + a subscribing
 * effect — that shape re-seeds local state from the store prop, so switching
 * servers would paint one frame of the previous server's skills, and an event
 * dispatched between render and subscribe would be lost outright.
 */
export function useManagedSkills(
  client: InspectorClientProtocol | null,
  managedSkillsState: ManagedSkillsState | null,
): UseManagedSkillsResult {
  const skills = useStoreSnapshot(
    managedSkillsState,
    "skillsChange",
    readSkills,
    NO_SKILLS,
  );
  const { pageCount } = useStoreSnapshot(
    managedSkillsState,
    "paginationChange",
    readPagination,
    NO_SKILLS_PAGINATION,
  );

  const error = useListError(managedSkillsState);

  const refresh = useCallback(async (): Promise<SkillEntry[]> => {
    if (!managedSkillsState || !client) return NO_SKILLS;
    // The store dispatches `skillsChange` as it commits, so the snapshot above
    // updates on its own. No `cacheMode`: `skills/list` is a consumer-owned
    // extension method with no SDK cache-aware verb behind it, so every walk is
    // already a real round trip.
    return managedSkillsState.refresh();
  }, [client, managedSkillsState]);

  return { skills, pageCount, error, refresh };
}
