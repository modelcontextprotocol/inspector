import { useCallback, useEffect, useRef, useState } from "react";

export function useDraggablePane(initialHeight: number) {
  const [height, setHeight] = useState(initialHeight);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef<number>(0);
  const dragStartHeight = useRef<number>(0);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true);
      dragStartY.current = e.clientY;
      dragStartHeight.current = height;
      document.body.style.userSelect = "none";
    },
    [height],
  );

  const handleDragMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const deltaY = dragStartY.current - e.clientY;
      const newHeight = Math.max(
        100,
        Math.min(800, dragStartHeight.current + deltaY),
      );
      setHeight(newHeight);
    },
    [isDragging],
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    document.body.style.userSelect = "";
  }, []);

  const resetHeight = useCallback(() => {
    setHeight(initialHeight);
  }, [initialHeight]);

  // Sync height with initialHeight changes when not dragging
  useEffect(() => {
    if (!isDragging) {
      setHeight(initialHeight);
    }
  }, [initialHeight, isDragging]);

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
    height,
    isDragging,
    handleDragStart,
    resetHeight,
  };
}
