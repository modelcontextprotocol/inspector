/**
 * The one-row filter line under a list pane's heading (#2430) — the visible half
 * of `useListFilter`, shared by the Tools, Resources, Prompts and Skills panes
 * so all four read the same way.
 *
 * The row is **always reserved**, even when it is blank, so opening or clearing
 * a filter never changes how many list rows fit: a list that grew and shrank
 * by one row as the user pressed `/` would shift the selection's on-screen
 * position under the cursor. `LIST_FILTER_ROWS` is that reservation, which each
 * pane subtracts from its visible-row budget.
 *
 * What it shows, in priority order:
 *
 * - **editing** — the query with a cursor block, and the two ways out;
 * - **a kept filter** — the query, and how to change it;
 * - **the list is focused** — a dim `/ to filter`, so the feature is
 *   discoverable from the pane itself rather than only from documentation;
 * - otherwise nothing.
 */
import React from "react";
import { Box, Text } from "ink";

/** Rows the filter line occupies; subtract from a pane's visible-row count. */
export const LIST_FILTER_ROWS = 1;

interface ListFilterBarProps {
  query: string;
  editing: boolean;
  /** Whether the owning list has the keyboard, which is when the hint shows. */
  focused: boolean;
}

export function ListFilterBar({ query, editing, focused }: ListFilterBarProps) {
  return (
    <Box height={LIST_FILTER_ROWS} flexShrink={0} overflow="hidden">
      {editing ? (
        <Text wrap="truncate-end">
          <Text color="cyan">/</Text>
          {query}
          <Text inverse> </Text>
          <Text dimColor> Enter keep · Esc clear</Text>
        </Text>
      ) : query.trim() !== "" ? (
        <Text wrap="truncate-end">
          <Text color="cyan">/</Text>
          {query}
          <Text dimColor> (/ to edit)</Text>
        </Text>
      ) : focused ? (
        <Text dimColor>/ to filter</Text>
      ) : (
        <Text> </Text>
      )}
    </Box>
  );
}

/**
 * The heading count: the total alone, or `matches/total` while a filter
 * narrows the list, so the user can always see how much is hidden.
 */
export function filterCount(
  active: boolean,
  shown: number,
  total: number,
): string {
  return active ? `${shown}/${total}` : String(total);
}
