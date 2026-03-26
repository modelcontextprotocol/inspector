import { useCallback, useRef } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

/**
 * Custom hook to handle imperative panel toggling (collapse/expand).
 * Returns a ref to be passed to the ResizablePanel and a toggle function
 * to be passed to the ResizableHandle's onDoubleClick.
 */
export function usePanelToggle(defaultSize: number | string | undefined) {
  const panelRef = useRef<PanelImperativeHandle>(null);

  const toggle = useCallback(() => {
    const panel = panelRef.current;
    if (panel) {
      const size = panel.getSize();
      const isLibraryCollapsed = panel.isCollapsed();
      const isVisuallyClosed = size.asPercentage < 5;

      if (isLibraryCollapsed || isVisuallyClosed) {
        panel.expand(); // Attempt to restore last expanded size

        // Immediately check size after expand. If still too small, force resize to defaultSize.
        const expandedSize = panel.getSize();
        if (expandedSize.asPercentage < 5) {
          const parsedDefaultSize =
            typeof defaultSize === "string"
              ? parseFloat(defaultSize)
              : defaultSize;
          // Fallback to 25% if defaultSize is undefined or invalid
          panel.resize(
            parsedDefaultSize && !isNaN(parsedDefaultSize)
              ? parsedDefaultSize
              : 25,
          );
        }
      } else {
        panel.collapse();
      }
    } else {
      console.warn("[usePanelToggle] panelRef.current is null");
    }
  }, [defaultSize]);

  return { panelRef, toggle };
}
