import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ClientSettingsForm } from "./ClientSettingsForm";
import {
  EMPTY_CLIENT_SETTINGS,
  ISSUER_URL_ERROR,
  type ClientSettingsFormValues,
} from "./clientSettingsValues";

function resolveSettingsChange(
  call: unknown,
  prev: ClientSettingsFormValues,
): ClientSettingsFormValues {
  return typeof call === "function"
    ? (call as (p: ClientSettingsFormValues) => ClientSettingsFormValues)(prev)
    : (call as ClientSettingsFormValues);
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

  it("edits the IdP text fields via onSettingsChange", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    const initial = { ...EMPTY_CLIENT_SETTINGS, emaEnabled: true };
    renderWithMantine(
      <ClientSettingsForm
        settings={initial}
        expandedSections={["ema"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );

    await user.type(screen.getByLabelText("Client ID"), "x");
    expect(onSettingsChange).toHaveBeenLastCalledWith(expect.any(Function));
    expect(
      resolveSettingsChange(
        onSettingsChange.mock.calls[onSettingsChange.mock.calls.length - 1]![0],
        initial,
      ).clientId,
    ).toBe("x");

    onSettingsChange.mockClear();
    await user.type(screen.getByLabelText("Client Secret"), "s");
    expect(onSettingsChange).toHaveBeenLastCalledWith(expect.any(Function));
    expect(
      resolveSettingsChange(
        onSettingsChange.mock.calls[onSettingsChange.mock.calls.length - 1]![0],
        { ...initial, clientId: "x" },
      ).clientSecret,
    ).toBe("s");
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
    expect(onSettingsChange).toHaveBeenCalledWith(expect.any(Function));
    expect(
      resolveSettingsChange(onSettingsChange.mock.calls[0]![0], filled).issuer,
    ).toBe("");

    // Client ID clear -> patch({ clientId: "" })
    onSettingsChange.mockClear();
    await user.click(clearButtons[1]);
    expect(onSettingsChange).toHaveBeenCalledWith(expect.any(Function));
    expect(
      resolveSettingsChange(onSettingsChange.mock.calls[0]![0], filled)
        .clientId,
    ).toBe("");

    // Client Secret clear -> patch({ clientSecret: "" })
    onSettingsChange.mockClear();
    await user.click(clearButtons[2]);
    expect(onSettingsChange).toHaveBeenCalledWith(expect.any(Function));
    expect(
      resolveSettingsChange(onSettingsChange.mock.calls[0]![0], filled)
        .clientSecret,
    ).toBe("");
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
