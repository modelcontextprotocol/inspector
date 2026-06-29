import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ClientSettingsForm } from "./ClientSettingsForm";
import {
  EMPTY_CLIENT_SETTINGS,
  ISSUER_URL_ERROR,
  type ClientSettingsFormValues,
} from "./clientSettingsValues";

/** Stateful host so the controlled issuer input reflects edits, like the app. */
function ClientSettingsFormHarness({
  initial,
}: {
  initial: ClientSettingsFormValues;
}) {
  const [settings, setSettings] = useState(initial);
  return (
    <ClientSettingsForm
      settings={settings}
      expandedSections={["ema"]}
      onExpandedSectionsChange={vi.fn()}
      onSettingsChange={setSettings}
      emaIdpLoginState="none"
    />
  );
}

describe("ClientSettingsForm EMA IdP session", () => {
  it("shows signed-in state and sign out", async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    renderWithMantine(
      <ClientSettingsForm
        settings={{
          ...EMPTY_CLIENT_SETTINGS,
          emaEnabled: true,
          issuer: "https://idp.test",
        }}
        expandedSections={["ema"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
        emaIdpLoginState="logged_in"
        onEmaIdpLogout={onLogout}
      />,
    );

    expect(screen.getByText("Signed in")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onLogout).toHaveBeenCalled();
  });

  it("shows not signed in without sign out button", () => {
    renderWithMantine(
      <ClientSettingsForm
        settings={{
          ...EMPTY_CLIENT_SETTINGS,
          emaEnabled: true,
          issuer: "https://idp.test",
        }}
        expandedSections={["ema"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
        emaIdpLoginState="none"
        onEmaIdpLogout={vi.fn()}
      />,
    );

    expect(screen.getByText(/Not signed in/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sign out" }),
    ).not.toBeInTheDocument();
  });

  it("defers the invalid-issuer error until the field is blurred", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ClientSettingsForm
        settings={{
          ...EMPTY_CLIENT_SETTINGS,
          emaEnabled: true,
          issuer: "not-a-url",
        }}
        expandedSections={["ema"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
        emaIdpLoginState="none"
      />,
    );

    // Invalid value present, but the error stays hidden until the user leaves
    // the field — no nagging while it may still be mid-typing.
    expect(screen.queryByText(ISSUER_URL_ERROR)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Issuer"));
    await user.tab(); // blur the issuer field
    expect(screen.getByText(ISSUER_URL_ERROR)).toBeInTheDocument();
  });

  it("clears the issuer error live once a valid URL is entered after blur", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ClientSettingsFormHarness
        initial={{
          ...EMPTY_CLIENT_SETTINGS,
          emaEnabled: true,
          issuer: "not-a-url",
        }}
      />,
    );

    const issuer = screen.getByLabelText("Issuer");
    await user.click(issuer);
    await user.tab(); // touched -> error shows for the invalid value
    expect(screen.getByText(ISSUER_URL_ERROR)).toBeInTheDocument();

    // Once touched, the error tracks the value live: fixing it clears the error
    // without needing another blur.
    await user.clear(issuer);
    await user.type(issuer, "https://idp.test");
    expect(screen.queryByText(ISSUER_URL_ERROR)).not.toBeInTheDocument();
  });

  it("reveals the issuer error without blur when revealIssuerError is set", () => {
    renderWithMantine(
      <ClientSettingsForm
        settings={{
          ...EMPTY_CLIENT_SETTINGS,
          emaEnabled: true,
          issuer: "not-a-url",
        }}
        expandedSections={["ema"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
        emaIdpLoginState="none"
        revealIssuerError
      />,
    );

    // Parent forced the error on (e.g. a close was attempted) — shown even
    // though the field was never blurred.
    expect(screen.getByText(ISSUER_URL_ERROR)).toBeInTheDocument();
  });

  it("shows no error for a valid issuer even when revealIssuerError is set", () => {
    renderWithMantine(
      <ClientSettingsForm
        settings={{
          ...EMPTY_CLIENT_SETTINGS,
          emaEnabled: true,
          issuer: "https://idp.test",
        }}
        expandedSections={["ema"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
        emaIdpLoginState="none"
        revealIssuerError
      />,
    );

    expect(screen.queryByText(ISSUER_URL_ERROR)).not.toBeInTheDocument();
  });

  it("shows no issuer error for a valid URL", () => {
    renderWithMantine(
      <ClientSettingsForm
        settings={{
          ...EMPTY_CLIENT_SETTINGS,
          emaEnabled: true,
          issuer: "https://idp.test",
        }}
        expandedSections={["ema"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
        emaIdpLoginState="none"
      />,
    );

    expect(screen.queryByText(ISSUER_URL_ERROR)).not.toBeInTheDocument();
  });

  it("shows expired state with sign out", () => {
    renderWithMantine(
      <ClientSettingsForm
        settings={{
          ...EMPTY_CLIENT_SETTINGS,
          emaEnabled: true,
          issuer: "https://idp.test",
        }}
        expandedSections={["ema"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
        emaIdpLoginState="expired"
        onEmaIdpLogout={vi.fn()}
      />,
    );

    expect(screen.getByText("Session expired")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });
});

describe("ClientSettingsForm interactions", () => {
  it("propagates accordion expand/collapse changes", async () => {
    const user = userEvent.setup();
    const onExpandedSectionsChange = vi.fn();
    renderWithMantine(
      <ClientSettingsForm
        settings={EMPTY_CLIENT_SETTINGS}
        expandedSections={["ema"]}
        onExpandedSectionsChange={onExpandedSectionsChange}
        onSettingsChange={vi.fn()}
      />,
    );

    // Clicking the accordion control toggles the open section. Since it starts
    // open, collapsing it should report an empty section list.
    await user.click(
      screen.getByRole("button", { name: /Enterprise-Managed Authorization/i }),
    );
    expect(onExpandedSectionsChange).toHaveBeenCalledWith([]);
  });

  it("toggles the EMA enable checkbox via onSettingsChange", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ClientSettingsForm
        settings={EMPTY_CLIENT_SETTINGS}
        expandedSections={["ema"]}
        onExpandedSectionsChange={vi.fn()}
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

  it("edits the IdP text fields via onSettingsChange", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ClientSettingsForm
        settings={{ ...EMPTY_CLIENT_SETTINGS, emaEnabled: true }}
        expandedSections={["ema"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );

    await user.type(screen.getByLabelText("Client ID"), "x");
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      ...EMPTY_CLIENT_SETTINGS,
      emaEnabled: true,
      clientId: "x",
    });

    onSettingsChange.mockClear();
    await user.type(screen.getByLabelText("Client Secret"), "s");
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      ...EMPTY_CLIENT_SETTINGS,
      emaEnabled: true,
      clientSecret: "s",
    });
  });

  it("clears each populated IdP field via its clear button", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    const filled = {
      ...EMPTY_CLIENT_SETTINGS,
      emaEnabled: true,
      issuer: "https://idp.test",
      clientId: "client-1",
      clientSecret: "secret-1",
    };
    renderWithMantine(
      <ClientSettingsForm
        settings={filled}
        expandedSections={["ema"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );

    // Each populated field renders a "Clear" button in its right section.
    const clearButtons = screen.getAllByRole("button", { name: "Clear" });
    expect(clearButtons).toHaveLength(3);

    // Issuer clear -> patch({ issuer: "" })
    await user.click(clearButtons[0]);
    expect(onSettingsChange).toHaveBeenCalledWith({ ...filled, issuer: "" });

    // Client ID clear -> patch({ clientId: "" })
    onSettingsChange.mockClear();
    await user.click(clearButtons[1]);
    expect(onSettingsChange).toHaveBeenCalledWith({ ...filled, clientId: "" });

    // Client Secret clear -> patch({ clientSecret: "" })
    onSettingsChange.mockClear();
    await user.click(clearButtons[2]);
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...filled,
      clientSecret: "",
    });
  });

  it("omits clear buttons when IdP fields are empty", () => {
    renderWithMantine(
      <ClientSettingsForm
        settings={{ ...EMPTY_CLIENT_SETTINGS, emaEnabled: true }}
        expandedSections={["ema"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Clear" }),
    ).not.toBeInTheDocument();
  });

  it("hides the IdP section entirely when EMA is disabled", () => {
    renderWithMantine(
      <ClientSettingsForm
        settings={EMPTY_CLIENT_SETTINGS}
        expandedSections={["ema"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Issuer")).not.toBeInTheDocument();
    expect(screen.queryByText(/IdP sign-in/i)).not.toBeInTheDocument();
  });

  it("defaults emaIdpLoginState to none and shows the not-signed-in hint", () => {
    renderWithMantine(
      <ClientSettingsForm
        settings={{
          ...EMPTY_CLIENT_SETTINGS,
          emaEnabled: true,
          issuer: "https://idp.test",
        }}
        expandedSections={["ema"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
      />,
    );
    // emaIdpLoginState prop omitted -> defaults to "none"; sign-in section
    // renders (issuer present) but with no sign-out button.
    expect(screen.getByText("IdP sign-in")).toBeInTheDocument();
    expect(screen.getByText(/Not signed in/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sign out" }),
    ).not.toBeInTheDocument();
  });

  it("renders no sign-out button when logged in but onEmaIdpLogout is absent", () => {
    renderWithMantine(
      <ClientSettingsForm
        settings={{
          ...EMPTY_CLIENT_SETTINGS,
          emaEnabled: true,
          issuer: "https://idp.test",
        }}
        expandedSections={["ema"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
        emaIdpLoginState="logged_in"
      />,
    );
    expect(screen.getByText("Signed in")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sign out" }),
    ).not.toBeInTheDocument();
  });
});
