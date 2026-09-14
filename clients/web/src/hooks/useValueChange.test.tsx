import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { renderWithMantine } from "../test/renderWithMantine";
import { useValueChange } from "./useValueChange";

/**
 * Mirrors the real usage: `mirrored` is seeded from `source`, can be overridden
 * locally, and snaps back whenever `source` changes.
 */
function Probe({
  source,
  onChange,
}: {
  source: number;
  onChange?: (next: number) => void;
}) {
  const [mirrored, setMirrored] = useState(source);
  const [renders, setRenders] = useState(0);
  useValueChange(source, (next) => {
    setMirrored(next);
    onChange?.(next);
  });
  return (
    <>
      <span data-testid="mirrored">{mirrored}</span>
      <span data-testid="renders">{renders}</span>
      <button onClick={() => setMirrored(-1)}>override</button>
      <button onClick={() => setRenders((r) => r + 1)}>rerender</button>
    </>
  );
}

describe("useValueChange", () => {
  it("does not call onChange on the first render", () => {
    const onChange = vi.fn();
    const { getByTestId } = renderWithMantine(
      <Probe source={5} onChange={onChange} />,
    );
    expect(getByTestId("mirrored").textContent).toBe("5");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls onChange with the new value when the watched value changes", () => {
    const onChange = vi.fn();
    const { rerender, getByTestId } = renderWithMantine(
      <Probe source={5} onChange={onChange} />,
    );
    rerender(<Probe source={7} onChange={onChange} />);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(7);
    expect(getByTestId("mirrored").textContent).toBe("7");
  });

  it("discards a local override when the watched value changes", async () => {
    const user = userEvent.setup();
    const { rerender, getByTestId, getByText } = renderWithMantine(
      <Probe source={5} />,
    );
    await user.click(getByText("override"));
    expect(getByTestId("mirrored").textContent).toBe("-1");

    rerender(<Probe source={9} />);
    expect(getByTestId("mirrored").textContent).toBe("9");
  });

  it("keeps a local override across re-renders that leave the value unchanged", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { getByTestId, getByText } = renderWithMantine(
      <Probe source={5} onChange={onChange} />,
    );
    await user.click(getByText("override"));
    await user.click(getByText("rerender"));

    expect(getByTestId("renders").textContent).toBe("1");
    expect(getByTestId("mirrored").textContent).toBe("-1");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("treats NaN as unchanged (Object.is, not ===)", () => {
    const onChange = vi.fn();
    const { rerender } = renderWithMantine(
      <Probe source={NaN} onChange={onChange} />,
    );
    rerender(<Probe source={NaN} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });
});
