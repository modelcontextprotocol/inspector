import { useCallback, useEffect, useRef } from "react";
import type {
  InspectorServerSettings,
  ServerEntry,
} from "@inspector/core/mcp/types.js";

/**
 * Remembers, per server, the last settings write known to have reached disk, so
 * a *later* failed write can be rolled back to what is actually persisted
 * rather than to a `servers` entry that has gone stale (#2089).
 *
 * The `servers` list only advances when a `GET /api/servers` succeeds. Once a
 * list read fails, every entry in it keeps describing disk *as of the last
 * successful read* — while writes issued since then have changed disk. A
 * rollback that reads its baseline from such an entry reverts to a value
 * nothing on disk holds, and the UI contradicts the file until the next
 * successful read. The reproduction is two toggles: the first write lands but
 * its list reload fails, the second write fails outright and reverts to the
 * pre-first-toggle value.
 *
 * Records are kept **per server id**, not in a single slot. The settings modal
 * can be opened for any server, independently of which one is connected, so a
 * single slot would let a save on B discard the baseline a later failed write
 * on A still needs — reproducing the very bug this hook exists to prevent.
 *
 * ## Which of two overlapping writes wins
 *
 * A write is announced with `begin` when it is *issued* and confirmed with
 * `landed` when it completes, and a confirmation is ignored if a later-issued
 * write for that server has already confirmed. Completion order cannot be used
 * for this: `updateServerSettings` waits for a list read after its PUT, so an
 * older write with a slow read can finish last and would otherwise overwrite
 * the record with a value that is no longer on disk.
 *
 * Issue order is a proxy for disk order, not a proof of it — HTTP does not
 * promise that two in-flight PUTs arrive in the order they were sent. It is the
 * best signal available on this side: the backend serializes writes to the
 * catalog, but neither the route nor `useServers` returns a revision the client
 * could order by. If one is added later, this is where it replaces the counter.
 *
 * ## When a record stops being believed
 *
 * A record is paired with the `servers` entry for that server **as of when the
 * write completed**, and is dropped once the list carries a different entry
 * object: a successful read rebuilds the list, so a fresh object is the signal
 * that the entry has caught up with — or been overtaken by (an edit made
 * outside the Inspector) — our write, and from there the entry is authoritative
 * again. The pairing is taken at completion rather than at issue because a read
 * that lands *while the write is in flight* would otherwise be mistaken for one
 * that happened after it.
 *
 * One case the client cannot decide is left: a background read whose response
 * was generated before the write landed but which arrives after it still looks
 * newer here, and the record is dropped in its favour. That needs the same
 * missing revision as above. What the fallback yields in that case is the
 * freshest successful read — the same value the rest of the UI renders from —
 * rather than an arbitrary one.
 *
 * The list and the records are held in refs rather than state deliberately:
 * nothing renders from either, they are read only inside callbacks at the
 * moment a write is issued, completes, or fails, and holding them in state
 * would re-render the whole composition root on every settings save.
 */
export interface LastPersistedSettings {
  /**
   * Announce a settings write for `serverId` at the moment it is **issued**.
   * Confirm it with the returned handle once it completes.
   */
  begin: (serverId: string) => SettingsWrite;
  /**
   * The best available answer to "what is on disk for this server", **as of the
   * moment it is called**. Returns the recorded write while the list still
   * carries the entry that write was paired with, otherwise that server's
   * current entry settings, and `undefined` when the list has no such entry (or
   * one carrying no settings) and no write has landed for it this session.
   *
   * Both the record and the list are read live, so calling this in a failure
   * handler answers for the state at failure time. Do not hoist the result into
   * a variable at the point the write is issued and reuse it on rejection: an
   * overlapping write that landed in between would make it stale, which is the
   * same class of bug as reading the baseline from a stale `servers` entry.
   */
  resolve: (serverId: string) => InspectorServerSettings | undefined;
  /**
   * Whether the most recently **issued** write that has reported for this
   * server ended in failure — i.e. whatever the user last tried to save is not
   * what disk holds. A caller holding an edit buffer for that server (the
   * settings modal's draft) uses it to know its buffer is unpersisted, and to
   * apply `resolve` instead of the buffer.
   *
   * Ordered by issue, not by arrival, for the same reason the record is: a
   * straggling failure from an older write does not overwrite the outcome of a
   * newer one, and outcomes are kept per server so a failure on B says nothing
   * about A.
   */
  lastWriteFailed: (serverId: string) => boolean;
}

export interface SettingsWrite {
  /**
   * Record that this write reached disk. A no-op if a write issued after this
   * one has already been confirmed for the same server.
   *
   * Returns whether this write is now the **settled** state for that server —
   * recorded, with no later write still in flight to describe disk after it.
   * Callers that own UI derived from the setting use it to re-apply the value:
   * an overlapping write that failed *first* will have rolled that UI back to a
   * baseline this write has since replaced, and if the list read behind this
   * one failed too, nothing else would ever correct it.
   */
  landed: (written: InspectorServerSettings) => boolean;
  /**
   * Report that this write is over without reaching disk, so it stops counting
   * as in flight. An earlier write that lands afterwards is then the settled
   * state — which is exactly the order that leaves the UI on a rolled-back
   * value nothing on disk holds.
   */
  failed: () => void;
}

