import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ClientSettingsModal } from "./ClientSettingsModal";
import { EMPTY_CLIENT_SETTINGS } from "../ClientSettingsForm/clientSettingsValues";

describe("ClientSettingsModal", () => {
  it("renders the title when opened", () => {
    renderWithMantine(
      <ClientSettingsModal
        opened
        settings={EMPTY_CLIENT_SETTINGS}
        onClose={vi.fn()}
        onSettingsChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Client Settings")).toBeInTheDocument();
  });

  it("invokes onClose when the CloseButton is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithMantine(
      <ClientSettingsModal
        opened
        settings={EMPTY_CLIENT_SETTINGS}
        onClose={onClose}
        onSettingsChange={vi.fn()}
      />,
    );
    await user.click(
      document.querySelector("button.mantine-CloseButton-root")!,
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onSettingsChange when toggling EMA enable", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ClientSettingsModal
        opened
        settings={EMPTY_CLIENT_SETTINGS}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "Enable enterprise IdP configuration",
      }),
    );
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...EMPTY_CLIENT_SETTINGS,
      emaEnabled: true,
    });
  });

  it("shows IdP fields when EMA is enabled", () => {
    renderWithMantine(
      <ClientSettingsModal
        opened
        settings={{ ...EMPTY_CLIENT_SETTINGS, emaEnabled: true }}
        onClose={vi.fn()}
        onSettingsChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Issuer")).toBeInTheDocument();
    expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Client Secret")).toBeInTheDocument();
  });

  it("calls onSettingsChange when typing issuer", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ClientSettingsModal
        opened
        settings={{ ...EMPTY_CLIENT_SETTINGS, emaEnabled: true }}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    await user.type(screen.getByLabelText("Issuer"), "h");
    expect(onSettingsChange).toHaveBeenCalled();
    const call =
      onSettingsChange.mock.calls[onSettingsChange.mock.calls.length - 1][0];
    expect(call.issuer).toBe("h");
  });
});
