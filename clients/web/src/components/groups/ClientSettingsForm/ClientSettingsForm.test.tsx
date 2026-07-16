import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ClientSettingsForm } from "./ClientSettingsForm";
import {
  CIMD_METADATA_URL_HTTPS_ERROR,
  CIMD_METADATA_URL_INVALID_ERROR,
} from "@inspector/core/client/config-parse.js";
import {
  EMPTY_CLIENT_SETTINGS,
  ISSUER_URL_ERROR,
  ISSUER_REQUIRED_ERROR,
  CLIENT_ID_REQUIRED_ERROR,
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

/** Stateful host so the controlled issuer input reflects edits, like the app. */
function ClientSettingsFormHarness({
  initial,
  expandedSections = ["ema"],
}: {
  initial: ClientSettingsFormValues;
  expandedSections?: ClientSettingsSection[];
}) {
  const [settings, setSettings] = useState(initial);
  return (
    <ClientSettingsForm
      settings={settings}
      expandedSections={expandedSections}
      onExpandedSectionsChange={vi.fn()}
      onSettingsChange={setSettings}
      emaIdpLoginState="none"
    />
  );
}

type ClientSettingsSection = "ema" | "cimd";

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

  it("reveals the issuer error without blur when revealErrors is set", () => {
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
        revealErrors
      />,
    );

    // Parent forced the error on (e.g. a close was attempted) — shown even
    // though the field was never blurred.
    expect(screen.getByText(ISSUER_URL_ERROR)).toBeInTheDocument();
  });

  it("reveals required errors for blank issuer and client ID when revealErrors is set", () => {
    renderWithMantine(
      <ClientSettingsForm
        settings={{ ...EMPTY_CLIENT_SETTINGS, emaEnabled: true }}
        expandedSections={["ema"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
        emaIdpLoginState="none"
        revealErrors
      />,
    );

    // Both required IdP fields are blank; a close/save attempt surfaces them
    // instead of silently dropping the config.
    expect(screen.getByText(ISSUER_REQUIRED_ERROR)).toBeInTheDocument();
    expect(screen.getByText(CLIENT_ID_REQUIRED_ERROR)).toBeInTheDocument();
  });

  it("does not show required errors for blank fields before revealErrors", () => {
    renderWithMantine(
      <ClientSettingsForm
        settings={{ ...EMPTY_CLIENT_SETTINGS, emaEnabled: true }}
        expandedSections={["ema"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
        emaIdpLoginState="none"
      />,
    );

    // Inline validation must not nag about not-yet-filled required fields.
    expect(screen.queryByText(ISSUER_REQUIRED_ERROR)).not.toBeInTheDocument();
    expect(
      screen.queryByText(CLIENT_ID_REQUIRED_ERROR),
    ).not.toBeInTheDocument();
  });

  it("shows no error for a valid issuer even when revealErrors is set", () => {
    renderWithMantine(
      <ClientSettingsForm
        settings={{
          ...EMPTY_CLIENT_SETTINGS,
          emaEnabled: true,
          issuer: "https://idp.test",
          clientId: "client-1",
        }}
        expandedSections={["ema"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
        emaIdpLoginState="none"
        revealErrors
      />,
    );

    expect(screen.queryByText(ISSUER_URL_ERROR)).not.toBeInTheDocument();
    expect(
      screen.queryByText(CLIENT_ID_REQUIRED_ERROR),
    ).not.toBeInTheDocument();
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

  it("defers the invalid CIMD URL error until the field is blurred", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ClientSettingsForm
        settings={{
          ...EMPTY_CLIENT_SETTINGS,
          cimdEnabled: true,
          clientMetadataUrl: "not-a-url",
        }}
        expandedSections={["cimd"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
        emaIdpLoginState="none"
      />,
    );

    expect(
      screen.queryByText(CIMD_METADATA_URL_INVALID_ERROR),
    ).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Client ID metadata document URL"));
    await user.tab();
    expect(
      screen.getByText(CIMD_METADATA_URL_INVALID_ERROR),
    ).toBeInTheDocument();
  });

  it("clears the CIMD URL error live once a valid URL is entered after blur", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ClientSettingsFormHarness
        initial={{
          ...EMPTY_CLIENT_SETTINGS,
          cimdEnabled: true,
          clientMetadataUrl: "not-a-url",
        }}
        expandedSections={["cimd"]}
      />,
    );

    const url = screen.getByLabelText("Client ID metadata document URL");
    await user.click(url);
    await user.tab();
    expect(
      screen.getByText(CIMD_METADATA_URL_INVALID_ERROR),
    ).toBeInTheDocument();

    await user.clear(url);
    await user.type(url, "https://example.com/cimd.json");
    expect(
      screen.queryByText(CIMD_METADATA_URL_INVALID_ERROR),
    ).not.toBeInTheDocument();
  });

  it("reveals the CIMD URL error without blur when revealErrors is set", () => {
    renderWithMantine(
      <ClientSettingsForm
        settings={{
          ...EMPTY_CLIENT_SETTINGS,
          cimdEnabled: true,
          clientMetadataUrl: "http://example.com/cimd.json",
        }}
        expandedSections={["cimd"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
        emaIdpLoginState="none"
        revealErrors
      />,
    );

    expect(screen.getByText(CIMD_METADATA_URL_HTTPS_ERROR)).toBeInTheDocument();
  });

  it("shows no CIMD URL error for a valid URL", () => {
    renderWithMantine(
      <ClientSettingsForm
        settings={{
          ...EMPTY_CLIENT_SETTINGS,
          cimdEnabled: true,
          clientMetadataUrl: "https://example.com/cimd.json",
        }}
        expandedSections={["cimd"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
        emaIdpLoginState="none"
      />,
    );

    expect(
      screen.queryByText(CIMD_METADATA_URL_INVALID_ERROR),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(CIMD_METADATA_URL_HTTPS_ERROR),
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

  it("toggles the CIMD enable checkbox via onSettingsChange", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ClientSettingsForm
        settings={EMPTY_CLIENT_SETTINGS}
        expandedSections={["cimd"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );

    await user.click(
      screen.getByRole("checkbox", {
        name: "Use Client ID Metadata Document",
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
      cimdEnabled: true,
    });
  });

  it("clears the CIMD metadata URL via its clear button", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    const filled = {
      ...EMPTY_CLIENT_SETTINGS,
      cimdEnabled: true,
      clientMetadataUrl: "https://example.com/cimd.json",
    };
    renderWithMantine(
      <ClientSettingsForm
        settings={filled}
        expandedSections={["cimd"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onSettingsChange).toHaveBeenCalledWith(expect.any(Function));
    expect(
      resolveSettingsChange(onSettingsChange.mock.calls[0]![0], filled)
        .clientMetadataUrl,
    ).toBe("");
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

describe("ClientSettingsForm SEP-837 registration UX", () => {
  it("renders a registration-rejection alert with the RFC 7591 error detail", () => {
    renderWithMantine(
      <ClientSettingsForm
        settings={EMPTY_CLIENT_SETTINGS}
        expandedSections={[]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
        registrationError={{
          error: "invalid_redirect_uri",
          errorDescription: "Loopback redirect URIs are not permitted",
          status: 400,
        }}
      />,
    );
    expect(
      screen.getByText("Client registration was rejected"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/invalid_redirect_uri — .* — HTTP 400/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/registers as a native client/i),
    ).toBeInTheDocument();
  });

  it("falls back to a generic message when no RFC 7591 detail is present", () => {
    renderWithMantine(
      <ClientSettingsForm
        settings={EMPTY_CLIENT_SETTINGS}
        expandedSections={[]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
        registrationError={{}}
      />,
    );
    expect(
      screen.getByText(
        "The authorization server rejected client registration.",
      ),
    ).toBeInTheDocument();
  });

  it("omits the rejection alert when there is no registration error", () => {
    renderWithMantine(
      <ClientSettingsForm
        settings={EMPTY_CLIENT_SETTINGS}
        expandedSections={[]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByText("Client registration was rejected"),
    ).not.toBeInTheDocument();
  });

  it("reflects DCR's deprecated-in-favor-of-CIMD status in the CIMD section", () => {
    renderWithMantine(
      <ClientSettingsForm
        settings={EMPTY_CLIENT_SETTINGS}
        expandedSections={["cimd"]}
        onExpandedSectionsChange={vi.fn()}
        onSettingsChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/deprecated in favor of/i)).toBeInTheDocument();
  });
});
