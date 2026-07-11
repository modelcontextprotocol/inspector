import { describe, it, expect, vi, afterEach } from "vitest";
import {
  renderWithMantine,
  screen,
  fireEvent,
} from "../../../test/renderWithMantine";
import { ResizeHandle } from "./ResizeHandle";

// The panel sits to the RIGHT of the handle, so moving the pointer LEFT
// (decreasing clientX) widens it: next = startWidth + (startX - clientX).
function setup(overrides: Partial<Parameters<typeof ResizeHandle>[0]> = {}) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  renderWithMantine(
    <ResizeHandle
      value={400}
      min={320}
      max={720}
      onChange={onChange}
      onCommit={onCommit}
      {...overrides}
    />,
  );
  return { handle: screen.getByRole("separator"), onChange, onCommit };
}

describe("ResizeHandle", () => {
  afterEach(() => {
    document.body.classList.remove("resizing-col");
  });

  it("exposes the separator role with live aria values", () => {
    const { handle } = setup();
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("aria-valuenow", "400");
    expect(handle).toHaveAttribute("aria-valuemin", "320");
    expect(handle).toHaveAttribute("aria-valuemax", "720");
    expect(handle).toHaveAccessibleName("Resize panel");
  });

  it("accepts a custom aria-label", () => {
    setup({ "aria-label": "Resize monitoring sidebar" });
    expect(
      screen.getByRole("separator", { name: "Resize monitoring sidebar" }),
    ).toBeInTheDocument();
  });

  it("reports the widened value while dragging left and commits on release", () => {
    const { handle, onChange, onCommit } = setup();
    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 460, pointerId: 1 });
    // startWidth 400 + (500 - 460) = 440
    expect(onChange).toHaveBeenLastCalledWith(440);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { clientX: 460, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith(440);
  });

  it("clamps to max when dragged past the upper bound", () => {
    const { handle, onChange } = setup();
    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 0, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(720);
  });

  it("clamps to min when dragged past the lower bound", () => {
    const { handle, onChange } = setup();
    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 900, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(320);
  });

  it("toggles the drag body class across the gesture", () => {
    const { handle } = setup();
    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    expect(document.body.classList.contains("resizing-col")).toBe(true);
    fireEvent.pointerUp(handle, { clientX: 500, pointerId: 1 });
    expect(document.body.classList.contains("resizing-col")).toBe(false);
  });

  it("ends the drag on pointer cancel", () => {
    const { handle, onCommit } = setup();
    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerCancel(handle, { clientX: 480, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith(420);
    expect(document.body.classList.contains("resizing-col")).toBe(false);
  });

  it("clears the drag body class if it unmounts mid-drag", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const { unmount } = renderWithMantine(
      <ResizeHandle
        value={400}
        min={320}
        max={720}
        onChange={onChange}
        onCommit={onCommit}
      />,
    );
    fireEvent.pointerDown(screen.getByRole("separator"), {
      clientX: 500,
      pointerId: 1,
    });
    expect(document.body.classList.contains("resizing-col")).toBe(true);
    // No pointerup/cancel — the handle is removed from the tree first.
    unmount();
    expect(document.body.classList.contains("resizing-col")).toBe(false);
  });

  it("ignores pointer moves when no drag is active", () => {
    const { handle, onChange, onCommit } = setup();
    fireEvent.pointerMove(handle, { clientX: 460, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 460, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("uses pointer capture when the platform supports it", () => {
    const setCapture = vi.fn();
    const releaseCapture = vi.fn();
    const proto = HTMLElement.prototype as unknown as {
      setPointerCapture?: (id: number) => void;
      releasePointerCapture?: (id: number) => void;
    };
    proto.setPointerCapture = setCapture;
    proto.releasePointerCapture = releaseCapture;
    try {
      const { handle } = setup();
      fireEvent.pointerDown(handle, { clientX: 500, pointerId: 7 });
      fireEvent.pointerUp(handle, { clientX: 500, pointerId: 7 });
      expect(setCapture).toHaveBeenCalledWith(7);
      expect(releaseCapture).toHaveBeenCalledWith(7);
    } finally {
      delete proto.setPointerCapture;
      delete proto.releasePointerCapture;
    }
  });

  it("widens by one step on ArrowLeft and commits", () => {
    const { handle, onChange, onCommit } = setup({ step: 20 });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith(420);
    expect(onCommit).toHaveBeenCalledWith(420);
  });

  it("narrows by one step on ArrowRight", () => {
    const { handle, onChange } = setup();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    // default step 16: 400 - 16 = 384
    expect(onChange).toHaveBeenCalledWith(384);
  });

  it("clamps keyboard steps to the bounds", () => {
    const { handle, onChange } = setup({ value: 712 });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith(720);
  });

  it("ignores non-arrow keys", () => {
    const { handle, onChange, onCommit } = setup();
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
