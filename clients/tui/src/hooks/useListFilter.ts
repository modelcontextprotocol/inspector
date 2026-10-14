/**
 * A type-to-filter query over one of the TUI's list panes (#2430).
 *
 * The web client's Tools / Resources / Prompts screens carry a search box; the
 * TUI's equivalents had nothing, so a server exposing a few hundred tools could
 * only be read by scrolling. This hook is the one place that behaviour lives,
 * so the four list tabs (`ToolsTab`, `ResourcesTab`, `PromptsTab`,
 * `SkillsTab`) cannot disagree about what `/` does or what a match is.
 *
 * **Keys** — the `/` convention from `less`, `vim` and most TUIs:
 *
 * - `/` on a focused list opens the filter for editing;
 * - printable characters extend the query and backspace trims it, narrowing
 *   the list as you type;
 * - **Enter keeps** the query and leaves editing, so the arrows, Enter and the
 *   app-wide accelerators work on the narrowed list;
 * - **Esc clears** the query and leaves editing. Esc also clears a **kept**
 *   filter while the list has the keyboard (#2647): a user who has just kept
 *   a filter expects Esc to undo it, not to quit, so Esc is the app's exit key
 *   only once no filter is left to clear — the second press.
 *
 * Up/Down are deliberately **not** consumed while editing, so the selection can
 * be moved without leaving the query.
 *
 * ⚠️ **While editing, the app-wide accelerators must stand down**, or typing
 * `connect` into the filter would connect (`c`), switch to the Prompts tab
 * (`p`)… and Esc would quit. Ink delivers every key to every active `useInput`,
 * so the owning tab cannot swallow a key on App's behalf; instead the hook
 * reports its editing state through `onEditingChange` and App skips its own
 * handler while it is `true`. That report is an effect with a cleanup, so it is
 * withdrawn on every way editing can end — the keys above, the pane losing
 * focus or a modal opening (`enabled` going false), or the tab unmounting —
 * and App can never be left deaf to the keyboard.
 *
 * A kept filter mutes App's Esc alone, not the other accelerators — the whole
 * point of keeping it is that they work on the narrowed list. That is a second,
 * narrower report, `onEscapeClaimChange`, withdrawn the same way: once the
 * query is cleared, or the pane loses the keyboard, Esc exits again.
 *
 * A match is a case-insensitive substring of any of the strings `fields`
 * returns for an item. `fields` is called during render, so it must be pure;
 * declare it at module scope so the memoized result is not rebuilt every
 * render.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Key } from "ink";

/** The strings an item is matched against; `undefined` entries are skipped. */
export type ListFilterFields<T> = (
  item: T,
) => ReadonlyArray<string | undefined>;

export interface UseListFilterOptions {
  /**
   * Whether the owning list currently has the keyboard — the pane is focused
   * and no modal is open. `/` is ignored while it is false, and editing that
   * was in progress is suspended (and reported as not editing) until it is
   * true again.
   */
  enabled: boolean;
  /**
   * Told whenever the filter starts or stops capturing keys, so App can mute
   * its global accelerators. Must be referentially stable (a `useState`
   * setter is), since it is an effect dependency.
   */
  onEditingChange?: (editing: boolean) => void;
  /**
   * Told whenever a kept (non-editing, non-empty) filter starts or stops
   * claiming Esc while the list has the keyboard, so App can hold off its exit
   * key until the filter is cleared (#2647). Must be referentially stable,
   * like `onEditingChange`.
   */
  onEscapeClaimChange?: (claimed: boolean) => void;
}

export interface ListFilter<T> {
  /** The current query, as typed. */
  query: string;
  /** Whether keystrokes are currently going into the query. */
  editing: boolean;
  /** Whether the list is narrowed — a non-empty query. */
  active: boolean;
  /** The matching items, in their original order. */
  items: readonly T[];
  /** `indices[i]` is the position of `items[i]` in the unfiltered list. */
  indices: readonly number[];
  /**
   * Feed a keystroke from the owning tab's `useInput`. Returns `true` when the
   * filter consumed it, in which case the tab must not act on it.
   */
  handleInput: (input: string, key: Key) => boolean;
}

/**
 * Strip control characters (and the ESC sequences that carry them) from typed
 * or pasted text, so a stray escape code can never land in the query.
 */
function printable(input: string): string {
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  return input.replace(/[\u0000-\u001f\u007f]/g, "");
}

export function useListFilter<T>(
  items: readonly T[],
  fields: ListFilterFields<T>,
  { enabled, onEditingChange, onEscapeClaimChange }: UseListFilterOptions,
): ListFilter<T> {
  const [query, setQuery] = useState("");
  const [editingRequested, setEditingRequested] = useState(false);
  // Editing is suspended, not cancelled, while the list lacks the keyboard:
  // derived rather than reset in an effect, so nothing renders a stale frame.
  const editing = editingRequested && enabled;

  useEffect(() => {
    if (!editing) return;
    onEditingChange?.(true);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);

  const active = query.trim() !== "";
  // While editing, App is already muted entirely; this covers the kept filter.
  const claimsEscape = enabled && active && !editingRequested;

  useEffect(() => {
    if (!claimsEscape) return;
    onEscapeClaimChange?.(true);
    return () => onEscapeClaimChange?.(false);
  }, [claimsEscape, onEscapeClaimChange]);

  const { filtered, indices } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered: T[] = [];
    const indices: number[] = [];
    items.forEach((item, index) => {
      if (
        needle === "" ||
        fields(item).some((field) => field?.toLowerCase().includes(needle))
      ) {
        filtered.push(item);
        indices.push(index);
      }
    });
    return { filtered, indices };
  }, [items, fields, query]);

  const handleInput = useCallback(
    (input: string, key: Key): boolean => {
      if (!enabled) return false;
      if (!editingRequested) {
        if (input === "/" && !key.ctrl && !key.meta) {
          setEditingRequested(true);
          return true;
        }
        if (key.escape && query.trim() !== "") {
          setQuery("");
          return true;
        }
        return false;
      }
      if (key.escape) {
        setQuery("");
        setEditingRequested(false);
        return true;
      }
      if (key.return) {
        setEditingRequested(false);
        return true;
      }
      if (key.backspace || key.delete) {
        setQuery((prev) => prev.slice(0, -1));
        return true;
      }
      // Navigation stays with the list, so the selection can move mid-query.
      if (key.upArrow || key.downArrow || key.pageUp || key.pageDown) {
        return false;
      }
      if (key.ctrl || key.meta) return true;
      const text = printable(input);
      if (text) setQuery((prev) => prev + text);
      return true;
    },
    [enabled, editingRequested, query],
  );

  return {
    query,
    editing,
    active,
    items: filtered,
    indices,
    handleInput,
  };
}
