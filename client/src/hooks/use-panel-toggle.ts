import { useCallback, useRef } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

/**
 * Custom hook to handle imperative panel toggling (collapse/expand).
 * Returns a ref to be passed to the ResizablePanel and a toggle function
 * to be passed to the ResizableHandle's onDoubleClick.
 */
export function usePanelToggle() {
  const panelRef = useRef<PanelImperativeHandle>(null);

  const toggle = useCallback(() => {
    const panel = panelRef.current;
    if (panel) {
      const isActuallyCollapsed =
        panel.isCollapsed() || panel.getSize().asPercentage < 5;
      if (isActuallyCollapsed) {
        panel.expand();
      } else {
        panel.collapse();
      }
    }
  }, []);

  return { panelRef, toggle };
}
