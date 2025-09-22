import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, beforeEach, jest } from "@jest/globals";
import Sidebar from "../Sidebar";
import { DEFAULT_INSPECTOR_CONFIG } from "@/lib/constants";
import { InspectorConfig } from "@/lib/configurationTypes";
import { TooltipProvider } from "@/components/ui/tooltip";

// Mock theme hook
jest.mock("../../lib/hooks/useTheme", () => ({
  __esModule: true,
  default: () => ["light", jest.fn()],
}));

// Mock toast hook
const mockToast = jest.fn();
jest.mock("@/lib/hooks/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

// Mock navigator clipboard
const mockClipboardWrite = jest.fn(() => Promise.resolve());
Object.defineProperty(navigator, "clipboard", {
  value: {
    writeText: mockClipboardWrite,
  },
});

// Setup fake timers
jest.useFakeTimers();

describe("Sidebar", () => {
  const defaultProps = {
    connectionStatus: "disconnected" as const,
    transportType: "stdio" as const,
    setTransportType: jest.fn(),
    command: "",
    setCommand: jest.fn(),
    args: "",
    setArgs: jest.fn(),
    sseUrl: "",
    setSseUrl: jest.fn(),
    oauthClientId: "",
    setOauthClientId: jest.fn(),
    oauthScope: "",
    setOauthScope: jest.fn(),
    env: {},
    setEnv: jest.fn(),
    customHeaders: [],
    setCustomHeaders: jest.fn(),
    onConnect: jest.fn(),
    onDisconnect: jest.fn(),
    stdErrNotifications: [],
    clearStdErrNotifications: jest.fn(),
    logLevel: "info" as const,
    sendLogLevelRequest: jest.fn(),
    loggingSupported: true,
    config: DEFAULT_INSPECTOR_CONFIG,
    setConfig: jest.fn(),
    connectionType: "proxy" as const,
    setConnectionType: jest.fn(),
  };

  const renderSidebar = (props = {}) => {
    return render(
      <TooltipProvider>
        <Sidebar {...defaultProps} {...props} />
      </TooltipProvider>,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe("Command and arguments", () => {
    it("should trim whitespace from command input on blur", () => {
      const setCommand = jest.fn();
      renderSidebar({ command: "  node server.js  ", setCommand });

      const commandInput = screen.getByLabelText("Command");

      fireEvent.blur(commandInput);
      expect(setCommand).toHaveBeenLastCalledWith("node server.js");
    });

    it("should handle whitespace-only command input on blur", () => {
      const setCommand = jest.fn();
      renderSidebar({ command: "   ", setCommand });

      const commandInput = screen.getByLabelText("Command");

      fireEvent.blur(commandInput);
      expect(setCommand).toHaveBeenLastCalledWith("");
    });

    it("should not affect command without surrounding whitespace", () => {
      const setCommand = jest.fn();
      renderSidebar({ command: "node", setCommand });

      const commandInput = screen.getByLabelText("Command");

      fireEvent.blur(commandInput);
      expect(setCommand).toHaveBeenLastCalledWith("node");
    });
  });

  describe("Environment Variables", () => {
    const openEnvVarsSection = () => {
      const button = screen.getByTestId("env-vars-button");
      fireEvent.click(button);
    };

    describe("Basic Operations", () => {
      it("should add a new environment variable", () => {
        const setEnv = jest.fn();
        renderSidebar({ env: {}, setEnv });

        openEnvVarsSection();

        const addButton = screen.getByText("Add Environment Variable");
        fireEvent.click(addButton);

        expect(setEnv).toHaveBeenCalledWith({ "": "" });
      });

      it("should remove an environment variable", () => {
        const setEnv = jest.fn();
        const initialEnv = { TEST_KEY: "test_value" };
        renderSidebar({ env: initialEnv, setEnv });

        openEnvVarsSection();

        const removeButton = screen.getByRole("button", { name: "×" });
        fireEvent.click(removeButton);

        expect(setEnv).toHaveBeenCalledWith({});
      });

      it("should update environment variable value", () => {
        const setEnv = jest.fn();
        const initialEnv = { TEST_KEY: "test_value" };
        renderSidebar({ env: initialEnv, setEnv });

        openEnvVarsSection();

        const valueInput = screen.getByDisplayValue("test_value");
        fireEvent.change(valueInput, { target: { value: "new_value" } });

        expect(setEnv).toHaveBeenCalledWith({ TEST_KEY: "new_value" });
      });

      it("should toggle value visibility", () => {
        const initialEnv = { TEST_KEY: "test_value" };
        renderSidebar({ env: initialEnv });

        openEnvVarsSection();

        const valueInput = screen.getByDisplayValue("test_value");
        expect(valueInput).toHaveProperty("type", "password");

        const toggleButton = screen.getByRole("button", {
          name: /show value/i,
        });
        fireEvent.click(toggleButton);

        expect(valueInput).toHaveProperty("type", "text");
      });
    });

    describe("Key Editing", () => {
      it("should maintain order when editing first key", () => {
        const setEnv = jest.fn();
        const initialEnv = {
          FIRST_KEY: "first_value",
          SECOND_KEY: "second_value",
          THIRD_KEY: "third_value",
        };
        renderSidebar({ env: initialEnv, setEnv });

        openEnvVarsSection();

        const firstKeyInput = screen.getByDisplayValue("FIRST_KEY");
        fireEvent.change(firstKeyInput, { target: { value: "NEW_FIRST_KEY" } });

        expect(setEnv).toHaveBeenCalledWith({
          NEW_FIRST_KEY: "first_value",
          SECOND_KEY: "second_value",
          THIRD_KEY: "third_value",
        });
      });

      it("should maintain order when editing middle key", () => {
        const setEnv = jest.fn();
        const initialEnv = {
          FIRST_KEY: "first_value",
          SECOND_KEY: "second_value",
          THIRD_KEY: "third_value",
        };
        renderSidebar({ env: initialEnv, setEnv });

        openEnvVarsSection();

        const middleKeyInput = screen.getByDisplayValue("SECOND_KEY");
        fireEvent.change(middleKeyInput, {
          target: { value: "NEW_SECOND_KEY" },
        });

        expect(setEnv).toHaveBeenCalledWith({
          FIRST_KEY: "first_value",
          NEW_SECOND_KEY: "second_value",
          THIRD_KEY: "third_value",
        });
      });

      it("should maintain order when editing last key", () => {
        const setEnv = jest.fn();
        const initialEnv = {
          FIRST_KEY: "first_value",
          SECOND_KEY: "second_value",
          THIRD_KEY: "third_value",
        };
        renderSidebar({ env: initialEnv, setEnv });

        openEnvVarsSection();

        const lastKeyInput = screen.getByDisplayValue("THIRD_KEY");
        fireEvent.change(lastKeyInput, { target: { value: "NEW_THIRD_KEY" } });

        expect(setEnv).toHaveBeenCalledWith({
          FIRST_KEY: "first_value",
          SECOND_KEY: "second_value",
          NEW_THIRD_KEY: "third_value",
        });
      });

      it("should maintain order during key editing", () => {
        const setEnv = jest.fn();
        const initialEnv = {
          KEY1: "value1",
          KEY2: "value2",
        };
        renderSidebar({ env: initialEnv, setEnv });

        openEnvVarsSection();

        // Type "NEW_" one character at a time
        const key1Input = screen.getByDisplayValue("KEY1");
        "NEW_".split("").forEach((char) => {
          fireEvent.change(key1Input, {
            target: { value: char + "KEY1".slice(1) },
          });
        });

        // Verify the last setEnv call maintains the order
        const lastCall = setEnv.mock.calls[
          setEnv.mock.calls.length - 1
        ][0] as Record<string, string>;
        const entries = Object.entries(lastCall);

        // The values should stay with their original keys
        expect(entries[0][1]).toBe("value1"); // First entry should still have value1
        expect(entries[1][1]).toBe("value2"); // Second entry should still have value2
      });
    });

    describe("Multiple Operations", () => {
      it("should maintain state after multiple key edits", () => {
        const setEnv = jest.fn();
        const initialEnv = {
          FIRST_KEY: "first_value",
          SECOND_KEY: "second_value",
        };
        const { rerender } = renderSidebar({ env: initialEnv, setEnv });

        openEnvVarsSection();

        // First key edit
        const firstKeyInput = screen.getByDisplayValue("FIRST_KEY");
        fireEvent.change(firstKeyInput, { target: { value: "NEW_FIRST_KEY" } });

        // Get the updated env from the first setEnv call
        const updatedEnv = setEnv.mock.calls[0][0] as Record<string, string>;

        // Rerender with the updated env
        rerender(
          <TooltipProvider>
            <Sidebar {...defaultProps} env={updatedEnv} setEnv={setEnv} />
          </TooltipProvider>,
        );

        // Second key edit
        const secondKeyInput = screen.getByDisplayValue("SECOND_KEY");
        fireEvent.change(secondKeyInput, {
          target: { value: "NEW_SECOND_KEY" },
        });

        // Verify the final state matches what we expect
        expect(setEnv).toHaveBeenLastCalledWith({
          NEW_FIRST_KEY: "first_value",
          NEW_SECOND_KEY: "second_value",
        });
      });

      it("should maintain visibility state after key edit", () => {
        const initialEnv = { TEST_KEY: "test_value" };
        const { rerender } = renderSidebar({ env: initialEnv });

        openEnvVarsSection();

        // Show the value
        const toggleButton = screen.getByRole("button", {
          name: /show value/i,
        });
        fireEvent.click(toggleButton);

        const valueInput = screen.getByDisplayValue("test_value");
        expect(valueInput).toHaveProperty("type", "text");

        // Edit the key
        const keyInput = screen.getByDisplayValue("TEST_KEY");
        fireEvent.change(keyInput, { target: { value: "NEW_KEY" } });

        // Rerender with updated env
        rerender(
          <TooltipProvider>
            <Sidebar {...defaultProps} env={{ NEW_KEY: "test_value" }} />
          </TooltipProvider>,
        );

        // Value should still be visible
        const updatedValueInput = screen.getByDisplayValue("test_value");
        expect(updatedValueInput).toHaveProperty("type", "text");
      });
    });

    describe("Edge Cases", () => {
      it("should handle empty key", () => {
        const setEnv = jest.fn();
        const initialEnv = { TEST_KEY: "test_value" };
        renderSidebar({ env: initialEnv, setEnv });

        openEnvVarsSection();

        const keyInput = screen.getByDisplayValue("TEST_KEY");
        fireEvent.change(keyInput, { target: { value: "" } });

        expect(setEnv).toHaveBeenCalledWith({ "": "test_value" });
      });

      it("should handle special characters in key", () => {
        const setEnv = jest.fn();
        const initialEnv = { TEST_KEY: "test_value" };
        renderSidebar({ env: initialEnv, setEnv });

        openEnvVarsSection();

        const keyInput = screen.getByDisplayValue("TEST_KEY");
        fireEvent.change(keyInput, { target: { value: "TEST-KEY@123" } });

        expect(setEnv).toHaveBeenCalledWith({ "TEST-KEY@123": "test_value" });
      });

      it("should handle unicode characters in key", () => {
        const setEnv = jest.fn();
        const initialEnv = { TEST_KEY: "test_value" };
        renderSidebar({ env: initialEnv, setEnv });

        openEnvVarsSection();

        const keyInput = screen.getByDisplayValue("TEST_KEY");
        fireEvent.change(keyInput, { target: { value: "TEST_🔑" } });

        expect(setEnv).toHaveBeenCalledWith({ "TEST_🔑": "test_value" });
      });

      it("should handle a very long key name", () => {
        const setEnv = jest.fn();
        const initialEnv = { TEST_KEY: "test_value" };
        renderSidebar({ env: initialEnv, setEnv });

        openEnvVarsSection();

        const keyInput = screen.getByDisplayValue("TEST_KEY");
        const longKey = "A".repeat(100);
        fireEvent.change(keyInput, { target: { value: longKey } });

        expect(setEnv).toHaveBeenCalledWith({ [longKey]: "test_value" });
      });
    });
  });

  describe("Copy Server Features", () => {
    const getCopyButtons = () => {
      return {
        serverEntry: screen.getByRole("button", { name: /server entry/i }),
        serversFile: screen.getByRole("button", { name: /servers file/i }),
      };
    };

    it("should render both copy buttons for all transport types", () => {
      ["stdio", "sse", "streamable-http"].forEach((transportType) => {
        renderSidebar({ transportType });
        // There should be exactly one Server Entry and one Servers File button per render
        const serverEntryButtons = screen.getAllByRole("button", {
          name: /server entry/i,
        });
        const serversFileButtons = screen.getAllByRole("button", {
          name: /servers file/i,
        });
        expect(serverEntryButtons).toHaveLength(1);
        expect(serversFileButtons).toHaveLength(1);
        // Clean up DOM for next iteration
        // (Testing Library's render does not auto-unmount in a loop)
        document.body.innerHTML = "";
      });
    });

    it("should copy server entry configuration to clipboard for STDIO transport", async () => {
      const command = "node";
      const args = "--inspect server.js";
      const env = { API_KEY: "test-key", DEBUG: "true" };

      renderSidebar({
        transportType: "stdio",
        command,
        args,
        env,
      });

      await act(async () => {
        const { serverEntry } = getCopyButtons();
        fireEvent.click(serverEntry);
        jest.runAllTimers();
      });

      expect(mockClipboardWrite).toHaveBeenCalledTimes(1);
      const expectedConfig = JSON.stringify(
        {
          command,
          args: ["--inspect", "server.js"],
          env,
        },
        null,
        4,
      );
      expect(mockClipboardWrite).toHaveBeenCalledWith(expectedConfig);
      expect(mockToast).toHaveBeenCalledWith({
        title: "Config entry copied",
        description:
          "Server configuration has been copied to clipboard. Add this to your mcp.json inside the 'mcpServers' object with your preferred server name.",
      });
    });

    it("should copy servers file configuration to clipboard for STDIO transport", async () => {
      const command = "node";
      const args = "--inspect server.js";
      const env = { API_KEY: "test-key", DEBUG: "true" };

      renderSidebar({
        transportType: "stdio",
        command,
        args,
        env,
      });

      await act(async () => {
        const { serversFile } = getCopyButtons();
        fireEvent.click(serversFile);
        jest.runAllTimers();
      });

      expect(mockClipboardWrite).toHaveBeenCalledTimes(1);
      const expectedConfig = JSON.stringify(
        {
          mcpServers: {
            "default-server": {
              command,
              args: ["--inspect", "server.js"],
              env,
            },
          },
        },
        null,
        4,
      );
      expect(mockClipboardWrite).toHaveBeenCalledWith(expectedConfig);
    });

    it("should copy server entry configuration to clipboard for SSE transport", async () => {
      const sseUrl = "http://localhost:3000/events";
      renderSidebar({ transportType: "sse", sseUrl });

      await act(async () => {
        const { serverEntry } = getCopyButtons();
        fireEvent.click(serverEntry);
        jest.runAllTimers();
      });

      expect(mockClipboardWrite).toHaveBeenCalledTimes(1);
      const expectedConfig = JSON.stringify(
        {
          type: "sse",
          url: sseUrl,
          note: "For SSE connections, add this URL directly in your MCP Client",
        },
        null,
        4,
      );
      expect(mockClipboardWrite).toHaveBeenCalledWith(expectedConfig);
      expect(mockToast).toHaveBeenCalledWith({
        title: "Config entry copied",
        description:
          "SSE URL has been copied. Use this URL directly in your MCP Client.",
      });
    });

    it("should copy servers file configuration to clipboard for SSE transport", async () => {
      const sseUrl = "http://localhost:3000/events";
      renderSidebar({ transportType: "sse", sseUrl });

      await act(async () => {
        const { serversFile } = getCopyButtons();
        fireEvent.click(serversFile);
        jest.runAllTimers();
      });

      expect(mockClipboardWrite).toHaveBeenCalledTimes(1);
      const expectedConfig = JSON.stringify(
        {
          mcpServers: {
            "default-server": {
              type: "sse",
              url: sseUrl,
              note: "For SSE connections, add this URL directly in your MCP Client",
            },
          },
        },
        null,
        4,
      );
      expect(mockClipboardWrite).toHaveBeenCalledWith(expectedConfig);
    });

    it("should copy server entry configuration to clipboard for streamable-http transport", async () => {
      const sseUrl = "http://localhost:3001/sse";
      renderSidebar({ transportType: "streamable-http", sseUrl });

      await act(async () => {
        const { serverEntry } = getCopyButtons();
        fireEvent.click(serverEntry);
        jest.runAllTimers();
      });

      expect(mockClipboardWrite).toHaveBeenCalledTimes(1);
      const expectedConfig = JSON.stringify(
        {
          type: "streamable-http",
          url: sseUrl,
          note: "For Streamable HTTP connections, add this URL directly in your MCP Client",
        },
        null,
        4,
      );
      expect(mockClipboardWrite).toHaveBeenCalledWith(expectedConfig);
      expect(mockToast).toHaveBeenCalledWith({
        title: "Config entry copied",
        description:
          "Streamable HTTP URL has been copied. Use this URL directly in your MCP Client.",
      });
    });

    it("should copy servers file configuration to clipboard for streamable-http transport", async () => {
      const sseUrl = "http://localhost:3001/sse";
      renderSidebar({ transportType: "streamable-http", sseUrl });

      await act(async () => {
        const { serversFile } = getCopyButtons();
        fireEvent.click(serversFile);
        jest.runAllTimers();
      });

      expect(mockClipboardWrite).toHaveBeenCalledTimes(1);
      const expectedConfig = JSON.stringify(
        {
          mcpServers: {
            "default-server": {
              type: "streamable-http",
              url: sseUrl,
              note: "For Streamable HTTP connections, add this URL directly in your MCP Client",
            },
          },
        },
        null,
        4,
      );
      expect(mockClipboardWrite).toHaveBeenCalledWith(expectedConfig);
    });

    it("should handle empty args in STDIO transport", async () => {
      const command = "python";
      const args = "";

      renderSidebar({
        transportType: "stdio",
        command,
        args,
      });

      await act(async () => {
        const { serverEntry } = getCopyButtons();
        fireEvent.click(serverEntry);
        jest.runAllTimers();
      });

      expect(mockClipboardWrite).toHaveBeenCalledTimes(1);
      const expectedConfig = JSON.stringify(
        {
          command,
          args: [],
          env: {},
        },
        null,
        4,
      );
      expect(mockClipboardWrite).toHaveBeenCalledWith(expectedConfig);
    });
  });

  describe("Authentication", () => {
    const openAuthSection = () => {
      const button = screen.getByTestId("auth-button");
      fireEvent.click(button);
    };

    it("should update bearer token via custom headers", async () => {
      const setCustomHeaders = jest.fn();
      renderSidebar({
        customHeaders: [],
        setCustomHeaders,
        transportType: "sse", // Set transport type to SSE
      });

      openAuthSection();

      // Add a new header
      const addButton = screen.getByTestId("add-header-button");
      fireEvent.click(addButton);

      // Verify that setCustomHeaders was called to add an empty header
      expect(setCustomHeaders).toHaveBeenCalledWith([
        {
          name: "",
          value: "",
          enabled: true,
        },
      ]);
    });

    it("should update header name via custom headers", () => {
      const setCustomHeaders = jest.fn();
      renderSidebar({
        customHeaders: [
          {
            name: "Authorization",
            value: "Bearer token123",
            enabled: true,
          },
        ],
        setCustomHeaders,
        transportType: "sse",
      });

      openAuthSection();

      const headerNameInput = screen.getByTestId("header-name-input-0");
      fireEvent.change(headerNameInput, { target: { value: "X-Custom-Auth" } });

      expect(setCustomHeaders).toHaveBeenCalledWith([
        {
          name: "X-Custom-Auth",
          value: "Bearer token123",
          enabled: true,
        },
      ]);
    });

    it("should clear bearer token via custom headers", () => {
      const setCustomHeaders = jest.fn();
      renderSidebar({
        customHeaders: [
          {
            name: "Authorization",
            value: "Bearer existing_token",
            enabled: true,
          },
        ],
        setCustomHeaders,
        transportType: "sse", // Set transport type to SSE
      });

      openAuthSection();

      const headerValueInput = screen.getByTestId("header-value-input-0");
      fireEvent.change(headerValueInput, { target: { value: "" } });

      expect(setCustomHeaders).toHaveBeenCalledWith([
        {
          name: "Authorization",
          value: "",
          enabled: true,
        },
      ]);
    });

    it("should properly render header value input as password field", () => {
      const { rerender } = renderSidebar({
        customHeaders: [
          {
            name: "Authorization",
            value: "Bearer existing_token",
            enabled: true,
          },
        ],
        transportType: "sse", // Set transport type to SSE
      });

      openAuthSection();

      // Token input should be a password field
      const tokenInput = screen.getByTestId("header-value-input-0");
      expect(tokenInput).toHaveProperty("type", "password");

      // Update the token
      fireEvent.change(tokenInput, { target: { value: "Bearer new_token" } });

      // Rerender with updated token
      rerender(
        <TooltipProvider>
          <Sidebar
            {...defaultProps}
            customHeaders={[
              {
                name: "Authorization",
                value: "Bearer new_token",
                enabled: true,
              },
            ]}
            transportType="sse"
          />
        </TooltipProvider>,
      );

      // Token input should still exist after update
      expect(screen.getByTestId("header-value-input-0")).toBeInTheDocument();
    });

    it("should maintain token visibility state after update", () => {
      const { rerender } = renderSidebar({
        customHeaders: [
          {
            name: "Authorization",
            value: "Bearer existing_token",
            enabled: true,
          },
        ],
        transportType: "sse", // Set transport type to SSE
      });

      openAuthSection();

      // Token input should be a password field
      const tokenInput = screen.getByTestId("header-value-input-0");
      expect(tokenInput).toHaveProperty("type", "password");

      // Update the token
      fireEvent.change(tokenInput, { target: { value: "Bearer new_token" } });

      // Rerender with updated token
      rerender(
        <TooltipProvider>
          <Sidebar
            {...defaultProps}
            customHeaders={[
              {
                name: "Authorization",
                value: "Bearer new_token",
                enabled: true,
              },
            ]}
            transportType="sse"
          />
        </TooltipProvider>,
      );

      // Token input should still exist after update
      expect(screen.getByTestId("header-value-input-0")).toBeInTheDocument();
    });

    it("should maintain header name when toggling auth section", () => {
      renderSidebar({
        customHeaders: [
          {
            name: "X-API-Key",
            value: "api-key-123",
            enabled: true,
          },
        ],
        transportType: "sse",
      });

      // Open auth section
      openAuthSection();

      // Verify header name is displayed
      const headerInput = screen.getByTestId("header-name-input-0");
      expect(headerInput).toHaveValue("X-API-Key");

      // Close auth section
      const authButton = screen.getByTestId("auth-button");
      fireEvent.click(authButton);

      // Reopen auth section
      fireEvent.click(authButton);

      // Verify header name is still preserved
      expect(screen.getByTestId("header-name-input-0")).toHaveValue(
        "X-API-Key",
      );
    });

    it("should display placeholder for header name when no headers exist", () => {
      renderSidebar({
        customHeaders: [],
        transportType: "sse",
      });

      openAuthSection();

      // Verify that the "No custom headers configured" message is shown
      expect(
        screen.getByText("No custom headers configured"),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Click "Add" to get started'),
      ).toBeInTheDocument();

      // Verify the Add button is present
      const addButton = screen.getByTestId("add-header-button");
      expect(addButton).toBeInTheDocument();
    });

    it("should allow editing existing headers", () => {
      const setCustomHeaders = jest.fn();
      renderSidebar({
        customHeaders: [
          {
            name: "Authorization",
            value: "Bearer token123",
            enabled: true,
          },
        ],
        setCustomHeaders,
        transportType: "sse",
      });

      openAuthSection();

      // Verify header inputs are rendered
      const headerNameInput = screen.getByTestId("header-name-input-0");
      const headerValueInput = screen.getByTestId("header-value-input-0");

      expect(headerNameInput).toHaveValue("Authorization");
      expect(headerValueInput).toHaveValue("Bearer token123");
      expect(headerNameInput).toHaveAttribute("placeholder", "Header Name");
      expect(headerValueInput).toHaveAttribute("placeholder", "Header Value");

      // Update header name
      fireEvent.change(headerNameInput, { target: { value: "X-API-Key" } });
      expect(setCustomHeaders).toHaveBeenCalledWith([
        {
          name: "X-API-Key",
          value: "Bearer token123",
          enabled: true,
        },
      ]);
    });
  });

  describe("Configuration", () => {
    const openConfigSection = () => {
      const button = screen.getByTestId("config-button");
      fireEvent.click(button);
    };

    it("should update MCP server request timeout", () => {
      const setConfig = jest.fn();
      renderSidebar({ config: DEFAULT_INSPECTOR_CONFIG, setConfig });

      openConfigSection();

      const timeoutInput = screen.getByTestId(
        "MCP_SERVER_REQUEST_TIMEOUT-input",
      );
      fireEvent.change(timeoutInput, { target: { value: "5000" } });

      expect(setConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          MCP_SERVER_REQUEST_TIMEOUT: {
            label: "Request Timeout",
            description: "Timeout for requests to the MCP server (ms)",
            value: 5000,
            is_session_item: false,
          },
        }),
      );
    });

    it("should update MCP server proxy address", () => {
      const setConfig = jest.fn();
      renderSidebar({ config: DEFAULT_INSPECTOR_CONFIG, setConfig });

      openConfigSection();

      const proxyAddressInput = screen.getByTestId(
        "MCP_PROXY_FULL_ADDRESS-input",
      );
      fireEvent.change(proxyAddressInput, {
        target: { value: "http://localhost:8080" },
      });

      expect(setConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          MCP_PROXY_FULL_ADDRESS: {
            label: "Inspector Proxy Address",
            description:
              "Set this if you are running the MCP Inspector Proxy on a non-default address. Example: http://10.1.1.22:5577",
            value: "http://localhost:8080",
            is_session_item: false,
          },
        }),
      );
    });

    it("should update max total timeout", () => {
      const setConfig = jest.fn();
      renderSidebar({ config: DEFAULT_INSPECTOR_CONFIG, setConfig });

      openConfigSection();

      const maxTotalTimeoutInput = screen.getByTestId(
        "MCP_REQUEST_MAX_TOTAL_TIMEOUT-input",
      );
      fireEvent.change(maxTotalTimeoutInput, {
        target: { value: "10000" },
      });

      expect(setConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          MCP_REQUEST_MAX_TOTAL_TIMEOUT: {
            label: "Maximum Total Timeout",
            description:
              "Maximum total timeout for requests sent to the MCP server (ms) (Use with progress notifications)",
            value: 10000,
            is_session_item: false,
          },
        }),
      );
    });

    it("should handle invalid timeout values entered by user", () => {
      const setConfig = jest.fn();
      renderSidebar({ config: DEFAULT_INSPECTOR_CONFIG, setConfig });

      openConfigSection();

      const timeoutInput = screen.getByTestId(
        "MCP_SERVER_REQUEST_TIMEOUT-input",
      );
      fireEvent.change(timeoutInput, { target: { value: "abc1" } });

      expect(setConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          MCP_SERVER_REQUEST_TIMEOUT: {
            label: "Request Timeout",
            description: "Timeout for requests to the MCP server (ms)",
            value: 0,
            is_session_item: false,
          },
        }),
      );
    });

    it("should maintain configuration state after multiple updates", () => {
      const setConfig = jest.fn();
      const { rerender } = renderSidebar({
        config: DEFAULT_INSPECTOR_CONFIG,
        setConfig,
      });

      openConfigSection();
      // First update
      const timeoutInput = screen.getByTestId(
        "MCP_SERVER_REQUEST_TIMEOUT-input",
      );
      fireEvent.change(timeoutInput, { target: { value: "5000" } });

      // Get the updated config from the first setConfig call
      const updatedConfig = setConfig.mock.calls[0][0] as InspectorConfig;

      // Rerender with the updated config
      rerender(
        <TooltipProvider>
          <Sidebar
            {...defaultProps}
            config={updatedConfig}
            setConfig={setConfig}
          />
        </TooltipProvider>,
      );

      // Second update
      const updatedTimeoutInput = screen.getByTestId(
        "MCP_SERVER_REQUEST_TIMEOUT-input",
      );
      fireEvent.change(updatedTimeoutInput, { target: { value: "3000" } });

      // Verify the final state matches what we expect
      expect(setConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({
          MCP_SERVER_REQUEST_TIMEOUT: {
            label: "Request Timeout",
            description: "Timeout for requests to the MCP server (ms)",
            value: 3000,
            is_session_item: false,
          },
        }),
      );
    });
  });
});
