import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ClientSettingsModal } from "./ClientSettingsModal";
import {
  EMPTY_CLIENT_SETTINGS,
  ISSUER_URL_ERROR,
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

  it("allows close when an invalid CIMD URL is cleared (empty is valid to leave)", async () => {
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

    await expandCimdSection(user);
    await user.clear(screen.getByLabelText("Client ID metadata document URL"));
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
