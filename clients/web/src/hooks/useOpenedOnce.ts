import { useState } from "react";
import { useValueChange } from "./useValueChange";

/**
 * `true` from the first render on which `open` is `true`, for the rest of the
 * component's life (#2928).
 *
 * Mantine's `Collapse` keeps its children in the React tree while collapsed, so
 * a Protocol or Network row mounted its whole expanded body — two read-only Ace
 * editors for a Protocol entry — the moment it appeared, even though the list
 * starts compact and most rows are never opened. Under a burst of traffic that
 * mount cost, paid per new row, was a large share of what kept the page's main
 * thread busy. Gate the body on this instead: it mounts on the first expand and
 * then *stays* mounted, so collapsing still animates the content closed rather
 * than snapping an empty box shut, and re-expanding keeps the body's state
 * (an Ace editor's folds and scroll).
 */
export function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  useValueChange(open, (next) => {
    if (next) setOpened(true);
  });
  return opened;
}
