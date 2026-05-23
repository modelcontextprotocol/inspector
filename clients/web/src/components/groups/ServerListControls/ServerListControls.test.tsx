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
  onExport: vi.fn(),
};

describe("ServerListControls", () => {
  it("hides the list toggle when there are no servers (Export + Add Servers remain)", () => {
    renderWithMantine(<ServerListControls {...baseProps} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Export/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Add Servers/ }),
    ).toBeInTheDocument();
  });

  it("shows the list toggle alongside Export + Add Servers when servers exist", () => {
    renderWithMantine(<ServerListControls {...baseProps} serverCount={2} />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
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

  it("disables Export when the list is empty (nothing to download)", () => {
    renderWithMantine(<ServerListControls {...baseProps} />);
    expect(screen.getByRole("button", { name: /Export/ })).toBeDisabled();
  });

  it("enables Export when at least one server exists", () => {
    renderWithMantine(<ServerListControls {...baseProps} serverCount={1} />);
    expect(screen.getByRole("button", { name: /Export/ })).not.toBeDisabled();
  });

  it("calls onExport when Export is clicked (with at least one server)", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    renderWithMantine(
      <ServerListControls {...baseProps} serverCount={1} onExport={onExport} />,
    );
    await user.click(screen.getByRole("button", { name: /Export/ }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
