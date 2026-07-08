import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Box } from "@mantine/core";

export interface ResizeHandleProps {
  /** Current width (px) of the panel this handle resizes. */
  value: number;
  /** Lower / upper clamp bounds (px). */
  min: number;
  max: number;
  /** Keyboard arrow step in px (default 16). */
  step?: number;
  /**
   * Fired continuously while dragging and on each keyboard step, with the
   * clamped next width. The parent renders from this for live feedback.
   */
  onChange: (next: number) => void;
  /**
   * Fired once when the gesture ends (pointer up / key up) with the final
   * clamped width, so the parent can persist it in a single write.
   */
  onCommit: (next: number) => void;
  "aria-label"?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A thin draggable vertical divider that resizes a panel sitting to its RIGHT
 * (so dragging left widens the panel). Pointer-capture keeps the gesture alive
 * even when the pointer crosses an iframe (the Apps screen renders one), which
 * would otherwise swallow the move stream and make the drag stick. Exposes the
 * ARIA `separator` role with live value so it's operable by keyboard too.
 */
export function ResizeHandle({
  value,
  min,
  max,
  step = 16,
  onChange,
  onCommit,
  "aria-label": ariaLabel = "Resize panel",
}: ResizeHandleProps) {
  // Gesture origin, captured on pointer down. `null` while idle.
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    drag.current = { startX: e.clientX, startWidth: value };
    // Optional chaining: happy-dom (unit tests) doesn't implement pointer
    // capture, and it's a progressive enhancement, not required for correctness.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    document.body.classList.add("resizing-col");
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const next = clamp(
      drag.current.startWidth + (drag.current.startX - e.clientX),
      min,
      max,
    );
    onChange(next);
  }

  function endDrag(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const next = clamp(
      drag.current.startWidth + (drag.current.startX - e.clientX),
      min,
      max,
    );
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    document.body.classList.remove("resizing-col");
    onCommit(next);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // Left widens (panel is on the right), Right narrows — mirrors the drag.
    const delta =
      e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0;
    if (delta === 0) return;
    e.preventDefault();
    const next = clamp(value + delta, min, max);
    onChange(next);
    onCommit(next);
  }

  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-label={ariaLabel}
      tabIndex={0}
      className="resize-handle"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
    />
  );
}
