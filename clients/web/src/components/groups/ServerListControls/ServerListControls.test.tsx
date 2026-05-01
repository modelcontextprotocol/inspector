import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ServerListControls } from "./ServerListControls";

const baseProps = {
  compact: false,
  serverCount: 0,
  onToggleList: vi.fn(),
  onAddManually: vi.fn(),
  onImportConfig: vi.fn(),
  onImportServerJson: vi.fn(),
};

describe("ServerListControls", () => {
  it("hides the list toggle when there are no servers", () => {
    renderWithMantine(<ServerListControls {...baseProps} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(/Add Servers/);
  });

  it("shows the list toggle when servers exist", () => {
    renderWithMantine(<ServerListControls {...baseProps} serverCount={2} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("calls onToggleList when the list toggle is clicked", async () => {
    const user = userEvent.setup();
    const onToggleList = vi.fn();
    renderWithMantine(
      <ServerListControls
        {...baseProps}
        serverCount={1}
        onToggleList={onToggleList}
      />,
    );
    const buttons = screen.getAllByRole("button");
    await user.click(buttons[0]);
    expect(onToggleList).toHaveBeenCalledTimes(1);
  });
});
