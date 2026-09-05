/**
 * ManagedSkillsState: holds the full skill list (SEP-2640), in sync with the
 * server. Loaded on connect, cleared on disconnect, re-walked on refresh.
 *
 * Deliberately NOT a `ManagedListState` subclass, despite the family
 * resemblance. That base is built around two things the Skills extension does
 * not have: a top-level `ServerCapabilities` key to gate on (skills is a
 * *server-declared extension*, read from `capabilities.extensions`), and a
 * per-list `list_changed` notification to debounce and turn into a sidebar
 * indicator (SEP-2640 defines none). Subclassing would mean widening the base's
 * capability gate and inventing a list-changed event nothing dispatches — two
 * changes to shared machinery to serve one caller. The cursor walk below is the
 * only behavior actually shared, and it is nine lines.
 *
 * The walk is done here rather than through an SDK `listAll*` verb for the same
 * reason the request is a plain `client.request`: the SDK has no high-level verb
 * for a consumer-owned extension method, so there is no cache-aware wrapper to
 * delegate to and no `cacheMode` to honor.
 */

import type { InspectorClientProtocol } from "../inspectorClientProtocol.js";
import { SKILLS_LIST_METHOD, type SkillEntry } from "../skillsSchemas.js";
import { LIST_MAX_PAGES, isClientDecodeRejection } from "../listSalvage.js";
import { isTerminalStatus } from "../types.js";
import type { RequestMetadata } from "../types.js";
import { TypedEventTarget } from "../typedEventTarget.js";

export interface SkillsPaginationState {
  /** Pages walked on the last completed refresh (a one-page list is 1). */
  pageCount: number;
}

export interface ManagedSkillsStateEventMap {
  skillsChange: SkillEntry[];
  paginationChange: SkillsPaginationState;
  /** The last walk's failure, or `null` once one succeeds. */
  errorChange: Error | null;
}

/**
 * Thrown when a server hands back a cursor it already handed back, which would
 * otherwise walk forever. Surfaced as the store's error so the panel reports the
 * server bug instead of hanging — the same "report, don't swallow" posture the
 * conformance checks take.
 */
export const REPEATED_CURSOR_MESSAGE =
  "Server repeated a pagination cursor in skills/list; stopped to avoid an infinite walk.";

/**
 * Page cap for the `skills/list` walk. Mirrors `LIST_MAX_PAGES`, the bound the
 * SDK's aggregate verbs and the #1909 salvage re-walks already use, so the two
 * pagination paths in this repo cannot drift to different limits.
 */
export const SKILLS_MAX_PAGES = LIST_MAX_PAGES;

/** The error a walk raises when it hits {@link SKILLS_MAX_PAGES}. */
export const SKILLS_PAGE_LIMIT_MESSAGE = `skills/list exceeded ${SKILLS_MAX_PAGES} pages without the server's pagination converging`;

export class ManagedSkillsState extends TypedEventTarget<ManagedSkillsStateEventMap> {
  private skills: SkillEntry[] = [];
  private pageCount = 0;
  private error: Error | null = null;
  private client: InspectorClientProtocol | null = null;
  private unsubscribe: (() => void) | null = null;
  // Overlap guard, held as the generation whose walk is in flight (or `null`).
  // See `refresh` for why this is not a boolean.
  private runningGeneration: number | null = null;
  // Session counter, advanced by `reset` (disconnect) and by `destroy`. A walk
  // captures it and abandons its writes when it no longer matches.
  private generation = 0;

  constructor(client: InspectorClientProtocol) {
    super();
    this.client = client;
    const onConnect = (): void => {
      // No caller to await the connect-time load, so its rejection is caught
      // here rather than left to become an unhandled rejection. Not a swallow:
      // `refresh` has already recorded the failure via `setError`, and the
      // panel renders it.
      void this.refresh().catch(() => {});
    };
    const onStatusChange = (): void => {
      if (isTerminalStatus(this.client?.getStatus())) {
        this.reset();
      }
    };
    this.client.addEventListener("connect", onConnect);
    this.client.addEventListener("statusChange", onStatusChange);
    this.unsubscribe = () => {
      if (this.client) {
        this.client.removeEventListener("connect", onConnect);
        this.client.removeEventListener("statusChange", onStatusChange);
      }
      this.client = null;
    };
  }

  /** Defensive copy of the current list. */
  getSkills(): SkillEntry[] {
    return [...this.skills];
  }

  getPagination(): SkillsPaginationState {
    return { pageCount: this.pageCount };
  }

  /** The last walk's failure, or `null` when it succeeded. */
  getError(): Error | null {
    return this.error;
  }

  // Compared by identity rather than message: two distinct failures with the
  // same text are still two events, and a re-render on a repeat failure is
  // cheap next to silently coalescing them.
  private setError(value: Error | null): void {
    if (this.error === value) return;
    this.error = value;
    this.dispatchTypedEvent("errorChange", value);
  }

