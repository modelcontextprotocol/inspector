import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, beforeEach, jest } from "@jest/globals";
import SettingsTab from "../SettingsTab";

// Mock toast hook
const mockToast = jest.fn();
jest.mock("@/lib/hooks/useToast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

describe("SettingsTab", () => {
  const defaultProps = {
    onApiKeyChange: jest.fn(),
    disabled: false,
  };

  const renderSettingsTab = (props = {}) => {
    return render(<SettingsTab {...defaultProps} {...props} />);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  describe("API Key Management", () => {
    it("should render API key input field", () => {
      renderSettingsTab();

      expect(screen.getByText("Claude API Key")).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText(
          "Enter your Claude API key (sk-ant-api03-...)",
        ),
      ).toBeInTheDocument();
    });

    it("should call onApiKeyChange when a valid API key is entered", () => {
      const onApiKeyChange = jest.fn();
      renderSettingsTab({ onApiKeyChange });

      const input = screen.getByPlaceholderText(
        "Enter your Claude API key (sk-ant-api03-...)",
      );
      fireEvent.change(input, {
        target: { value: "sk-ant-api03-validkey123456789" },
      });

      expect(onApiKeyChange).toHaveBeenCalledWith(
        "sk-ant-api03-validkey123456789",
      );
      expect(mockToast).toHaveBeenCalledWith({
        title: "API Key Set",
        description:
          "Your Claude API key has been saved and configured successfully.",
        variant: "default",
      });
    });

    it("should show validation error for invalid API key", () => {
      renderSettingsTab();

      const input = screen.getByPlaceholderText(
        "Enter your Claude API key (sk-ant-api03-...)",
      );
      fireEvent.change(input, { target: { value: "invalid-key" } });

      expect(
        screen.getByText(
          'Please enter a valid Claude API key starting with "sk-ant-api03-"',
        ),
      ).toBeInTheDocument();
    });

    it("should toggle API key visibility", () => {
      renderSettingsTab();

      const input = screen.getByPlaceholderText(
        "Enter your Claude API key (sk-ant-api03-...)",
      );
      expect(input).toHaveAttribute("type", "password");

      const toggleButton = screen.getByRole("button", { name: "" }); // Eye icon button
      fireEvent.click(toggleButton);

      expect(input).toHaveAttribute("type", "text");
    });

    it("should show clear button when API key is entered", () => {
      renderSettingsTab();

      const input = screen.getByPlaceholderText(
        "Enter your Claude API key (sk-ant-api03-...)",
      );
      fireEvent.change(input, { target: { value: "some-key" } });

      expect(screen.getByText("Clear")).toBeInTheDocument();
    });

    it("should clear API key when clear button is clicked", () => {
      const onApiKeyChange = jest.fn();
      renderSettingsTab({ onApiKeyChange });

      const input = screen.getByPlaceholderText(
        "Enter your Claude API key (sk-ant-api03-...)",
      );
      fireEvent.change(input, { target: { value: "some-key" } });

      const clearButton = screen.getByText("Clear");
      fireEvent.click(clearButton);

      expect(input).toHaveValue("");
      expect(onApiKeyChange).toHaveBeenCalledWith("");
      expect(mockToast).toHaveBeenCalledWith({
        title: "API Key Cleared",
        description: "Your Claude API key has been removed from storage.",
        variant: "default",
      });
    });

    it("should load API key from localStorage on mount", () => {
      const onApiKeyChange = jest.fn();
      localStorage.setItem("claude-api-key", "sk-ant-api03-stored123456789");

      renderSettingsTab({ onApiKeyChange });

      expect(onApiKeyChange).toHaveBeenCalledWith(
        "sk-ant-api03-stored123456789",
      );
    });

    it("should disable inputs when disabled prop is true", () => {
      renderSettingsTab({ disabled: true });

      const input = screen.getByPlaceholderText(
        "Enter your Claude API key (sk-ant-api03-...)",
      );
      expect(input).toBeDisabled();
    });

    it("should show success message for valid API key", () => {
      renderSettingsTab();

      const input = screen.getByPlaceholderText(
        "Enter your Claude API key (sk-ant-api03-...)",
      );
      fireEvent.change(input, {
        target: { value: "sk-ant-api03-validkey123456789" },
      });

      expect(
        screen.getByText(
          "✓ Valid API key configured. Chat functionality is now available.",
        ),
      ).toBeInTheDocument();
    });

    it("should show help text when no API key is entered", () => {
      renderSettingsTab();

      expect(
        screen.getByText(
          "Enter your Claude API key to enable the chat functionality. Your key will be securely stored in your browser's local storage.",
        ),
      ).toBeInTheDocument();
    });
  });
});
