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
  };
}

export function useDraggableSidebar(initialWidth: number) {
  const [width, setWidth] = useState(initialWidth);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef<number>(0);
  const dragStartWidth = useRef<number>(0);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      setIsDragging(true);
      dragStartX.current = e.clientX;
      dragStartWidth.current = width;
      document.body.style.userSelect = "none";
    },
    [width],
  );

  const handleDragMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const deltaX = e.clientX - dragStartX.current;
      const newWidth = Math.max(
        200,
        Math.min(600, dragStartWidth.current + deltaX),
      );
      setWidth(newWidth);
    },
    [isDragging],
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
    width,
    isDragging,
    handleDragStart,
  };
}
