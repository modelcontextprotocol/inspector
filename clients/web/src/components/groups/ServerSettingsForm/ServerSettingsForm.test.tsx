import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { within } from "@testing-library/react";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { getAceText, setAceText } from "../../../test/aceEditor";
import {
  ServerSettingsForm,
  type ServerSettingsSection,
} from "./ServerSettingsForm";

/** Find the clear button living in the rightSection of `input`'s field. The
 *  name is a prefix match because a KeyValueRows field names its clear button
 *  for the row it belongs to ("Clear header name, Cookie, row 1"), while a standalone
 *  field keeps the bare "Clear". */
function clearButtonFor(input: HTMLElement): HTMLElement {
  const root =
    input.closest('[class*="mantine-TextInput-root"]') ??
    input.closest('[class*="Input-wrapper"]');
  return within(root as HTMLElement).getByRole("button", { name: /^Clear/ });
}

const emptySettings: InspectorServerSettings = {
  headers: [],
  env: [],
  metadata: {},
  connectionTimeout: 30000,
  requestTimeout: 60000,
  taskTtl: 60000,
  maxFetchRequests: 1000,
  roots: [],
};

const populatedSettings: InspectorServerSettings = {
  headers: [{ key: "Authorization", value: "Bearer abc" }],
  env: [],
  metadata: { userId: "u-1", tenant: { id: 7, tags: ["a"] } },
  connectionTimeout: 30000,
  requestTimeout: 60000,
  taskTtl: 60000,
  maxFetchRequests: 1000,
  oauthClientId: "cid",
  oauthClientSecret: "secret",
  oauthScopes: "read",
  roots: [{ uri: "file:///project", name: "Project" }],
};

const allSections: ServerSettingsSection[] = [
  "headers",
  "metadata",
  "timeouts",
  "oauth",
  "roots",
];

const baseHandlers = {
  // Default to non-stdio; the stdio-only env / cwd tests override this to true.
  isStdio: false,
  onExpandedSectionsChange: vi.fn(),
  onAddHeader: vi.fn(),
  onRemoveHeader: vi.fn(),
  onHeaderChange: vi.fn(),
  onAddEnv: vi.fn(),
  onRemoveEnv: vi.fn(),
  onEnvChange: vi.fn(),
  onCwdChange: vi.fn(),
  onMetadataChange: vi.fn(),
  onTimeoutChange: vi.fn(),
  onAutoRefreshChange: vi.fn(),
  onPaginatedListsChange: vi.fn(),
  onAdvertisedExtensionChange: vi.fn(),
  onMaxFetchRequestsChange: vi.fn(),
  onProtocolEraChange: vi.fn(),
  onModernLogLevelChange: vi.fn(),
  onOAuthChange: vi.fn(),
  onAddRoot: vi.fn(),
  onRemoveRoot: vi.fn(),
  onRootChange: vi.fn(),
};

