import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ClientSettingsForm } from "./ClientSettingsForm";
import {
  EMPTY_CLIENT_SETTINGS,
  ISSUER_URL_ERROR,
} from "./clientSettingsValues";

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

  it("shows an inline error for an invalid issuer URL", () => {
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

    expect(screen.getByText(ISSUER_URL_ERROR)).toBeInTheDocument();
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

describe("ClientSettingsForm IdP fields", () => {
  it("hides the IdP fields when EMA is disabled", () => {
    renderWithMantine(
      <ClientSettingsForm
        settings={EMPTY_CLIENT_SETTINGS}
        expandedSections={["ema"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
      />,
    );

    expect(
      screen.getByLabelText("Enable enterprise IdP configuration"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Issuer")).not.toBeInTheDocument();
  });

  it("edits and clears the IdP fields", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ClientSettingsForm
        settings={{
          emaEnabled: true,
          issuer: "https://idp.test",
          clientId: "cid",
          clientSecret: "secret",
        }}
        expandedSections={["ema"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );

    await user.type(screen.getByLabelText("Issuer"), "x");
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ issuer: "https://idp.testx" }),
    );

    await user.type(screen.getByLabelText("Client ID"), "y");
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "cidy" }),
    );

    await user.type(screen.getByLabelText("Client Secret"), "z");
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecret: "secretz" }),
    );

    const clearButtons = screen.getAllByRole("button", { name: "Clear" });
    expect(clearButtons).toHaveLength(3);
    await user.click(clearButtons[0]);
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ issuer: "" }),
    );
    await user.click(clearButtons[1]);
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "" }),
    );
    await user.click(clearButtons[2]);
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecret: "" }),
    );
  });

  it("toggles EMA and changes expanded sections", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    const onExpandedSectionsChange = vi.fn();
    renderWithMantine(
      <ClientSettingsForm
        settings={EMPTY_CLIENT_SETTINGS}
        expandedSections={["ema"]}
        onExpandedSectionsChange={onExpandedSectionsChange}
        onSettingsChange={onSettingsChange}
      />,
    );

    await user.click(
      screen.getByLabelText("Enable enterprise IdP configuration"),
    );
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ emaEnabled: true }),
    );

    await user.click(
      screen.getByRole("button", { name: /Enterprise-Managed Authorization/i }),
    );
    expect(onExpandedSectionsChange).toHaveBeenCalled();
  });

  it("omits the sign out button when no logout handler is provided", () => {
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
