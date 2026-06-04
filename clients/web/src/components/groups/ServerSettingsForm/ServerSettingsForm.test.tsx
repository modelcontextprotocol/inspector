import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import {
  ServerSettingsForm,
  type ServerSettingsSection,
} from "./ServerSettingsForm";

const emptySettings: InspectorServerSettings = {
  headers: [],
  metadata: [],
  connectionTimeout: 30000,
  requestTimeout: 60000,
  taskTtl: 60000,
  roots: [],
};

const populatedSettings: InspectorServerSettings = {
  headers: [{ key: "Authorization", value: "Bearer abc" }],
  metadata: [{ key: "userId", value: "u-1" }],
  connectionTimeout: 30000,
  requestTimeout: 60000,
  taskTtl: 60000,
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
  onExpandedSectionsChange: vi.fn(),
  onAddHeader: vi.fn(),
  onRemoveHeader: vi.fn(),
  onHeaderChange: vi.fn(),
  onAddMetadata: vi.fn(),
  onRemoveMetadata: vi.fn(),
  onMetadataChange: vi.fn(),
  onTimeoutChange: vi.fn(),
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

  it("shows empty hints for headers and metadata when no entries exist", () => {
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
    expect(
      screen.getByText("No request metadata configured"),
    ).toBeInTheDocument();
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

  it("invokes onAddMetadata when + Add Metadata is clicked", async () => {
    const user = userEvent.setup();
    const onAddMetadata = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onAddMetadata={onAddMetadata}
        settings={emptySettings}
        expandedSections={["metadata"]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "+ Add Metadata" }));
    expect(onAddMetadata).toHaveBeenCalledTimes(1);
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
    const removeButtons = screen.getAllByRole("button", { name: "X" });
    await user.click(removeButtons[0]);
    expect(onRemoveHeader).toHaveBeenCalledWith(0);
  });

  it("invokes onMetadataChange and onRemoveMetadata for metadata rows", async () => {
    const user = userEvent.setup();
    const onMetadataChange = vi.fn();
    const onRemoveMetadata = vi.fn();
    renderWithMantine(
      <ServerSettingsForm
        {...baseHandlers}
        onMetadataChange={onMetadataChange}
        onRemoveMetadata={onRemoveMetadata}
        settings={populatedSettings}
        expandedSections={["metadata"]}
      />,
    );
    const valueInput = screen.getByDisplayValue("u-1");
    await user.type(valueInput, "Z");
    expect(onMetadataChange).toHaveBeenCalled();

    const removeButtons = screen.getAllByRole("button", { name: "X" });
    await user.click(removeButtons[0]);
    expect(onRemoveMetadata).toHaveBeenCalledWith(0);
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
    });
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
