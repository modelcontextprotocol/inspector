import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ServerEntry } from "@inspector/core/mcp/types.js";

/**
 * Holds the optimistic `paginatedLists` value **per server**, so the sidebar
 * toggle keeps showing what the last write put on disk even after the user
 * switches to another server and back (#2095).
 *
 * The displayed value normally comes from the active `servers` entry, and that
 * list only advances when a `GET /api/servers` succeeds. Once a list read has
 * failed, every entry keeps describing disk *as of the last successful read*,
 * while the writes made since have changed it — the same staleness
 * `useLastPersistedSettings` exists to survive on the write side (#2089). The
 * optimistic override papers over it for the display, so it has to outlive the
 * things that are not evidence of a fresher read. Switching servers is one of
 * them: the previous single app-wide slot was cleared whenever the *active*
 * entry changed, so an A → B → A round trip dropped A's override and the
 * toggle fell back to the stale entry — reading `off` while disk, the tracker,
 * and the live client all said `on`, with the lists rendered in all-pages mode
 * showing an aggregate the client never fetched and no Load-next-page control
 * to fill them.
 *
 * A record is therefore keyed by server id and paired with that server's
 * `servers` entry as of when it was recorded, and is believed only while the
 * list still carries that same entry object. Identity, not deep equality: the
 * question is whether the list has been re-read since, not whether the values
 * happen to agree — a successful read that reports the value the override
 * replaced (an edit made outside the Inspector overtaking the write) has to
 * supersede it too, and its boolean is unchanged.
 *
 * Records are per server for the reason `useLastPersistedSettings` keeps its
 * own that way: the settings modal can be opened for any server, independently
 * of which one is connected, so a single slot lets a save on B discard the
 * value A is still displaying from.
 *
 * `valueFor` is pure over the list passed in and is meant to be called during
 * render. It deliberately does **not** prune superseded records — that is a
 * write, and this repo's rules put neither a ref mutation nor a state update in
 * a render path. Pruning happens on the next `record` instead, where a stale
 * entry is only ever read as "no override" in the meantime.
 */
export interface PaginatedListsOverride {
  /**
   * Record an optimistic value for `serverId`, pairing it with that server's
   * entry as the list stands **now** — not as it stood when the write that
   * produced this value was issued, which a read landing mid-flight would
   * otherwise make look newer than the write.
   */
  record: (serverId: string, value: boolean) => void;
  /**
   * The override for `serverId`, or `undefined` when there is none or the list
   * has moved on from the entry it was recorded against. Pure over the current
   * list — safe to call during render.
   */
  valueFor: (serverId: string | undefined) => boolean | undefined;
}

interface OverrideRecord {
  value: boolean;
  entry: ServerEntry | undefined;
}

/**
 * @param servers the current server list, as rendered
 */
export function usePaginatedListsOverride(
  servers: ServerEntry[],
): PaginatedListsOverride {
  const [records, setRecords] = useState<Map<string, OverrideRecord>>(
    () => new Map(),
  );
  // Read the list through a ref so a record pairs with the entry as it stands
  // when it is written, rather than the one captured when the enclosing
  // handler was created — a settled or rejected write records from a
  // continuation that may be several list reads old. Mirrored in an effect
  // rather than assigned during render: writing a ref mid-render is an error
  // under `react-hooks/refs`, and `record` only ever runs from an event
  // handler or a settled promise, long after the commit.
  const serversRef = useRef(servers);
  useEffect(() => {
    serversRef.current = servers;
  }, [servers]);

  const record = useCallback((serverId: string, value: boolean) => {
    // Read outside the updater. A functional updater must be pure — React may
    // defer or replay it — and this one would otherwise resolve the ref at
    // whatever moment it happened to run. A list read committing in between
    // would then be paired with the record as its baseline, so the very read
    // that should have superseded the override would instead certify it.
    const list = serversRef.current;
    setRecords((previous) => {
      const next = new Map<string, OverrideRecord>();
      // Carry forward only the records the list has not moved past, so a
      // session that toggles across many servers does not accumulate a record
      // (and a reference to a long-dead entry object) for each one.
      for (const [id, held] of previous) {
        if (id !== serverId && held.entry === list.find((s) => s.id === id)) {
          next.set(id, held);
        }
      }
      next.set(serverId, { value, entry: list.find((s) => s.id === serverId) });
      return next;
    });
  }, []);

  const valueFor = useMemo(
    () =>
      (serverId: string | undefined): boolean | undefined => {
        if (serverId === undefined) return undefined;
        const held = records.get(serverId);
        if (!held) return undefined;
        return held.entry === servers.find((s) => s.id === serverId)
          ? held.value
          : undefined;
      },
    [records, servers],
  );

  return useMemo(() => ({ record, valueFor }), [record, valueFor]);
}
