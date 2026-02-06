import { useCallback, useEffect, useRef, useState } from "react";

type UseResizableOptions = {
  initialSize: number;
  axis: "x" | "y";
  reverse?: boolean;
  minSize?: number;
  maxSize?: number;
};

export function useResizable({
  initialSize,
  axis,
  reverse = false,
  minSize = 0,
  maxSize = Infinity,
}: UseResizableOptions) {
  const [size, setSize] = useState(initialSize);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef<number>(0);
  const dragStartSize = useRef<number>(0);
  const lastSize = useRef<number>(initialSize);

  const toggleCollapse = useCallback(() => {
    if (size > 0) {
      lastSize.current = size;
      setSize(0);
    } else {
      setSize(lastSize.current > 0 ? lastSize.current : initialSize);
    }
  }, [size, initialSize]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true);
      dragStartPos.current = axis === "x" ? e.clientX : e.clientY;
      dragStartSize.current = size;
      document.body.style.userSelect = "none";
    },
    [size, axis],
  );

  const handleDragMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const currentPos = axis === "x" ? e.clientX : e.clientY;
      const delta = reverse
        ? dragStartPos.current - currentPos
        : currentPos - dragStartPos.current;
      setSize(
        Math.max(minSize, Math.min(maxSize, dragStartSize.current + delta)),
      );
    },
    [isDragging, axis, reverse, minSize, maxSize],
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleDragMove);
      window.addEventListener("mouseup", handleDragEnd);
      return () => {
        window.removeEventListener("mousemove", handleDragMove);
        window.removeEventListener("mouseup", handleDragEnd);
      };
    }
  }, [isDragging, handleDragMove, handleDragEnd]);

  return {
    size,
    isDragging,
    handleDragStart,
    toggleCollapse,
  };
}

// Compatibility wrappers to minimize changes in other files
export function useDraggablePane(initialHeight: number) {
  const { size, isDragging, handleDragStart, toggleCollapse } = useResizable({
    initialSize: initialHeight,
    axis: "y",
    reverse: true, // Vertical pane in App.tsx grows as mouse moves UP
    minSize: 0,
    maxSize: 800,
  });
  return { height: size, isDragging, handleDragStart, toggleCollapse };
}

export function useDraggableSidebar(initialWidth: number, reverse = false) {
  const { size, isDragging, handleDragStart, toggleCollapse } = useResizable({
    initialSize: initialWidth,
    axis: "x",
    reverse,
    minSize: 0,
    maxSize: 600,
  });
  return { width: size, isDragging, handleDragStart, toggleCollapse };
}
