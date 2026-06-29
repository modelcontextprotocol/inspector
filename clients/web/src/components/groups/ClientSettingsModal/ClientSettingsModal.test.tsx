import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ClientSettingsModal } from "./ClientSettingsModal";
import {
  EMPTY_CLIENT_SETTINGS,
  ISSUER_URL_ERROR,
} from "../ClientSettingsForm/clientSettingsValues";

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

    // Starts fully expanded (all sections open), so the toggle offers "Collapse all".
    const collapse = screen.getByRole("button", { name: "Collapse all" });
    expect(collapse).toBeInTheDocument();
    // The EMA section panel content is visible while expanded.
    expect(
      screen.getByText("Enable enterprise IdP configuration"),
    ).toBeInTheDocument();

    // Collapse all -> handleToggleAll sets expandedSections to [].
    await user.click(collapse);
    expect(
      screen.getByRole("button", { name: "Expand all" }),
    ).toBeInTheDocument();

    // Expand all -> handleToggleAll restores ALL_SECTIONS.
    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(
      screen.getByRole("button", { name: "Collapse all" }),
    ).toBeInTheDocument();
  });

  it("blocks close and reveals the issuer error when the issuer is invalid", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithMantine(
      <ClientSettingsModal
        opened
        settings={{
          ...EMPTY_CLIENT_SETTINGS,
          emaEnabled: true,
          issuer: "not-a-url",
        }}
        onClose={onClose}
        onSettingsChange={vi.fn()}
      />,
    );

    // Error is hidden initially (form gates it on blur)...
    expect(screen.queryByText(ISSUER_URL_ERROR)).not.toBeInTheDocument();
    // ...but a close attempt reveals it and does NOT close (no silent drop).
    await user.click(
      document.querySelector("button.mantine-CloseButton-root")!,
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(ISSUER_URL_ERROR)).toBeInTheDocument();
  });

  it("allows close once the invalid issuer is corrected", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Host() {
      const [settings, setSettings] = useState({
        ...EMPTY_CLIENT_SETTINGS,
        emaEnabled: true,
        issuer: "not-a-url",
      });
      return (
        <ClientSettingsModal
          opened
          settings={settings}
          onClose={onClose}
          onSettingsChange={setSettings}
        />
      );
    }
    renderWithMantine(<Host />);

    const close = () =>
      user.click(document.querySelector("button.mantine-CloseButton-root")!);

    await close(); // blocked, error revealed
    expect(onClose).not.toHaveBeenCalled();

    const issuer = screen.getByLabelText("Issuer");
    await user.clear(issuer);
    await user.type(issuer, "https://idp.test");
    expect(screen.queryByText(ISSUER_URL_ERROR)).not.toBeInTheDocument();

    await close(); // now valid -> closes
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("allows close when an invalid issuer is cleared (empty is valid to leave)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Host() {
      const [settings, setSettings] = useState({
        ...EMPTY_CLIENT_SETTINGS,
        emaEnabled: true,
        issuer: "not-a-url",
      });
      return (
        <ClientSettingsModal
          opened
          settings={settings}
          onClose={onClose}
          onSettingsChange={setSettings}
        />
      );
    }
    renderWithMantine(<Host />);

    await user.clear(screen.getByLabelText("Issuer"));
    await user.click(
      document.querySelector("button.mantine-CloseButton-root")!,
    );
    expect(onClose).toHaveBeenCalledTimes(1);
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
