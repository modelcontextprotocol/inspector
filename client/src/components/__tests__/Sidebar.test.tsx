import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, beforeEach, jest } from "@jest/globals";
import Sidebar from "../Sidebar";

// Mock theme hook
jest.mock("../../lib/useTheme", () => ({
  __esModule: true,
  default: () => ["light", jest.fn()],
}));

describe("Sidebar Environment Variables", () => {
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
    env: {},
    setEnv: jest.fn(),
    bearerToken: "",
    setBearerToken: jest.fn(),
    onConnect: jest.fn(),
    stdErrNotifications: [],
    logLevel: "info" as const,
    sendLogLevelRequest: jest.fn(),
    loggingSupported: true,
  };

  const renderSidebar = (props = {}) => {
    return render(<Sidebar {...defaultProps} {...props} />);
  };

  const openEnvVarsSection = () => {
    const button = screen.getByText("Environment Variables");
    fireEvent.click(button);
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

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

      const toggleButton = screen.getByRole("button", { name: /show value/i });
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
      fireEvent.change(middleKeyInput, { target: { value: "NEW_SECOND_KEY" } });

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
      rerender(<Sidebar {...defaultProps} env={updatedEnv} setEnv={setEnv} />);

      // Second key edit
      const secondKeyInput = screen.getByDisplayValue("SECOND_KEY");
      fireEvent.change(secondKeyInput, { target: { value: "NEW_SECOND_KEY" } });

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
      const toggleButton = screen.getByRole("button", { name: /show value/i });
      fireEvent.click(toggleButton);

      const valueInput = screen.getByDisplayValue("test_value");
      expect(valueInput).toHaveProperty("type", "text");

      // Edit the key
      const keyInput = screen.getByDisplayValue("TEST_KEY");
      fireEvent.change(keyInput, { target: { value: "NEW_KEY" } });

      // Rerender with updated env
      rerender(<Sidebar {...defaultProps} env={{ NEW_KEY: "test_value" }} />);

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

    it("should handle unicode characters", () => {
      const setEnv = jest.fn();
      const initialEnv = { TEST_KEY: "test_value" };
      renderSidebar({ env: initialEnv, setEnv });

      openEnvVarsSection();

      const keyInput = screen.getByDisplayValue("TEST_KEY");
      fireEvent.change(keyInput, { target: { value: "TEST_🔑" } });

      expect(setEnv).toHaveBeenCalledWith({ "TEST_🔑": "test_value" });
    });

    it("should handle very long key names", () => {
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
