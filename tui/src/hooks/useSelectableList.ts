import { useState, useEffect, useCallback } from "react";

function clampFirstVisible(
  first: number,
  selected: number,
  visibleCount: number,
  total: number,
): number {
  if (selected < first) return selected;
  if (selected >= first + visibleCount) return selected - visibleCount + 1;
  return first;
}

export interface UseSelectableListOptions {
  /** When these change, reset selection to 0 (e.g. [tools] when switching servers) */
  resetWhen?: unknown[];
}

/**
 * Manages selection and scroll position for a virtualized list.
 * Returns selection state and a setSelection that updates both
 * selectedIndex and firstVisible so the selected item stays in view.
 */
export function useSelectableList(
  itemCount: number,
  visibleCount: number,
  options?: UseSelectableListOptions,
) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [firstVisible, setFirstVisible] = useState(0);

  const setSelection = useCallback(
    (newIndex: number) => {
      setSelectedIndex(newIndex);
      setFirstVisible((prev) =>
        clampFirstVisible(prev, newIndex, visibleCount, itemCount),
      );
    },
    [visibleCount, itemCount],
  );

  // Reset when deps change (e.g. different server)
  useEffect(() => {
    if (options?.resetWhen) {
      setSelectedIndex(0);
      setFirstVisible(0);
    }
  }, options?.resetWhen ?? []);

  // Clamp when list shrinks
  useEffect(() => {
    if (itemCount > 0 && selectedIndex >= itemCount) {
      const newIndex = itemCount - 1;
      setSelectedIndex(newIndex);
      setFirstVisible((prev) =>
        clampFirstVisible(prev, newIndex, visibleCount, itemCount),
      );
    }
  }, [itemCount, selectedIndex, visibleCount]);

  return { selectedIndex, firstVisible, setSelection };
}