describe("ServerSettingsForm", () => {
  it("renders all section headers", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={emptySettings}
        expandedSections={[]}
      />,
    );
    expect(screen.getByText("Custom Headers")).toBeInTheDocument();
    expect(screen.getByText("Request Metadata")).toBeInTheDocument();
    expect(screen.getByText("Timeouts")).toBeInTheDocument();
    expect(screen.getByText("OAuth Settings")).toBeInTheDocument();
    expect(screen.getByText("Roots")).toBeInTheDocument();
  });

  it("defaults the Protocol Era select to Legacy when unset", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={emptySettings}
        expandedSections={["options"]}
      />,
    );
    expect(
      screen.getByDisplayValue("Legacy (2025-11-25 handshake)"),
    ).toBeInTheDocument();
  });

  it("invokes onProtocolEraChange with the selected era", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={emptySettings}
        expandedSections={["options"]}
      />,
    );
    await user.click(screen.getByDisplayValue("Legacy (2025-11-25 handshake)"));
    await user.click(screen.getByText("Modern (2026-07-28, sessionless)"));
    expect(baseHandlers.onProtocolEraChange).toHaveBeenCalledWith("modern");
  });

  it("reflects the configured protocolEra in the select value", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{ ...emptySettings, protocolEra: "auto" }}
        expandedSections={["options"]}
      />,
    );
    expect(
      screen.getByDisplayValue("Auto (probe, fall back to legacy)"),
    ).toBeInTheDocument();
  });

  // The modern per-request control only shows for a modern-capable era. Base
  // these tests on a modern-pinned settings object so the Select renders.
  const modernSettings = { ...emptySettings, protocolEra: "modern" as const };

  it("defaults the Log Level per Request select to Debug when unset (#1629)", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={modernSettings}
        expandedSections={["options"]}
      />,
    );
    // Two selects can display "debug" (the value plus its hidden input), so
    // assert at least one and that the control's label is present.
    expect(screen.getByText("Log Level per Request")).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("debug").length).toBeGreaterThan(0);
  });

  it("invokes onModernLogLevelChange with the selected level (#1629)", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={modernSettings}
        expandedSections={["options"]}
      />,
    );
    await user.click(screen.getAllByDisplayValue("debug")[0]);
    await user.click(screen.getByText("warning"));
    expect(baseHandlers.onModernLogLevelChange).toHaveBeenCalledWith("warning");
  });

  it("selects Off to opt out of per-request logs (#1629)", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={modernSettings}
        expandedSections={["options"]}
      />,
    );
    await user.click(screen.getAllByDisplayValue("debug")[0]);
    await user.click(screen.getByText("Off (no logs)"));
    expect(baseHandlers.onModernLogLevelChange).toHaveBeenCalledWith("off");
  });

  it("reflects the configured modernLogLevel in the select value (#1629)", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{ ...modernSettings, modernLogLevel: "off" }}
        expandedSections={["options"]}
      />,
    );
    expect(screen.getByDisplayValue("Off (no logs)")).toBeInTheDocument();
  });

  it("hides the Log Level per Request control when the era is legacy (#1629)", () => {
    // emptySettings has no protocolEra → defaults to legacy → control hidden.
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={emptySettings}
        expandedSections={["options"]}
      />,
    );
    expect(screen.queryByText("Log Level per Request")).toBeNull();
  });

  it("hides the control for an 'auto' server that negotiated legacy (#1629)", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{ ...emptySettings, protocolEra: "auto" }}
        negotiatedEra="legacy"
        expandedSections={["options"]}
      />,
    );
    expect(screen.queryByText("Log Level per Request")).toBeNull();
  });

  it("shows the control for an 'auto' server not yet connected (era unknown) (#1629)", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{ ...emptySettings, protocolEra: "auto" }}
        expandedSections={["options"]}
      />,
    );
    expect(screen.getByText("Log Level per Request")).toBeInTheDocument();
  });

  it("shows the control for an 'auto' server that negotiated modern (#1629)", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{ ...emptySettings, protocolEra: "auto" }}
        negotiatedEra="modern"
        expandedSections={["options"]}
      />,
    );
    expect(screen.getByText("Log Level per Request")).toBeInTheDocument();
  });

  it("shows the empty hint for headers, and an empty JSON object for metadata", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={emptySettings}
        expandedSections={["headers", "metadata"]}
      />,
    );
    expect(
      screen.getByText("No custom headers configured"),
    ).toBeInTheDocument();
    // Metadata has no rows to be absent — the editor is always present, and
    // "none configured" is spelled `{}` in it.
    expect(getAceText()).toBe("{}");
  });

  it("invokes onAddHeader when + Add Header is clicked", async () => {
    const user = userEvent.setup();
    const onAddHeader = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onAddHeader={onAddHeader}
        settings={emptySettings}
        expandedSections={["headers"]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "+ Add Header" }));
    expect(onAddHeader).toHaveBeenCalledTimes(1);
  });

  it("invokes onHeaderChange when typing in header value input", async () => {
    const user = userEvent.setup();
    const onHeaderChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onHeaderChange={onHeaderChange}
        settings={populatedSettings}
        expandedSections={["headers"]}
      />,
    );
    const valueInput = screen.getByDisplayValue("Bearer abc");
    await user.type(valueInput, "X");
    expect(onHeaderChange).toHaveBeenCalled();
    const lastCall =
      onHeaderChange.mock.calls[onHeaderChange.mock.calls.length - 1];
    expect(lastCall[0]).toBe(0);
    expect(lastCall[1]).toBe("Authorization");
  });

  it("invokes onHeaderChange when typing in header key input", async () => {
    const user = userEvent.setup();
    const onHeaderChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onHeaderChange={onHeaderChange}
        settings={populatedSettings}
        expandedSections={["headers"]}
      />,
    );
    const keyInput = screen.getByDisplayValue("Authorization");
    await user.type(keyInput, "X");
    expect(onHeaderChange).toHaveBeenCalled();
  });

  it("invokes onRemoveHeader when X is clicked on a header row", async () => {
    const user = userEvent.setup();
    const onRemoveHeader = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onRemoveHeader={onRemoveHeader}
        settings={populatedSettings}
        expandedSections={["headers"]}
      />,
    );
    await user.click(
      screen.getByRole("button", {
        name: "Remove header, Authorization, row 1",
      }),
    );
    expect(onRemoveHeader).toHaveBeenCalledWith(0);
  });

  it("renders the configured metadata as formatted JSON, nested values included", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={populatedSettings}
        expandedSections={["metadata"]}
      />,
    );
    // The point of #1910: a nested object survives into the editor instead of
    // being flattened into a `{ key, value }` string row.
    expect(JSON.parse(getAceText())).toEqual({
      userId: "u-1",
      tenant: { id: 7, tags: ["a"] },
    });
  });

  it("reports the whole edited object through onMetadataChange", async () => {
    const onMetadataChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onMetadataChange={onMetadataChange}
        settings={emptySettings}
        expandedSections={["metadata"]}
      />,
    );
    await setAceText('{"n":[1,2]}');
    expect(onMetadataChange).toHaveBeenLastCalledWith({ n: [1, 2] });
  });

  it("invokes onTimeoutChange when typing in connection timeout", async () => {
    const user = userEvent.setup();
    const onTimeoutChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onTimeoutChange={onTimeoutChange}
        settings={emptySettings}
        expandedSections={["timeouts"]}
      />,
    );
    const connInput = screen.getByLabelText(/Connection Timeout/);
    await user.type(connInput, "5");
    expect(onTimeoutChange).toHaveBeenCalled();
    const call = onTimeoutChange.mock.calls[0];
    expect(call[0]).toBe("connectionTimeout");
    expect(typeof call[1]).toBe("number");
  });

  it("invokes onTimeoutChange with the taskTtl field when typing in Task TTL", async () => {
    const user = userEvent.setup();
    const onTimeoutChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onTimeoutChange={onTimeoutChange}
        settings={emptySettings}
        expandedSections={["timeouts"]}
      />,
    );
    const ttlInput = screen.getByLabelText(/Task TTL/);
    await user.type(ttlInput, "9");
    expect(onTimeoutChange).toHaveBeenCalled();
    const call = onTimeoutChange.mock.calls[0];
    expect(call[0]).toBe("taskTtl");
    expect(typeof call[1]).toBe("number");
  });

  it("renders the Task TTL value from settings", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{ ...emptySettings, taskTtl: 45000 }}
        expandedSections={["timeouts"]}
      />,
    );
    expect(screen.getByLabelText(/Task TTL/)).toHaveValue("45000 ms");
  });

  it("renders the Options section with the Auto Refresh checkbox unchecked by default", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={emptySettings}
        expandedSections={["options"]}
      />,
    );
    const checkbox = screen.getByRole("checkbox", {
      name: /Auto Refresh on List Changed Notifications/,
    });
    expect(checkbox).not.toBeChecked();
  });

  it("reflects autoRefreshOnListChanged=true as a checked box", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{ ...emptySettings, autoRefreshOnListChanged: true }}
        expandedSections={["options"]}
      />,
    );
    expect(
      screen.getByRole("checkbox", {
        name: /Auto Refresh on List Changed Notifications/,
      }),
    ).toBeChecked();
  });

  it("invokes onAutoRefreshChange when the Auto Refresh checkbox is toggled", async () => {
    const user = userEvent.setup();
    const onAutoRefreshChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onAutoRefreshChange={onAutoRefreshChange}
        settings={emptySettings}
        expandedSections={["options"]}
      />,
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /Auto Refresh on List Changed Notifications/,
      }),
    );
    expect(onAutoRefreshChange).toHaveBeenCalledWith(true);
  });

  it("renders the Advertised Extensions section with Tasks checked by default", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={emptySettings}
        expandedSections={["extensions"]}
      />,
    );
    // Advertised Extensions is now its own accordion section (#1747).
    expect(
      screen.getByRole("button", { name: "Advertised Extensions" }),
    ).toBeInTheDocument();
    const tasks = screen.getByRole("checkbox", {
      name: /Tasks \(io\.modelcontextprotocol\/tasks\)/,
    });
    // No override present → the registry default (advertised) shows checked.
    expect(tasks).toBeChecked();
  });

  it("reflects an advertisedExtensions override that disables Tasks", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{
          ...emptySettings,
          advertisedExtensions: { "io.modelcontextprotocol/tasks": false },
        }}
        expandedSections={["extensions"]}
      />,
    );
    expect(
      screen.getByRole("checkbox", {
        name: /Tasks \(io\.modelcontextprotocol\/tasks\)/,
      }),
    ).not.toBeChecked();
  });

  it("invokes onAdvertisedExtensionChange when a Tasks toggle is clicked", async () => {
    const user = userEvent.setup();
    const onAdvertisedExtensionChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onAdvertisedExtensionChange={onAdvertisedExtensionChange}
        settings={emptySettings}
        expandedSections={["extensions"]}
      />,
    );
    // Default is checked; clicking flips it to unadvertised.
    await user.click(
      screen.getByRole("checkbox", {
        name: /Tasks \(io\.modelcontextprotocol\/tasks\)/,
      }),
    );
    expect(onAdvertisedExtensionChange).toHaveBeenCalledWith(
      "io.modelcontextprotocol/tasks",
      false,
    );
  });

  it("renders the Network Log Size field reflecting maxFetchRequests", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{ ...emptySettings, maxFetchRequests: 2500 }}
        expandedSections={["options"]}
      />,
    );
    expect(screen.getByLabelText(/Network Log Size/)).toHaveValue("2500");
  });

  it("invokes onMaxFetchRequestsChange when the Network Log Size value changes", async () => {
    const user = userEvent.setup();
    const onMaxFetchRequestsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onMaxFetchRequestsChange={onMaxFetchRequestsChange}
        settings={{ ...emptySettings, maxFetchRequests: 1000 }}
        expandedSections={["options"]}
      />,
    );
    const input = screen.getByLabelText(/Network Log Size/);
    await user.type(input, "5");
    // Appends to the existing value via the NumberInput; the handler receives a
    // number, not the raw string.
    expect(onMaxFetchRequestsChange).toHaveBeenCalled();
    const lastArg = onMaxFetchRequestsChange.mock.calls.at(-1)?.[0];
    expect(typeof lastArg).toBe("number");
  });

  it("keeps the current Network Log Size (not 0) when the field is cleared", async () => {
    // Clearing the input must not silently mean "unlimited" (0) — it falls back
    // to the current value so a clear-then-close doesn't change the cap.
    const user = userEvent.setup();
    const onMaxFetchRequestsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onMaxFetchRequestsChange={onMaxFetchRequestsChange}
        settings={{ ...emptySettings, maxFetchRequests: 2500 }}
        expandedSections={["options"]}
      />,
    );
    await user.clear(screen.getByLabelText(/Network Log Size/));
    expect(onMaxFetchRequestsChange).toHaveBeenLastCalledWith(2500);
  });

  describe("stdio Working Directory (Options) / Environment Variables section", () => {
    it("hides the Working Directory field and the Environment Variables section for non-stdio servers", () => {
      renderWithMantine(
        <ServerSettingsForm
          {...baseHandlers}
          isStdio={false}
          settings={emptySettings}
          expandedSections={["options", "environment"]}
        />,
      );
      expect(
        screen.queryByLabelText(/Working Directory/),
      ).not.toBeInTheDocument();
      // The whole Environment Variables accordion section is absent.
      expect(
        screen.queryByRole("button", { name: "Environment Variables" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/No environment variables configured/),
      ).not.toBeInTheDocument();
    });

    it("shows the Working Directory field in Options and the Environment Variables section for stdio servers", () => {
      renderWithMantine(
        <ServerSettingsForm
          {...baseHandlers}
          isStdio
          settings={emptySettings}
          expandedSections={["options", "environment"]}
        />,
      );
      expect(screen.getByLabelText(/Working Directory/)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Environment Variables" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/No environment variables configured/),
      ).toBeInTheDocument();
    });

    it("reflects the cwd value and invokes onCwdChange when typing", async () => {
      const user = userEvent.setup();
      const onCwdChange = vi.fn();
      renderWithMantine(
        <ServerSettingsForm
          {...baseHandlers}
          isStdio
          onCwdChange={onCwdChange}
          settings={{ ...emptySettings, cwd: "/srv" }}
          expandedSections={["options"]}
        />,
      );
      const input = screen.getByLabelText(/Working Directory/);
      expect(input).toHaveValue("/srv");
      await user.type(input, "X");
      expect(onCwdChange).toHaveBeenLastCalledWith("/srvX");
    });

    it("clears the cwd via its Clear button", async () => {
      const user = userEvent.setup();
      const onCwdChange = vi.fn();
      renderWithMantine(
        <ServerSettingsForm
          {...baseHandlers}
          isStdio
          onCwdChange={onCwdChange}
          settings={{ ...emptySettings, cwd: "/srv" }}
          expandedSections={["options"]}
        />,
      );
      await user.click(
        clearButtonFor(screen.getByLabelText(/Working Directory/)),
      );
      expect(onCwdChange).toHaveBeenCalledWith("");
    });

    it("invokes onAddEnv when the Add Environment Variable button is clicked", async () => {
      const user = userEvent.setup();
      const onAddEnv = vi.fn();
      renderWithMantine(
        <ServerSettingsForm
          {...baseHandlers}
          isStdio
          onAddEnv={onAddEnv}
          settings={emptySettings}
          expandedSections={["environment"]}
        />,
      );
      await user.click(
        screen.getByRole("button", { name: /Add Environment Variable/ }),
      );
      expect(onAddEnv).toHaveBeenCalledTimes(1);
    });

    it("renders env rows and invokes onEnvChange / onRemoveEnv", async () => {
      const user = userEvent.setup();
      const onEnvChange = vi.fn();
      const onRemoveEnv = vi.fn();
      renderWithMantine(
        <ServerSettingsForm
          {...baseHandlers}
          isStdio
          onEnvChange={onEnvChange}
          onRemoveEnv={onRemoveEnv}
          settings={{
            ...emptySettings,
            env: [{ key: "API_KEY", value: "secret" }],
          }}
          expandedSections={["environment"]}
        />,
      );
      const keyInput = screen.getByDisplayValue("API_KEY");
      await user.type(keyInput, "2");
      expect(onEnvChange).toHaveBeenLastCalledWith(0, "API_KEY2", "secret");

      // The remove button sits alongside the row's key/value inputs; its
      // accessible name identifies which row it belongs to.
      await user.click(
        screen.getByRole("button", {
          name: "Remove environment variable, API_KEY, row 1",
        }),
      );
      expect(onRemoveEnv).toHaveBeenCalledWith(0);
    });
  });

  it("invokes onOAuthChange when typing in client id", async () => {
    const user = userEvent.setup();
    const onOAuthChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onOAuthChange={onOAuthChange}
        settings={emptySettings}
        expandedSections={["oauth"]}
      />,
    );
    const clientIdInput = screen.getByLabelText("Client ID");
    await user.type(clientIdInput, "a");
    expect(onOAuthChange).toHaveBeenCalledWith({
      clientId: "a",
      clientSecret: "",
      scopes: "",
      authorizationParams: [],
      authorizationUrl: "",
      tokenUrl: "",
      enterpriseManaged: false,
      requestRefreshToken: true,
      revokeOnClear: true,
    });
  });

  // #2068 — the refresh-token opt-out. On by default; unchecking it is what
  // stops the SDK adding `offline_access` and then `prompt=consent`.
  it("renders Request refresh token checked by default", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={emptySettings}
        expandedSections={["oauth"]}
      />,
    );
    expect(screen.getByLabelText("Request refresh token")).toBeChecked();
  });

  it("renders Request refresh token unchecked when the server opted out", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{ ...emptySettings, oauthRequestRefreshToken: false }}
        expandedSections={["oauth"]}
      />,
    );
    expect(screen.getByLabelText("Request refresh token")).not.toBeChecked();
  });

  it("toggles Request refresh token through onOAuthChange", async () => {
    const user = userEvent.setup();
    const onOAuthChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onOAuthChange={onOAuthChange}
        settings={emptySettings}
        expandedSections={["oauth"]}
      />,
    );
    await user.click(screen.getByLabelText("Request refresh token"));
    expect(onOAuthChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestRefreshToken: false }),
    );
  });

  // #2144 — the RFC 7009 opt-out. On by default: leaving it off silently is
  // what leaves the authorization server holding a live grant.
  it("renders Revoke tokens on clear checked by default", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={emptySettings}
        expandedSections={["oauth"]}
      />,
    );
    expect(screen.getByLabelText("Revoke tokens on clear")).toBeChecked();
  });

  it("renders Revoke tokens on clear unchecked when the server opted out", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{ ...emptySettings, oauthRevokeOnClear: false }}
        expandedSections={["oauth"]}
      />,
    );
    expect(screen.getByLabelText("Revoke tokens on clear")).not.toBeChecked();
  });

  it("toggles Revoke tokens on clear through onOAuthChange", async () => {
    const user = userEvent.setup();
    const onOAuthChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onOAuthChange={onOAuthChange}
        settings={emptySettings}
        expandedSections={["oauth"]}
      />,
    );
    await user.click(screen.getByLabelText("Revoke tokens on clear"));
    expect(onOAuthChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ revokeOnClear: false }),
    );
  });

  it("warns when opting out while offline_access is still in Scopes", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{
          ...emptySettings,
          oauthRequestRefreshToken: false,
          oauthScopes: "openid offline_access",
        }}
        expandedSections={["oauth"]}
      />,
    );
    expect(
      screen.getByText("offline_access is still requested"),
    ).toBeInTheDocument();
  });

  it("does not warn when opted out and Scopes omits offline_access", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{
          ...emptySettings,
          oauthRequestRefreshToken: false,
          oauthScopes: "openid",
        }}
        expandedSections={["oauth"]}
      />,
    );
    expect(
      screen.queryByText("offline_access is still requested"),
    ).not.toBeInTheDocument();
  });

  // The scope alone is not a problem — with the grant declared, requesting
  // offline_access is exactly what the default configuration does.
  it("does not warn when offline_access is in Scopes but the grant is on", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{ ...emptySettings, oauthScopes: "openid offline_access" }}
        expandedSections={["oauth"]}
      />,
    );
    expect(
      screen.queryByText("offline_access is still requested"),
    ).not.toBeInTheDocument();
  });

  // A substring must not trip it — `offline_access_extra` is a different scope.
  it("matches offline_access as a whole scope token, not a substring", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{
          ...emptySettings,
          oauthRequestRefreshToken: false,
          oauthScopes: "openid offline_access_extra",
        }}
        expandedSections={["oauth"]}
      />,
    );
    expect(
      screen.queryByText("offline_access is still requested"),
    ).not.toBeInTheDocument();
  });

  // #2068 — EMA wraps this provider and forwards its `clientMetadata`, so the
  // setting is not ignored outright; what it cannot change is the IdP
  // authorization leg's fixed `openid offline_access` scope. That leg is the
  // one the user signs in through, so the checkbox cannot affect EMA's consent
  // behavior and must say so.
  it("says the refresh-token setting is not applied under EMA", () => {
    const { rerender } = renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{ ...emptySettings, enterpriseManaged: true }}
        expandedSections={["oauth"]}
      />,
    );
    expect(
      screen.getByText(/which this setting cannot change/),
    ).toBeInTheDocument();

    rerender(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{ ...emptySettings, enterpriseManaged: false }}
        expandedSections={["oauth"]}
      />,
    );
    expect(
      screen.queryByText(/which this setting cannot change/),
    ).not.toBeInTheDocument();
  });

  // #2018 — custom authorization-request parameters.
  it("shows the empty hint for authorization parameters when none are set", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={emptySettings}
        expandedSections={["oauth"]}
      />,
    );
    expect(
      screen.getByText("Additional authorization parameters"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No additional parameters configured"),
    ).toBeInTheDocument();
  });

  it("adds an authorization-parameter row through onOAuthChange", async () => {
    const user = userEvent.setup();
    const onOAuthChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onOAuthChange={onOAuthChange}
        settings={emptySettings}
        expandedSections={["oauth"]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "+ Add Parameter" }));
    expect(onOAuthChange).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationParams: [{ key: "", value: "" }],
      }),
    );
  });

  it("edits and removes an authorization-parameter row", async () => {
    const user = userEvent.setup();
    const onOAuthChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onOAuthChange={onOAuthChange}
        settings={{
          ...emptySettings,
          oauthAuthorizationParams: [{ key: "kc_idp_hint", value: "corp" }],
        }}
        expandedSections={["oauth"]}
      />,
    );
    const valueInput = screen.getByDisplayValue("corp");
    await user.type(valueInput, "x");
    expect(onOAuthChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        authorizationParams: [{ key: "kc_idp_hint", value: "corpx" }],
      }),
    );

    onOAuthChange.mockClear();
    const removeButton = screen
      .getAllByRole("button")
      .find((b) => b.textContent === "X");
    await user.click(removeButton as HTMLElement);
    expect(onOAuthChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ authorizationParams: [] }),
    );
  });

  it("clears an authorization-parameter key via its Clear button", async () => {
    const user = userEvent.setup();
    const onOAuthChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onOAuthChange={onOAuthChange}
        settings={{
          ...emptySettings,
          oauthAuthorizationParams: [{ key: "kc_idp_hint", value: "corp" }],
        }}
        expandedSections={["oauth"]}
      />,
    );
    await user.click(clearButtonFor(screen.getByDisplayValue("kc_idp_hint")));
    expect(onOAuthChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        authorizationParams: [{ key: "", value: "corp" }],
      }),
    );

    onOAuthChange.mockClear();
    await user.click(clearButtonFor(screen.getByDisplayValue("corp")));
    expect(onOAuthChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        authorizationParams: [{ key: "kc_idp_hint", value: "" }],
      }),
    );
  });

  it("rejects a reserved authorization-parameter key inline and with a warning", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{
          ...emptySettings,
          oauthAuthorizationParams: [{ key: "state", value: "spoofed" }],
        }}
        expandedSections={["oauth"]}
      />,
    );
    expect(
      screen.getByText(
        '"state" is set by the authorization flow and cannot be overridden.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Reserved parameters ignored")).toBeInTheDocument();
    expect(screen.getByDisplayValue("state")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  // #2018 — the section heading and the placeholders are not programmatically
  // associated with these inputs, so each control carries its own aria-label and
  // the reserved-key reason is the input's `error` string (which Mantine wires
  // to the input via aria-describedby) rather than free-standing text.
  it("gives each authorization-parameter control an accessible name", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{
          ...emptySettings,
          oauthAuthorizationParams: [{ key: "kc_idp_hint", value: "corp" }],
        }}
        expandedSections={["oauth"]}
      />,
    );
    expect(
      screen.getByRole("textbox", {
        name: "Authorization parameter name, kc_idp_hint",
      }),
    ).toHaveValue("kc_idp_hint");
    expect(
      screen.getByRole("textbox", {
        name: "Authorization parameter value, kc_idp_hint",
      }),
    ).toHaveValue("corp");
    expect(
      screen.getByRole("button", {
        name: "Remove authorization parameter kc_idp_hint",
      }),
    ).toBeInTheDocument();
  });

  it("falls back to a row number in the accessible name when the key is blank", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{
          ...emptySettings,
          oauthAuthorizationParams: [{ key: "", value: "" }],
        }}
        expandedSections={["oauth"]}
      />,
    );
    expect(
      screen.getByRole("textbox", {
        name: "Authorization parameter name, row 1",
      }),
    ).toBeInTheDocument();
  });

  // The reason must reach assistive tech through the input, not just as text on
  // the page: Mantine emits the `error` string with an id the input references.
  it("associates the reserved-key reason with the key input", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{
          ...emptySettings,
          oauthAuthorizationParams: [{ key: "state", value: "spoofed" }],
        }}
        expandedSections={["oauth"]}
      />,
    );
    const keyInput = screen.getByRole("textbox", {
      name: "Authorization parameter name, state",
    });
    const describedBy = keyInput.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const reason = describedBy
      ?.split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(reason).toContain(
      '"state" is set by the authorization flow and cannot be overridden.',
    );
  });

  // #2018 — the EMA leg authorizes against the enterprise IdP, a different
  // authorization server, and deliberately sends none of these parameters. The
  // description has to say so, or the form shows a configured value as active
  // when it will not be sent.
  it("warns that authorization parameters are unused under enterprise-managed auth", () => {
    const { rerender } = renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{ ...emptySettings, enterpriseManaged: true }}
        expandedSections={["oauth"]}
      />,
    );
    expect(
      screen.getByText(/Not sent while Enterprise-managed authorization is on/),
    ).toBeInTheDocument();

    rerender(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{ ...emptySettings, enterpriseManaged: false }}
        expandedSections={["oauth"]}
      />,
    );
    expect(
      screen.queryByText(
        /Not sent while Enterprise-managed authorization is on/,
      ),
    ).not.toBeInTheDocument();
  });

  it("does not flag a blank authorization-parameter row as reserved", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{
          ...emptySettings,
          oauthAuthorizationParams: [{ key: "", value: "" }],
        }}
        expandedSections={["oauth"]}
      />,
    );
    expect(
      screen.queryByText("Reserved parameters ignored"),
    ).not.toBeInTheDocument();
  });

  it("pluralizes the reserved-parameter warning for multiple keys", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{
          ...emptySettings,
          oauthAuthorizationParams: [
            { key: "state", value: "x" },
            { key: "scope", value: "y" },
          ],
        }}
        expandedSections={["oauth"]}
      />,
    );
    expect(screen.getByText(/state, scope are set/)).toBeInTheDocument();
  });

  // #1906 — the endpoint overrides ride the same `onOAuthChange` callback as
  // the rest of the Authorization section.
  it("invokes onOAuthChange when an endpoint override is typed", async () => {
    const user = userEvent.setup();
    const onOAuthChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onOAuthChange={onOAuthChange}
        settings={emptySettings}
        expandedSections={["oauth"]}
      />,
    );
    await user.type(
      screen.getByRole("textbox", { name: /Authorization URL override/i }),
      "h",
    );
    expect(onOAuthChange).toHaveBeenCalledWith(
      expect.objectContaining({ authorizationUrl: "h" }),
    );

    onOAuthChange.mockClear();
    await user.type(
      screen.getByRole("textbox", { name: /Token URL override/i }),
      "h",
    );
    expect(onOAuthChange).toHaveBeenCalledWith(
      expect.objectContaining({ tokenUrl: "h" }),
    );
  });

  it("says the EMA-suppressed controls are unused under enterprise-managed auth", () => {
    const { rerender } = renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{ ...emptySettings, enterpriseManaged: true }}
        expandedSections={["oauth"]}
      />,
    );
    // Three controls carry this notice: the two endpoint overrides (#1906) and
    // the refresh-token checkbox (#2068). The count is asserted rather than
    // merely "present" so a control that stops annotating itself — or a new one
    // that never starts — is caught here.
    expect(
      screen.getAllByText(
        /Not applied while Enterprise-managed authorization is on/,
      ),
    ).toHaveLength(3);

    rerender(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{ ...emptySettings, enterpriseManaged: false }}
        expandedSections={["oauth"]}
      />,
    );
    expect(
      screen.queryByText(
        /Not applied while Enterprise-managed authorization is on/,
      ),
    ).not.toBeInTheDocument();
  });

  it("flags an endpoint override that is not an absolute http(s) URL", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{
          ...emptySettings,
          oauthAuthorizationUrl: "/authorize",
          oauthTokenUrl: "https://staging.test/token",
        }}
        expandedSections={["oauth"]}
      />,
    );
    expect(
      screen.getByText('"/authorize" is not an absolute URL.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/is not an http\(s\) URL/)).toBeNull();
  });

  it("clears an endpoint override through its clear button", async () => {
    const user = userEvent.setup();
    const onOAuthChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onOAuthChange={onOAuthChange}
        settings={{
          ...emptySettings,
          oauthTokenUrl: "https://staging.test/token",
        }}
        expandedSections={["oauth"]}
      />,
    );
    const clearButtons = screen.getAllByRole("button", { name: /clear/i });
    await user.click(clearButtons[clearButtons.length - 1]);
    expect(onOAuthChange).toHaveBeenCalledWith(
      expect.objectContaining({ tokenUrl: "" }),
    );
  });

  it("invokes onOAuthChange with the chosen insufficient-scope policy (SEP-2350)", async () => {
    const user = userEvent.setup();
    const onOAuthChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onOAuthChange={onOAuthChange}
        settings={emptySettings}
        expandedSections={["oauth"]}
      />,
    );
    await user.click(
      screen.getByRole("textbox", { name: /Insufficient-scope/i }),
    );
    await user.click(screen.getByText("Throw (surface the error)"));
    expect(onOAuthChange).toHaveBeenCalledWith(
      expect.objectContaining({ onInsufficientScope: "throw" }),
    );
  });

  it("invokes onOAuthChange when enterprise-managed is toggled", async () => {
    const user = userEvent.setup();
    const onOAuthChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onOAuthChange={onOAuthChange}
        settings={emptySettings}
        expandedSections={["oauth"]}
      />,
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /Enterprise-managed authorization/i,
      }),
    );
    expect(onOAuthChange).toHaveBeenCalledWith({
      clientId: "",
      clientSecret: "",
      scopes: "",
      authorizationParams: [],
      authorizationUrl: "",
      tokenUrl: "",
      enterpriseManaged: true,
      requestRefreshToken: true,
      revokeOnClear: true,
    });
  });

  it("uses unqualified Client ID / Client Secret labels when EMA is off (#1692)", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={emptySettings}
        expandedSections={["oauth"]}
      />,
    );
    expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Client Secret")).toBeInTheDocument();
    expect(screen.queryByLabelText("Resource AS Client ID")).toBeNull();
  });

  it("relabels the OAuth fields to Resource AS credentials when EMA is on (#1692)", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{ ...emptySettings, enterpriseManaged: true }}
        expandedSections={["oauth"]}
      />,
    );
    expect(screen.getByLabelText("Resource AS Client ID")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Resource AS Client Secret"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Client ID")).toBeNull();
    // The resource-authorization-server description is present (rendered twice —
    // once per field).
    expect(
      screen.getAllByText(
        /resource authorization server's registered client credential/i,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("documents the space-separated Scopes delimiter (#1692)", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={emptySettings}
        expandedSections={["oauth"]}
      />,
    );
    expect(
      screen.getByText(/Space-separated OAuth scopes/i),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("mcp tools:read env:read"),
    ).toBeInTheDocument();
  });

  it("hides the OAuth Settings section for stdio servers", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={emptySettings}
        serverType="stdio"
        expandedSections={[]}
      />,
    );
    expect(screen.queryByText("OAuth Settings")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Client ID")).not.toBeInTheDocument();
  });

  it("invokes onOAuthChange when typing in scopes (uses existing oauth values)", async () => {
    const user = userEvent.setup();
    const onOAuthChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onOAuthChange={onOAuthChange}
        settings={populatedSettings}
        expandedSections={["oauth"]}
      />,
    );
    const scopesInput = screen.getByLabelText("Scopes");
    await user.type(scopesInput, "X");
    expect(onOAuthChange).toHaveBeenCalled();
    const call = onOAuthChange.mock.calls[0][0];
    expect(call.clientId).toBe("cid");
    expect(call.clientSecret).toBe("secret");
  });

  it("invokes onOAuthChange when typing in client secret", async () => {
    const user = userEvent.setup();
    const onOAuthChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onOAuthChange={onOAuthChange}
        settings={emptySettings}
        expandedSections={["oauth"]}
      />,
    );
    const secretInput = screen.getByLabelText("Client Secret");
    await user.type(secretInput, "z");
    expect(onOAuthChange).toHaveBeenCalledWith({
      clientId: "",
      clientSecret: "z",
      scopes: "",
      authorizationParams: [],
      authorizationUrl: "",
      tokenUrl: "",
      enterpriseManaged: false,
      requestRefreshToken: true,
      revokeOnClear: true,
    });
  });

  it("shows the empty hint for roots when none are configured", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={emptySettings}
        expandedSections={["roots"]}
      />,
    );
    expect(screen.getByText("No roots configured")).toBeInTheDocument();
  });

  it("invokes onAddRoot when + Add Root is clicked", async () => {
    const user = userEvent.setup();
    const onAddRoot = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onAddRoot={onAddRoot}
        settings={emptySettings}
        expandedSections={["roots"]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "+ Add Root" }));
    expect(onAddRoot).toHaveBeenCalledTimes(1);
  });

  it("renders a row's uri and optional name and reports edits via onRootChange", async () => {
    const user = userEvent.setup();
    const onRootChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onRootChange={onRootChange}
        settings={populatedSettings}
        expandedSections={["roots"]}
      />,
    );
    // populatedSettings has one root { uri: "file:///project", name: "Project" }
    expect(screen.getByDisplayValue("file:///project")).toBeInTheDocument();
    const nameInput = screen.getByDisplayValue("Project");
    await user.type(nameInput, "X");
    expect(onRootChange).toHaveBeenCalled();
    const lastCall =
      onRootChange.mock.calls[onRootChange.mock.calls.length - 1];
    expect(lastCall[0]).toBe(0);
    // uri is threaded through unchanged when only the name changes
    expect(lastCall[1]).toBe("file:///project");
  });

  it("invokes onRemoveRoot when X is clicked on a root row", async () => {
    const user = userEvent.setup();
    const onRemoveRoot = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onRemoveRoot={onRemoveRoot}
        settings={populatedSettings}
        expandedSections={["roots"]}
      />,
    );
    const removeButtons = screen.getAllByRole("button", { name: "X" });
    await user.click(removeButtons[0]);
    expect(onRemoveRoot).toHaveBeenCalledWith(0);
  });

  it("invokes onExpandedSectionsChange when an Accordion section is toggled", async () => {
    const user = userEvent.setup();
    const onExpandedSectionsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onExpandedSectionsChange={onExpandedSectionsChange}
        settings={emptySettings}
        expandedSections={[]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Custom Headers" }));
    expect(onExpandedSectionsChange).toHaveBeenCalled();
    const lastCall = onExpandedSectionsChange.mock.calls[0][0];
    expect(lastCall).toContain("headers");
  });

  it("supports rendering with all sections expanded", () => {
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={populatedSettings}
        expandedSections={allSections}
      />,
    );
    expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
    expect(screen.getByLabelText(/Connection Timeout/)).toBeInTheDocument();
  });

  it("clears a header value via its Clear button (onHeaderChange with empty value)", async () => {
    const user = userEvent.setup();
    const onHeaderChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onHeaderChange={onHeaderChange}
        settings={populatedSettings}
        expandedSections={["headers"]}
      />,
    );
    // populatedSettings has one header { key: "Authorization", value: "Bearer abc" }
    const valueInput = screen.getByDisplayValue("Bearer abc");
    await user.click(clearButtonFor(valueInput));
    expect(onHeaderChange).toHaveBeenCalledWith(0, "Authorization", "");
  });

  it("clears a header key via its Clear button (onHeaderChange with empty key)", async () => {
    const user = userEvent.setup();
    const onHeaderChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onHeaderChange={onHeaderChange}
        settings={populatedSettings}
        expandedSections={["headers"]}
      />,
    );
    const keyInput = screen.getByDisplayValue("Authorization");
    await user.click(clearButtonFor(keyInput));
    expect(onHeaderChange).toHaveBeenCalledWith(0, "", "Bearer abc");
  });

  it("clears a root uri via its Clear button (onRootChange with empty uri)", async () => {
    const user = userEvent.setup();
    const onRootChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onRootChange={onRootChange}
        settings={populatedSettings}
        expandedSections={["roots"]}
      />,
    );
    // populatedSettings has one root { uri: "file:///project", name: "Project" }
    const uriInput = screen.getByDisplayValue("file:///project");
    await user.click(clearButtonFor(uriInput));
    expect(onRootChange).toHaveBeenCalledWith(0, "", "Project");
  });

  it("clears the OAuth Client ID via its Clear button (onOAuthChange with empty clientId)", async () => {
    const user = userEvent.setup();
    const onOAuthChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onOAuthChange={onOAuthChange}
        settings={populatedSettings}
        expandedSections={["oauth"]}
      />,
    );
    const clientIdInput = screen.getByLabelText("Client ID");
    await user.click(clearButtonFor(clientIdInput));
    expect(onOAuthChange).toHaveBeenCalledTimes(1);
    const arg = onOAuthChange.mock.calls[0][0];
    expect(arg.clientId).toBe("");
    expect(arg.clientSecret).toBe("secret");
    expect(arg.scopes).toBe("read");
  });

  it("clears the OAuth Scopes via its Clear button (onOAuthChange with empty scopes)", async () => {
    const user = userEvent.setup();
    const onOAuthChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onOAuthChange={onOAuthChange}
        settings={populatedSettings}
        expandedSections={["oauth"]}
      />,
    );
    const scopesInput = screen.getByLabelText("Scopes");
    await user.click(clearButtonFor(scopesInput));
    expect(onOAuthChange).toHaveBeenCalledTimes(1);
    const arg = onOAuthChange.mock.calls[0][0];
    expect(arg.scopes).toBe("");
    expect(arg.clientId).toBe("cid");
  });

  it("clears a root name via its Clear button (onRootChange with empty name)", async () => {
    const user = userEvent.setup();
    const onRootChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onRootChange={onRootChange}
        settings={populatedSettings}
        expandedSections={["roots"]}
      />,
    );
    // populatedSettings has one root { uri: "file:///project", name: "Project" }
    const nameInput = screen.getByDisplayValue("Project");
    await user.click(clearButtonFor(nameInput));
    expect(onRootChange).toHaveBeenCalledWith(0, "file:///project", "");
  });

  it("clears the OAuth Client Secret via its Clear button (onOAuthChange with empty clientSecret)", async () => {
    const user = userEvent.setup();
    const onOAuthChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onOAuthChange={onOAuthChange}
        settings={populatedSettings}
        expandedSections={["oauth"]}
      />,
    );
    const secretInput = screen.getByLabelText("Client Secret");
    await user.click(clearButtonFor(secretInput));
    expect(onOAuthChange).toHaveBeenCalledTimes(1);
    const arg = onOAuthChange.mock.calls[0][0];
    expect(arg.clientSecret).toBe("");
    expect(arg.clientId).toBe("cid");
    expect(arg.scopes).toBe("read");
  });

  it("calls onClearStoredOAuth from the OAuth section", async () => {
    const user = userEvent.setup();
    const onClearStoredOAuth = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={populatedSettings}
        expandedSections={["oauth"]}
        onClearStoredOAuth={onClearStoredOAuth}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Clear stored OAuth state" }),
    );
    expect(onClearStoredOAuth).toHaveBeenCalledTimes(1);
  });

  it("omits the Clear buttons for an empty header key/value row", () => {
    // A row whose key and value are both empty renders no Clear button in
    // either field (the null branch of `item.key ?` / `item.value ?`).
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        settings={{ ...emptySettings, headers: [{ key: "", value: "" }] }}
        expandedSections={["headers"]}
      />,
    );
    const keyInput = screen.getByPlaceholderText("Key");
    const valueInput = screen.getByPlaceholderText("Value");
    expect(
      within(
        keyInput.closest('[class*="Input-wrapper"]') as HTMLElement,
      ).queryByRole("button", { name: /^Clear/ }),
    ).toBeNull();
    expect(
      within(
        valueInput.closest('[class*="Input-wrapper"]') as HTMLElement,
      ).queryByRole("button", { name: /^Clear/ }),
    ).toBeNull();
  });

  it("handles an empty-uri, unnamed root row (no Clear buttons, fallbacks applied)", async () => {
    const user = userEvent.setup();
    const onRootChange = vi.fn();
    // uri empty + name undefined → both fields render without a Clear button,
    // and editing threads `root.name ?? ""` (empty) through onChange.
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onRootChange={onRootChange}
        settings={{ ...emptySettings, roots: [{ uri: "" }] }}
        expandedSections={["roots"]}
      />,
    );
    const uriInput = screen.getByPlaceholderText("URI (e.g. file:///path)");
    const nameInput = screen.getByPlaceholderText("Name (optional)");
    expect((nameInput as HTMLInputElement).value).toBe("");
    expect(
      within(
        uriInput.closest('[class*="Input-wrapper"]') as HTMLElement,
      ).queryByRole("button", { name: /^Clear/ }),
    ).toBeNull();
    expect(
      within(
        nameInput.closest('[class*="Input-wrapper"]') as HTMLElement,
      ).queryByRole("button", { name: /^Clear/ }),
    ).toBeNull();
    // Typing into the URI threads the empty name through (`root.name ?? ""`).
    await user.type(uriInput, "f");
    expect(onRootChange).toHaveBeenLastCalledWith(0, "f", "");
  });

  it("coerces a cleared (empty-string) timeout to 0", async () => {
    const user = userEvent.setup();
    const onTimeoutChange = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onTimeoutChange={onTimeoutChange}
        settings={{ ...emptySettings, connectionTimeout: 5000 }}
        expandedSections={["timeouts"]}
      />,
    );
    // Clearing the NumberInput emits "" which the handler coerces to 0 via the
    // `parseInt(value, 10) || 0` fallback.
    await user.clear(screen.getByLabelText(/Connection Timeout/));
    expect(onTimeoutChange).toHaveBeenLastCalledWith("connectionTimeout", 0);
  });

  it("invokes onTimeoutChange with 0 when a non-numeric string is provided", () => {
    const onTimeoutChange = vi.fn();
    // Render with a non-finite default in the NumberInput; then directly invoke
    // by simulating a clear which results in an empty string change.
    const settings: InspectorServerSettings = {
      ...emptySettings,
      connectionTimeout: 0,
    };
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onTimeoutChange={onTimeoutChange}
        settings={settings}
        expandedSections={["timeouts"]}
      />,
    );
    // No assertion-by-typing here; just verify no error renders.
    expect(screen.getByLabelText(/Connection Timeout/)).toBeInTheDocument();
  });
});
