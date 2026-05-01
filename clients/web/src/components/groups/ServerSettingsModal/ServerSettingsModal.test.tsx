import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ServerSettingsModal } from "./ServerSettingsModal";

const initialSettings: InspectorServerSettings = {
  headers: [{ key: "Authorization", value: "Bearer abc" }],
  metadata: [{ key: "userId", value: "u-1" }],
  connectionTimeout: 30000,
  requestTimeout: 60000,
  oauthClientId: "cid",
  oauthClientSecret: "secret",
  oauthScopes: "read",
};

const emptySettings: InspectorServerSettings = {
  headers: [],
  metadata: [],
  connectionTimeout: 30000,
  requestTimeout: 60000,
};

describe("ServerSettingsModal", () => {
  it("does not render content when opened is false", () => {
    renderWithMantine(
      <ServerSettingsModal
        opened={false}
        settings={emptySettings}
        onClose={vi.fn()}
        onSettingsChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("Server Settings")).not.toBeInTheDocument();
  });

  it("renders the modal title and form when opened", () => {
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={emptySettings}
        onClose={vi.fn()}
        onSettingsChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Server Settings")).toBeInTheDocument();
    expect(screen.getByText("Custom Headers")).toBeInTheDocument();
  });

  it("invokes onClose when the CloseButton is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={emptySettings}
        onClose={onClose}
        onSettingsChange={vi.fn()}
      />,
    );
    // Modal renders into a portal on document.body
    const closeBtn = document.querySelector(
      "button.mantine-CloseButton-root",
    ) as HTMLButtonElement | null;
    expect(closeBtn).not.toBeNull();
    await user.click(closeBtn!);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onSettingsChange when adding a header", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={emptySettings}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "+ Add Header" }));
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...emptySettings,
      headers: [{ key: "", value: "" }],
    });
  });

  it("calls onSettingsChange when removing a header", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={initialSettings}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    const removeButtons = screen.getAllByRole("button", { name: "X" });
    await user.click(removeButtons[0]);
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...initialSettings,
      headers: [],
    });
  });

  it("calls onSettingsChange with updated header value when typing", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={initialSettings}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    const valueInput = screen.getByDisplayValue("Bearer abc");
    await user.type(valueInput, "1");
    expect(onSettingsChange).toHaveBeenCalled();
    const lastCall =
      onSettingsChange.mock.calls[onSettingsChange.mock.calls.length - 1][0];
    expect(lastCall.headers[0].key).toBe("Authorization");
    expect(lastCall.headers[0].value).toContain("Bearer abc");
  });

  it("calls onSettingsChange when adding metadata after expanding the section", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={emptySettings}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Request Metadata" }));
    await user.click(screen.getByRole("button", { name: "+ Add Metadata" }));
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...emptySettings,
      metadata: [{ key: "", value: "" }],
    });
  });

  it("calls onSettingsChange when removing metadata", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={initialSettings}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Request Metadata" }));
    const removeButtons = screen.getAllByRole("button", { name: "X" });
    // After expanding metadata, both header and metadata X buttons exist;
    // the metadata X is the last one.
    await user.click(removeButtons[removeButtons.length - 1]);
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...initialSettings,
      metadata: [],
    });
  });

  it("calls onSettingsChange when typing in metadata key/value", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={initialSettings}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Request Metadata" }));
    const valueInput = screen.getByDisplayValue("u-1");
    await user.type(valueInput, "9");
    expect(onSettingsChange).toHaveBeenCalled();
    const lastCall =
      onSettingsChange.mock.calls[onSettingsChange.mock.calls.length - 1][0];
    expect(lastCall.metadata[0].key).toBe("userId");
  });

  it("calls onSettingsChange when changing timeouts", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={emptySettings}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Timeouts" }));
    const connInput = screen.getByLabelText(/Connection Timeout/);
    await user.type(connInput, "5");
    expect(onSettingsChange).toHaveBeenCalled();
    const call = onSettingsChange.mock.calls[0][0];
    expect(typeof call.connectionTimeout).toBe("number");
  });

  it("calls onSettingsChange when changing OAuth fields", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={emptySettings}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "OAuth Settings" }));
    const clientIdInput = screen.getByLabelText("Client ID");
    await user.type(clientIdInput, "a");
    expect(onSettingsChange).toHaveBeenCalled();
    const call = onSettingsChange.mock.calls[0][0];
    expect(call.oauthClientId).toBe("a");
  });

  it("toggles all accordion sections when ListToggle button is clicked", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={emptySettings}
        onClose={vi.fn()}
        onSettingsChange={vi.fn()}
      />,
    );
    const headersControl = screen.getByRole("button", {
      name: "Custom Headers",
    });
    const metadataControl = screen.getByRole("button", {
      name: "Request Metadata",
    });
    const timeoutsControl = screen.getByRole("button", { name: "Timeouts" });
    const oauthControl = screen.getByRole("button", { name: "OAuth Settings" });

    // Initially only "headers" is expanded.
    expect(headersControl.getAttribute("aria-expanded")).toBe("true");
    expect(metadataControl.getAttribute("aria-expanded")).toBe("false");

    // ListToggle is the first button in the header row; click to expand all.
    const allButtons = screen.getAllByRole("button");
    await user.click(allButtons[0]);

    expect(metadataControl.getAttribute("aria-expanded")).toBe("true");
    expect(timeoutsControl.getAttribute("aria-expanded")).toBe("true");
    expect(oauthControl.getAttribute("aria-expanded")).toBe("true");

    // Clicking again should collapse all.
    await user.click(allButtons[0]);
    expect(headersControl.getAttribute("aria-expanded")).toBe("false");
    expect(metadataControl.getAttribute("aria-expanded")).toBe("false");
  });
});