  private reset(): void {
    // Advance the session first, so an in-flight walk's continuation sees a
    // stale generation and leaves the cleared state alone.
    this.generation += 1;
    this.skills = [];
    this.pageCount = 0;
    this.dispatchTypedEvent("skillsChange", this.getSkills());
    this.dispatchTypedEvent("paginationChange", this.getPagination());
    // A disconnect ends the session the error belonged to — a stale
    // "couldn't load skills" must not outlive it into the next connect.
    this.setError(null);
  }

  /**
   * Walk every page of `skills/list` and commit the result.
   *
   * A failure is recorded as observable state (`getError`) AND re-thrown: the
   * state drives the panel's error rendering, while the rejection is what a
   * caller's auth-recovery wrapper keys off to detect a 401 and start a
   * re-authorization. The connect-time load, which has no such caller, catches
   * it above.
   */
  async refresh(metadata?: RequestMetadata): Promise<SkillEntry[]> {
    const client = this.client;
    if (!client || client.getStatus() !== "connected") return this.getSkills();
    // A server that never declared the extension answers `skills/list` with
    // -32601, which would spam the console for a question we already know the
    // answer to. An empty list is the right semantics.
    if (!client.getSkillsExtension()) {
      this.applyPages([], 0);
      return this.getSkills();
    }
    // The session this walk belongs to. A disconnect, a `destroy()`, or a
    // reconnect on the same client advances it, and every write below is
    // gated on it still being current — otherwise a slow walk's continuation
    // repopulates a store that has already been cleared, or delivers the
    // previous session's skills into the next one.
    const generation = this.generation;
    const isCurrent = () => this.generation === generation;
    // The overlap guard is per SESSION, not a bare boolean. A boolean would
    // stay set while a walk from a dead session was still awaiting the server,
    // so the reconnect's own load would return here as a no-op and never be
    // retried — permanently, if that stale request never settles. Keying it on
    // the generation lets a new session start immediately, and the `finally`
    // below only clears the guard it actually set.
    if (this.runningGeneration === generation) return this.getSkills();
    this.runningGeneration = generation;
    try {
      const collected: SkillEntry[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      let pages = 0;
      for (;;) {
        const page = await client.listSkills(cursor, metadata);
        if (!isCurrent()) return this.getSkills();
        collected.push(...page.skills);
        pages += 1;
        if (page.nextCursor === undefined) break;
        // Two distinct runaway shapes, and the repeated-cursor guard only
        // catches one: a server stuck on a single cursor. A server that hands
        // back an endlessly *unique* cursor walks forever and grows
        // `collected` without bound, so the page cap is what stops it. The cap
        // raises rather than truncating, for the reason `listPaginationExceeded`
        // states: returning what we have would present a partial list as a
        // complete one.
        if (pages >= SKILLS_MAX_PAGES) {
          throw new Error(SKILLS_PAGE_LIMIT_MESSAGE);
        }
        if (seen.has(page.nextCursor)) {
          throw new Error(REPEATED_CURSOR_MESSAGE);
        }
        seen.add(page.nextCursor);
        cursor = page.nextCursor;
      }
      this.setError(null);
      this.applyPages(collected, pages);
      return this.getSkills();
    } catch (err) {
      // Still re-thrown even when the session moved on — the caller's
      // auth-recovery wrapper keys off the rejection — but the *state* is left
      // alone, so a dead session's failure cannot surface in the live one.
      if (isCurrent()) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.setError(error);
        // Attribute the failure to the response it came from, so the Protocol
        // entry stops rendering a rejected result as a clean success (#1953).
        // Must happen in this catch, while the correlation window the client
        // documents is still valid — and ONLY for a decode rejection, which is
        // what `isClientDecodeRejection` separates from a request that never
        // produced a response at all. Same handling every managed list gets.
        if (isClientDecodeRejection(err)) {
          client.markResponseRejected?.(SKILLS_LIST_METHOD, error.message);
        }
      }
      throw err;
    } finally {
      // Only the walk that set the guard may clear it: a stale session's
      // `finally` must not release the guard a live session is holding.
      if (this.runningGeneration === generation) {
        this.runningGeneration = null;
      }
    }
  }

  private applyPages(skills: SkillEntry[], pageCount: number): void {
    this.skills = skills;
    this.pageCount = pageCount;
    this.dispatchTypedEvent("skillsChange", this.getSkills());
    this.dispatchTypedEvent("paginationChange", this.getPagination());
  }

  /** Unsubscribe from the client and drop the list; idempotent. */
  destroy(): void {
    this.generation += 1;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.skills = [];
    this.pageCount = 0;
    this.error = null;
  }
}
