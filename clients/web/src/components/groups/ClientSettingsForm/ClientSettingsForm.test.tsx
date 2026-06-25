import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ClientSettingsForm } from "./ClientSettingsForm";
import { EMPTY_CLIENT_SETTINGS } from "./clientSettingsValues";

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
