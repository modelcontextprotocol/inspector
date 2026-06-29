import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ClientSettingsModal } from "./ClientSettingsModal";
import {
  EMPTY_CLIENT_SETTINGS,
  ISSUER_URL_ERROR,
  CLIENT_ID_REQUIRED_ERROR,
  CLIENT_METADATA_URL_REQUIRED_ERROR,
  type ClientSettingsFormValues,
} from "../ClientSettingsForm/clientSettingsValues";
import { CIMD_METADATA_URL_INVALID_ERROR } from "@inspector/core/client/config-parse.js";

function resolveSettingsChange(
  call: unknown,
  prev: ClientSettingsFormValues,
): ClientSettingsFormValues {
  return typeof call === "function"
    ? (call as (p: ClientSettingsFormValues) => ClientSettingsFormValues)(prev)
    : (call as ClientSettingsFormValues);
}

async function expandCimdSection(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: /OAuth Client ID Metadata Document/i }),
  );
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

  it("blocks close and reveals the CIMD URL error when the URL is invalid", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithMantine(
      <ClientSettingsModal
        opened
        settings={{
          ...EMPTY_CLIENT_SETTINGS,
          cimdEnabled: true,
          clientMetadataUrl: "not-a-url",
        }}
        onClose={onClose}
        onSettingsChange={vi.fn()}
      />,
    );

    expect(
      screen.queryByText(CIMD_METADATA_URL_INVALID_ERROR),
    ).not.toBeInTheDocument();
    await user.click(
      document.querySelector("button.mantine-CloseButton-root")!,
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByText(CIMD_METADATA_URL_INVALID_ERROR),
    ).toBeInTheDocument();
  });

  it("allows close once an invalid CIMD URL is corrected", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Host() {
      const [settings, setSettings] = useState({
        ...EMPTY_CLIENT_SETTINGS,
        cimdEnabled: true,
        clientMetadataUrl: "not-a-url",
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

    await close();
    expect(onClose).not.toHaveBeenCalled();

    await expandCimdSection(user);
    const url = screen.getByLabelText("Client ID metadata document URL");
    await user.clear(url);
    await user.type(url, "https://example.com/cimd.json");
    expect(
      screen.queryByText(CIMD_METADATA_URL_INVALID_ERROR),
    ).not.toBeInTheDocument();

    await close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("blocks close and reveals the required error when the CIMD URL is blank", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithMantine(
      <ClientSettingsModal
        opened
        settings={{
          ...EMPTY_CLIENT_SETTINGS,
          cimdEnabled: true, // enabled but metadata URL blank
        }}
        onClose={onClose}
        onSettingsChange={vi.fn()}
      />,
    );

    expect(
      screen.queryByText(CLIENT_METADATA_URL_REQUIRED_ERROR),
    ).not.toBeInTheDocument();
    await user.click(
      document.querySelector("button.mantine-CloseButton-root")!,
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByText(CLIENT_METADATA_URL_REQUIRED_ERROR),
    ).toBeInTheDocument();
  });

  it("allows close once a blank CIMD URL is filled", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Host() {
      const [settings, setSettings] = useState({
        ...EMPTY_CLIENT_SETTINGS,
        cimdEnabled: true, // enabled but metadata URL blank
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

    await user.click(
      document.querySelector("button.mantine-CloseButton-root")!,
    ); // blocked on blank URL
    expect(onClose).not.toHaveBeenCalled();

    await expandCimdSection(user);
    await user.type(
      screen.getByLabelText("Client ID metadata document URL"),
      "https://example.com/cimd.json",
    );
    await user.click(
      document.querySelector("button.mantine-CloseButton-root")!,
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("allows close by disabling CIMD when the URL is blank", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Host() {
      const [settings, setSettings] = useState({
        ...EMPTY_CLIENT_SETTINGS,
        cimdEnabled: true, // enabled but metadata URL blank
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

    await user.click(
      document.querySelector("button.mantine-CloseButton-root")!,
    ); // blocked: URL required
    expect(onClose).not.toHaveBeenCalled();

    // Disabling CIMD is the escape hatch — nothing required to save.
    await expandCimdSection(user);
    await user.click(
      screen.getByRole("checkbox", { name: "Use Client ID Metadata Document" }),
    );
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
