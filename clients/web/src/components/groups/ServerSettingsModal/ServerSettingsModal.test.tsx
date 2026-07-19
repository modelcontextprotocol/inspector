import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ServerSettingsModal } from "./ServerSettingsModal";

const initialSettings: InspectorServerSettings = {
  headers: [{ key: "Authorization", value: "Bearer abc" }],
  env: [],
  metadata: [{ key: "userId", value: "u-1" }],
  connectionTimeout: 30000,
  requestTimeout: 60000,
  taskTtl: 60000,
  oauthClientId: "cid",
  oauthClientSecret: "secret",
  oauthScopes: "read",
  maxFetchRequests: 1000,
  roots: [{ uri: "file:///project", name: "Project" }],
};

const emptySettings: InspectorServerSettings = {
  headers: [],
  env: [],
  metadata: [],
  connectionTimeout: 30000,
  requestTimeout: 60000,
  taskTtl: 60000,
  maxFetchRequests: 1000,
  roots: [],
};

describe("ServerSettingsModal", () => {
  it("does not render content when opened is false", () => {
    renderWithMantine(
      <ServerSettingsModal
        opened={false}
        settings={emptySettings}
        serverType="streamable-http"
        isStdio={false}
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
        serverType="streamable-http"
        isStdio={false}
        onClose={vi.fn()}
        onSettingsChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Server Settings")).toBeInTheDocument();
    expect(screen.getByText("Custom Headers")).toBeInTheDocument();
  });

  it("hides the OAuth Settings section for stdio servers", () => {
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={emptySettings}
        serverType="stdio"
        isStdio
        onClose={vi.fn()}
        onSettingsChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("OAuth Settings")).not.toBeInTheDocument();
  });

  it("invokes onClose when the CloseButton is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={emptySettings}
        serverType="streamable-http"
        isStdio={false}
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

  it("maps the OAuth insufficient-scope policy into settings (SEP-2350)", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={initialSettings}
        serverType="streamable-http"
        isStdio={false}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /OAuth Settings/i }));
    await user.click(
      screen.getByRole("textbox", { name: /Insufficient-scope/i }),
    );
    await user.click(screen.getByText("Throw (surface the error)"));
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ oauthOnInsufficientScope: "throw" }),
    );
  });

  it("maps the selected protocol era into settings (#1626)", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={emptySettings}
        serverType="streamable-http"
        isStdio={false}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    // The Options section (with Protocol Era) is expanded by default.
    await user.click(screen.getByDisplayValue("Legacy (2025-11-25 handshake)"));
    await user.click(screen.getByText("Modern (2026-07-28, sessionless)"));
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ protocolEra: "modern" }),
    );
  });

  it("maps the selected modern log level into settings (#1629)", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsModal
        opened
        // The modern log-level control only shows for a modern-capable era.
        settings={{ ...emptySettings, protocolEra: "modern" }}
        serverType="streamable-http"
        isStdio={false}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    // The Options section (with Log Level per Request) is expanded by default;
    // it defaults to "debug".
    await user.click(screen.getAllByDisplayValue("debug")[0]);
    await user.click(screen.getByText("Off (no logs)"));
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ modernLogLevel: "off" }),
    );
  });

  it("hides the modern log-level control when this server negotiated legacy under 'auto' (#1629)", () => {
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={{ ...emptySettings, protocolEra: "auto" }}
        serverType="streamable-http"
        isStdio={false}
        negotiatedEra="legacy"
        onClose={vi.fn()}
        onSettingsChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("Log Level per Request")).toBeNull();
  });

  it("calls onSettingsChange when adding a header after expanding the section", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={emptySettings}
        serverType="streamable-http"
        isStdio={false}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Custom Headers" }));
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
        serverType="streamable-http"
        isStdio={false}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Custom Headers" }));
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
        serverType="streamable-http"
        isStdio={false}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Custom Headers" }));
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
        serverType="streamable-http"
        isStdio={false}
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
        serverType="streamable-http"
        isStdio={false}
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
        serverType="streamable-http"
        isStdio={false}
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
        serverType="streamable-http"
        isStdio={false}
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
        serverType="streamable-http"
        isStdio={false}
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

  it("calls onSettingsChange when toggling enterprise-managed authorization", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={emptySettings}
        serverType="streamable-http"
        isStdio={false}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "OAuth Settings" }));
    await user.click(
      screen.getByRole("checkbox", {
        name: "Enterprise-managed authorization",
      }),
    );
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...emptySettings,
      oauthClientId: "",
      oauthClientSecret: "",
      oauthScopes: "",
      enterpriseManaged: true,
    });
  });

  it("calls onSettingsChange with a blank row when adding a root", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={emptySettings}
        serverType="streamable-http"
        isStdio={false}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Roots" }));
    await user.click(screen.getByRole("button", { name: "+ Add Root" }));
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...emptySettings,
      roots: [{ uri: "", name: "" }],
    });
  });

  it("calls onSettingsChange when removing a root", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={initialSettings}
        serverType="streamable-http"
        isStdio={false}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Roots" }));
    const removeButtons = screen.getAllByRole("button", { name: "X" });
    // The roots X is the last one (headers section is also expanded).
    await user.click(removeButtons[removeButtons.length - 1]);
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...initialSettings,
      roots: [],
    });
  });

  it("calls onSettingsChange when editing a root uri/name", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={initialSettings}
        serverType="streamable-http"
        isStdio={false}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Roots" }));
    const uriInput = screen.getByDisplayValue("file:///project");
    await user.type(uriInput, "/src");
    expect(onSettingsChange).toHaveBeenCalled();
    const lastCall =
      onSettingsChange.mock.calls[onSettingsChange.mock.calls.length - 1][0];
    expect(lastCall.roots[0].name).toBe("Project");
    expect(lastCall.roots[0].uri).toContain("file:///project");
  });

  it("toggles all accordion sections when ListToggle button is clicked", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={emptySettings}
        serverType="streamable-http"
        isStdio={false}
        onClose={vi.fn()}
        onSettingsChange={vi.fn()}
      />,
    );
    const optionsControl = screen.getByRole("button", { name: "Options" });
    const headersControl = screen.getByRole("button", {
      name: "Custom Headers",
    });
    const metadataControl = screen.getByRole("button", {
      name: "Request Metadata",
    });
    const timeoutsControl = screen.getByRole("button", { name: "Timeouts" });
    const oauthControl = screen.getByRole("button", { name: "OAuth Settings" });
    const rootsControl = screen.getByRole("button", { name: "Roots" });

    // Initially only "options" is expanded.
    expect(optionsControl.getAttribute("aria-expanded")).toBe("true");
    expect(headersControl.getAttribute("aria-expanded")).toBe("false");

    // Not every section is expanded → ListToggle starts in compact mode
    // and exposes "Expand all" as its aria-label.
    await user.click(screen.getByRole("button", { name: "Expand all" }));

    expect(headersControl.getAttribute("aria-expanded")).toBe("true");
    expect(metadataControl.getAttribute("aria-expanded")).toBe("true");
    expect(timeoutsControl.getAttribute("aria-expanded")).toBe("true");
    expect(oauthControl.getAttribute("aria-expanded")).toBe("true");
    expect(rootsControl.getAttribute("aria-expanded")).toBe("true");

    // After expanding every section the toggle flips to "Collapse all".
    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(optionsControl.getAttribute("aria-expanded")).toBe("false");
    expect(headersControl.getAttribute("aria-expanded")).toBe("false");
  });

  it("calls onSettingsChange when toggling Auto Refresh in the Options section", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={emptySettings}
        serverType="streamable-http"
        isStdio={false}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    // The Options section is expanded on open, so the checkbox is visible.
    await user.click(
      screen.getByRole("checkbox", {
        name: /Auto Refresh on List Changed Notifications/,
      }),
    );
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...emptySettings,
      autoRefreshOnListChanged: true,
    });
  });

  it("calls onSettingsChange when changing the Network Log Size", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={{ ...emptySettings, maxFetchRequests: 1000 }}
        serverType="streamable-http"
        isStdio={false}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    await user.type(screen.getByLabelText(/Network Log Size/), "2");
    expect(onSettingsChange).toHaveBeenCalled();
    const call = onSettingsChange.mock.calls.at(-1)?.[0];
    expect(typeof call.maxFetchRequests).toBe("number");
  });

  it("preserves sibling rows when editing one of several headers", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    const twoHeaders: InspectorServerSettings = {
      ...emptySettings,
      headers: [
        { key: "A", value: "1" },
        { key: "B", value: "2" },
      ],
    };
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={twoHeaders}
        serverType="streamable-http"
        isStdio={false}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Custom Headers" }));
    // Editing the first header's value must leave the second row untouched
    // (the `i === index ? … : h` non-matching branch).
    await user.type(screen.getByDisplayValue("1"), "0");
    const lastCall = onSettingsChange.mock.calls.at(-1)?.[0];
    expect(lastCall.headers[1]).toEqual({ key: "B", value: "2" });
  });

  it("preserves sibling rows when editing one of several metadata entries", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    const twoMeta: InspectorServerSettings = {
      ...emptySettings,
      metadata: [
        { key: "m1", value: "v1" },
        { key: "m2", value: "v2" },
      ],
    };
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={twoMeta}
        serverType="streamable-http"
        isStdio={false}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Request Metadata" }));
    await user.type(screen.getByDisplayValue("v1"), "x");
    const lastCall = onSettingsChange.mock.calls.at(-1)?.[0];
    expect(lastCall.metadata[1]).toEqual({ key: "m2", value: "v2" });
  });

  it("preserves sibling rows when editing one of several roots", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    const twoRoots: InspectorServerSettings = {
      ...emptySettings,
      roots: [
        { uri: "file:///a", name: "A" },
        { uri: "file:///b", name: "B" },
      ],
    };
    renderWithMantine(
      <ServerSettingsModal
        opened
        settings={twoRoots}
        serverType="streamable-http"
        isStdio={false}
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Roots" }));
    await user.type(screen.getByDisplayValue("file:///a"), "1");
    const lastCall = onSettingsChange.mock.calls.at(-1)?.[0];
    expect(lastCall.roots[1]).toEqual({ uri: "file:///b", name: "B" });
  });

  describe("stdio env / cwd handlers", () => {
    // The Options section is expanded on open, so the stdio fields are visible
    // immediately when isStdio is true.
    it("does not render the stdio fields when isStdio is false", () => {
      renderWithMantine(
        <ServerSettingsModal
          opened
          settings={emptySettings}
          serverType="streamable-http"
          isStdio={false}
          onClose={vi.fn()}
          onSettingsChange={vi.fn()}
        />,
      );
      expect(
        screen.queryByLabelText(/Working Directory/),
      ).not.toBeInTheDocument();
    });

    it("calls onSettingsChange when adding an environment variable", async () => {
      const user = userEvent.setup();
      const onSettingsChange = vi.fn();
      renderWithMantine(
        <ServerSettingsModal
          opened
          settings={emptySettings}
          serverType="stdio"
          isStdio
          onClose={vi.fn()}
          onSettingsChange={onSettingsChange}
        />,
      );
      // The Environment Variables section is collapsed on open — expand it.
      await user.click(
        screen.getByRole("button", { name: "Environment Variables" }),
      );
      await user.click(
        screen.getByRole("button", { name: "+ Add Environment Variable" }),
      );
      expect(onSettingsChange).toHaveBeenCalledWith({
        ...emptySettings,
        env: [{ key: "", value: "" }],
      });
    });

    it("calls onSettingsChange when removing an environment variable", async () => {
      const user = userEvent.setup();
      const onSettingsChange = vi.fn();
      renderWithMantine(
        <ServerSettingsModal
          opened
          settings={{ ...emptySettings, env: [{ key: "A", value: "1" }] }}
          serverType="stdio"
          isStdio
          onClose={vi.fn()}
          onSettingsChange={onSettingsChange}
        />,
      );
      await user.click(
        screen.getByRole("button", { name: "Environment Variables" }),
      );
      const removeButtons = screen.getAllByRole("button", { name: "X" });
      await user.click(removeButtons[removeButtons.length - 1]);
      expect(onSettingsChange).toHaveBeenCalledWith({
        ...emptySettings,
        env: [],
      });
    });

    it("calls onSettingsChange with the updated env value when typing", async () => {
      const user = userEvent.setup();
      const onSettingsChange = vi.fn();
      renderWithMantine(
        <ServerSettingsModal
          opened
          settings={{ ...emptySettings, env: [{ key: "A", value: "1" }] }}
          serverType="stdio"
          isStdio
          onClose={vi.fn()}
          onSettingsChange={onSettingsChange}
        />,
      );
      await user.click(
        screen.getByRole("button", { name: "Environment Variables" }),
      );
      await user.type(screen.getByDisplayValue("1"), "2");
      const lastCall = onSettingsChange.mock.calls.at(-1)?.[0];
      expect(lastCall.env[0]).toEqual({ key: "A", value: "12" });
    });

    it("preserves sibling rows when editing one of several env vars", async () => {
      const user = userEvent.setup();
      const onSettingsChange = vi.fn();
      renderWithMantine(
        <ServerSettingsModal
          opened
          settings={{
            ...emptySettings,
            env: [
              { key: "A", value: "1" },
              { key: "B", value: "2" },
            ],
          }}
          serverType="stdio"
          isStdio
          onClose={vi.fn()}
          onSettingsChange={onSettingsChange}
        />,
      );
      await user.click(
        screen.getByRole("button", { name: "Environment Variables" }),
      );
      await user.type(screen.getByDisplayValue("1"), "0");
      const lastCall = onSettingsChange.mock.calls.at(-1)?.[0];
      // The untouched second env row survives the edit (the non-matching map
      // branch).
      expect(lastCall.env[1]).toEqual({ key: "B", value: "2" });
    });

    it("calls onSettingsChange when editing the working directory", async () => {
      const user = userEvent.setup();
      const onSettingsChange = vi.fn();
      renderWithMantine(
        <ServerSettingsModal
          opened
          settings={{ ...emptySettings, cwd: "/srv" }}
          serverType="stdio"
          isStdio
          onClose={vi.fn()}
          onSettingsChange={onSettingsChange}
        />,
      );
      // Controlled input: the value prop stays "/srv" (the parent vi.fn does not
      // feed edits back), so a single keystroke appends to that base.
      await user.type(screen.getByLabelText(/Working Directory/), "X");
      expect(onSettingsChange).toHaveBeenLastCalledWith({
        ...emptySettings,
        cwd: "/srvX",
      });
    });
  });
});
