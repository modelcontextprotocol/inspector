import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ClientSettingsModal } from "./ClientSettingsModal";
import {
  EMPTY_CLIENT_SETTINGS,
  ISSUER_URL_ERROR,
  CLIENT_ID_REQUIRED_ERROR,
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

  const clickClose = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(document.querySelector("button.mantine-CloseButton-root")!);

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
          clientId: "client-1",
        }}
        onClose={onClose}
        onSettingsChange={vi.fn()}
      />,
    );

    // Error is hidden initially (form gates it on blur)...
    expect(screen.queryByText(ISSUER_URL_ERROR)).not.toBeInTheDocument();
    // ...but a close attempt reveals it and does NOT close (no silent drop).
    await clickClose(user);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(ISSUER_URL_ERROR)).toBeInTheDocument();
  });

  it("blocks close and reveals the required error when the client ID is blank", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithMantine(
      <ClientSettingsModal
        opened
        settings={{
          ...EMPTY_CLIENT_SETTINGS,
          emaEnabled: true,
          issuer: "https://idp.test", // valid issuer, but clientId is blank
        }}
        onClose={onClose}
        onSettingsChange={vi.fn()}
      />,
    );

    expect(
      screen.queryByText(CLIENT_ID_REQUIRED_ERROR),
    ).not.toBeInTheDocument();
    await clickClose(user);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(CLIENT_ID_REQUIRED_ERROR)).toBeInTheDocument();
  });

  it("allows close once the invalid issuer is corrected", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Host() {
      const [settings, setSettings] = useState({
        ...EMPTY_CLIENT_SETTINGS,
        emaEnabled: true,
        issuer: "not-a-url",
        clientId: "client-1", // complete except for the issuer
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

    await clickClose(user); // blocked, error revealed
    expect(onClose).not.toHaveBeenCalled();

    const issuer = screen.getByLabelText("Issuer");
    await user.clear(issuer);
    await user.type(issuer, "https://idp.test");
    expect(screen.queryByText(ISSUER_URL_ERROR)).not.toBeInTheDocument();

    await clickClose(user); // now complete + valid -> closes
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("allows close once a blank client ID is filled", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Host() {
      const [settings, setSettings] = useState({
        ...EMPTY_CLIENT_SETTINGS,
        emaEnabled: true,
        issuer: "https://idp.test", // complete except for the clientId
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

    await clickClose(user); // blocked on blank clientId
    expect(onClose).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Client ID"), "client-1");
    await clickClose(user); // now complete -> closes
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("allows close by disabling enterprise IdP when the config is incomplete", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Host() {
      const [settings, setSettings] = useState({
        ...EMPTY_CLIENT_SETTINGS,
        emaEnabled: true, // enabled but issuer + clientId blank
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

    await clickClose(user); // blocked: required fields blank
    expect(onClose).not.toHaveBeenCalled();

    // Disabling enterprise IdP is the escape hatch — nothing required to save.
    await user.click(
      screen.getByRole("checkbox", {
        name: "Enable enterprise IdP configuration",
      }),
    );
    await clickClose(user);
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