interface WriteRecord {
  written: InspectorServerSettings;
  entry: ServerEntry | undefined;
}

/**
 * @param servers the current server list, as rendered
 */
export function useLastPersistedSettings(
  servers: ServerEntry[],
): LastPersistedSettings {
  const recordsRef = useRef<Map<string, WriteRecord>>(new Map());
  const nextSequenceRef = useRef(0);
  // Highest issue order confirmed per server. Kept apart from the records so a
  // record dropped by `resolve` can't be resurrected by a straggler that was
  // issued earlier: the high-water mark outlives the record it produced.
  const confirmedRef = useRef<Map<string, number>>(new Map());
  // Issue orders still in flight per server, so a write that lands can tell
  // whether it is the last word or whether something later will still report.
  // A write leaves this set through `landed` or `failed` alike.
  const pendingRef = useRef<Map<string, Set<number>>>(new Map());
  // Outcome of the latest-issued write that has reported, per server. Kept
  // apart from the record because a *failed* write leaves no record but is
  // still the answer to "is the user's last attempt on disk?".
  const outcomesRef = useRef<Map<string, { sequence: number; ok: boolean }>>(
    new Map(),
  );
  // `landed` reads the list through a ref so a write pairs with the entry as
  // it stands when it *finishes*, not the one captured when it was issued.
  // Mirrored in an effect rather than assigned during render: writing a ref
  // mid-render is an error under `react-hooks/refs`, and this reader runs from
  // a settled promise, long after the commit. `resolve` deliberately does not
  // use it — see there.
  const serversRef = useRef(servers);
  useEffect(() => {
    serversRef.current = servers;
  }, [servers]);

  // Drop records the list has moved past. This used to happen lazily inside
  // `resolve`, which is no longer allowed: `useSettingsDraft` seeds its draft
  // during render (#2192) and so calls `resolve` there, where a ref mutation
  // would run an unpredictable number of times — React may replay a render
  // under StrictMode or abandon it altogether. Nothing depends on the eviction
  // happening at any particular moment; it only keeps a dead record from being
  // re-checked on every later write for that server, so an effect is the right
  // home for it.
  useEffect(() => {
    for (const [serverId, record] of recordsRef.current) {
      if (record.entry !== servers.find((s) => s.id === serverId)) {
        recordsRef.current.delete(serverId);
      }
    }
  }, [servers]);

  const begin = useCallback((serverId: string): SettingsWrite => {
    const sequence = ++nextSequenceRef.current;
    const pending = pendingRef.current.get(serverId) ?? new Set<number>();
    pending.add(sequence);
    pendingRef.current.set(serverId, pending);
    const settle = (ok: boolean) => {
      pending.delete(sequence);
      // Keep the outcome of the latest-issued write that has reported, so an
      // older straggler cannot overwrite a newer one's verdict.
      const previous = outcomesRef.current.get(serverId);
      if (!previous || previous.sequence <= sequence) {
        outcomesRef.current.set(serverId, { sequence, ok });
      }
    };
    return {
      landed: (written: InspectorServerSettings) => {
        settle(true);
        const confirmed = confirmedRef.current.get(serverId) ?? 0;
        // A write issued after this one already reported; it describes disk
        // more recently, whichever of the two happened to finish first.
        if (confirmed > sequence) return false;
        confirmedRef.current.set(serverId, sequence);
        const entry = serversRef.current.find((s) => s.id === serverId);
        recordsRef.current.set(serverId, { written, entry });
        // Settled only while nothing later is still in flight — such a write
        // will describe disk once it reports, so re-applying this value in the
        // meantime would fight it.
        for (const other of pending) if (other > sequence) return false;
        return true;
      },
      failed: () => settle(false),
    };
  }, []);

  const lastWriteFailed = useCallback(
    (serverId: string) => outcomesRef.current.get(serverId)?.ok === false,
    [],
  );

  // Pure, and over `servers` rather than `serversRef`. Both properties are
  // required because `useSettingsDraft` calls this during render to seed its
  // draft (#2192): a render must not mutate shared state, and the ref trails
  // the value it mirrors by one passive-effect flush, so reading it here would
  // answer from the previous commit's list on exactly the render where a
  // refreshed list arrives. Reading `servers` also makes the supersession test
  // fire a render earlier, which is the direction that matters — a list that
  // has genuinely been re-read is what the record is being checked against.
  const resolve = useCallback(
    (serverId: string): InspectorServerSettings | undefined => {
      const entry = servers.find((s) => s.id === serverId);
      const current = recordsRef.current.get(serverId);
      if (!current) return entry?.settings;
      // Identity, not deep equality: the question is whether the list has been
      // re-read since the write, not whether the values happen to match.
      if (current.entry !== entry) return entry?.settings;
      return current.written;
    },
    [servers],
  );

  return { begin, resolve, lastWriteFailed };
}
