import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ClientSettingsModal } from "./ClientSettingsModal";
import {
  EMPTY_CLIENT_SETTINGS,
  type ClientSettingsFormValues,
} from "../ClientSettingsForm/clientSettingsValues";

function resolveSettingsChange(
  call: unknown,
  prev: ClientSettingsFormValues,
): ClientSettingsFormValues {
  return typeof call === "function"
    ? (call as (p: ClientSettingsFormValues) => ClientSettingsFormValues)(prev)
    : (call as ClientSettingsFormValues);
}

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
    expect(onSettingsChange).toHaveBeenCalledWith(expect.any(Function));
    expect(
      resolveSettingsChange(
        onSettingsChange.mock.calls[0]![0],
        EMPTY_CLIENT_SETTINGS,
      ),
    ).toEqual({
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
    const initial = { ...EMPTY_CLIENT_SETTINGS, emaEnabled: true };
    await user.type(screen.getByLabelText("Issuer"), "h");
    expect(onSettingsChange).toHaveBeenCalled();
    const call =
      onSettingsChange.mock.calls[onSettingsChange.mock.calls.length - 1]![0];
    expect(resolveSettingsChange(call, initial).issuer).toBe("h");
  });

  it("collapses then re-expands all sections via the list toggle", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ClientSettingsModal
        opened
        settings={EMPTY_CLIENT_SETTINGS}
        onClose={vi.fn()}
        onSettingsChange={vi.fn()}
      />,
    );

    // Default: EMA open, CIMD collapsed — toggle offers "Expand all".
    const expand = screen.getByRole("button", { name: "Expand all" });
    expect(expand).toBeInTheDocument();
    expect(
      screen.getByText("Enable enterprise IdP configuration"),
    ).toBeInTheDocument();

    await user.click(expand);
    expect(
      screen.getByRole("button", { name: "Collapse all" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(
      screen.getByRole("button", { name: "Expand all" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(
      screen.getByRole("button", { name: "Collapse all" }),
    ).toBeInTheDocument();
  });

  it("does not render the modal body when closed", () => {
    renderWithMantine(
      <ClientSettingsModal
        opened={false}
        settings={EMPTY_CLIENT_SETTINGS}
        onClose={vi.fn()}
        onSettingsChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("Client Settings")).not.toBeInTheDocument();
  });
});
