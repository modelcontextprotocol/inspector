import { useCallback, useEffect, useRef, useState } from "react";

type UseResizableOptions = {
  initialSize: number;
  axis: "x" | "y";
  reverse?: boolean;
  minSize?: number;
  maxSize?: number;
  unit?: "px" | "%";
};

export function useResizable({
  initialSize,
  axis,
  reverse = false,
  minSize = 0,
  maxSize = Infinity,
  unit = "px",
}: UseResizableOptions) {
  const [size, setSize] = useState(initialSize);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef<number>(0);
  const dragStartSize = useRef<number>(0);
  const lastSize = useRef<number>(initialSize);

  const toggleCollapse = useCallback(() => {
    if (size > minSize) {
      lastSize.current = size;
      setSize(minSize);
    } else {
      setSize(lastSize.current > minSize ? lastSize.current : initialSize);
    }
  }, [size, minSize, initialSize]);

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
      const deltaPixels = reverse
        ? dragStartPos.current - currentPos
        : currentPos - dragStartPos.current;

      let delta = deltaPixels;
      if (unit === "%") {
        const totalDim = axis === "x" ? window.innerWidth : window.innerHeight;
        delta = (deltaPixels / totalDim) * 100;
      }

      setSize(
        Math.max(minSize, Math.min(maxSize, dragStartSize.current + delta)),
      );
    },
    [isDragging, axis, reverse, minSize, maxSize, unit],
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

  // Handle window resize to keep size within bounds.
  // For percentage units, it's mostly stable, but for pixels we might need clamping.
  useEffect(() => {
    const handleResize = () => {
      const totalDim = axis === "x" ? window.innerWidth : window.innerHeight;
      const maxAllowed = unit === "%" ? 90 : totalDim * 0.9;
      setSize((prev) => Math.min(prev, maxAllowed));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [axis, unit]);

  return {
    size,
    isDragging,
    handleDragStart,
    toggleCollapse,
  };
}

// Compatibility wrappers to minimize changes in other files
export function useDraggablePane(
  initialHeight: number,
  unit: "px" | "%" = "px",
) {
  const { size, isDragging, handleDragStart, toggleCollapse } = useResizable({
    initialSize: initialHeight,
    axis: "y",
    reverse: true,
    minSize: 0,
    maxSize: unit === "%" ? 80 : 800,
    unit,
  });
  return { height: size, isDragging, handleDragStart, toggleCollapse };
}

export function useDraggableSidebar(
  initialWidth: number,
  reverse = false,
  unit: "px" | "%" = "px",
) {
  const { size, isDragging, handleDragStart, toggleCollapse } = useResizable({
    initialSize: initialWidth,
    axis: "x",
    reverse,
    minSize: 0,
    maxSize: unit === "%" ? 80 : 800,
    unit,
  });
  return { width: size, isDragging, handleDragStart, toggleCollapse };
}
