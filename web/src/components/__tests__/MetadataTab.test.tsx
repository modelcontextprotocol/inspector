import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import MetadataTab from "../MetadataTab";
import { Tabs } from "@/components/ui/tabs";
import {
  META_NAME_RULES_MESSAGE,
  META_PREFIX_RULES_MESSAGE,
  RESERVED_NAMESPACE_MESSAGE,
} from "@/utils/metaUtils";

describe("MetadataTab", () => {
  const defaultProps = {
    metadata: {},
    onMetadataChange: jest.fn(),
  };

  const renderMetadataTab = (props = {}) => {
    return render(
      <Tabs defaultValue="metadata">
        <MetadataTab {...defaultProps} {...props} />
      </Tabs>,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Initial Rendering", () => {
    it("should render the metadata tab with title and description", () => {
      renderMetadataTab();

      expect(screen.getByText("Metadata")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Key-value pairs that will be included in all MCP requests",
        ),
      ).toBeInTheDocument();
    });

    it("should render Add Entry button", () => {
      renderMetadataTab();

      const addButton = screen.getByRole("button", { name: /add entry/i });
      expect(addButton).toBeInTheDocument();
    });

    it("should show empty state message when no entries exist", () => {
      renderMetadataTab();

      expect(
        screen.getByText(
          'No metadata entries. Click "Add Entry" to add key-value pairs.',
        ),
      ).toBeInTheDocument();
    });

    it("should not show empty state message when entries exist", () => {
      renderMetadataTab({
        metadata: { key1: "value1" },
      });

      expect(
        screen.queryByText(
          'No metadata entries. Click "Add Entry" to add key-value pairs.',
        ),
      ).not.toBeInTheDocument();
    });
  });

  describe("Initial Data Handling", () => {
    it("should initialize with existing metadata", () => {
      const initialMetadata = {
        API_KEY: "test-key",
        VERSION: "1.0.0",
      };

      renderMetadataTab({ metadata: initialMetadata });

      expect(screen.getByDisplayValue("API_KEY")).toBeInTheDocument();
      expect(screen.getByDisplayValue("test-key")).toBeInTheDocument();
      expect(screen.getByDisplayValue("VERSION")).toBeInTheDocument();
      expect(screen.getByDisplayValue("1.0.0")).toBeInTheDocument();
    });

    it("should render multiple entries in correct order", () => {
      const initialMetadata = {
        FIRST: "first-value",
        SECOND: "second-value",
        THIRD: "third-value",
      };

      renderMetadataTab({ metadata: initialMetadata });

      const keyInputs = screen.getAllByPlaceholderText("Key");
      const valueInputs = screen.getAllByPlaceholderText("Value");

      expect(keyInputs).toHaveLength(3);
      expect(valueInputs).toHaveLength(3);

      // Check that entries are rendered in the order they appear in the object
      const entries = Object.entries(initialMetadata);
      entries.forEach(([key, value], index) => {
        expect(keyInputs[index]).toHaveValue(key);
        expect(valueInputs[index]).toHaveValue(value);
      });
    });
  });

  describe("Adding Entries", () => {
    it("should add a new empty entry when Add Entry button is clicked", () => {
      renderMetadataTab();

      const addButton = screen.getByRole("button", { name: /add entry/i });
      fireEvent.click(addButton);

      const keyInputs = screen.getAllByPlaceholderText("Key");
      const valueInputs = screen.getAllByPlaceholderText("Value");

      expect(keyInputs).toHaveLength(1);
      expect(valueInputs).toHaveLength(1);
      expect(keyInputs[0]).toHaveValue("");
      expect(valueInputs[0]).toHaveValue("");
    });

    it("should add multiple entries when Add Entry button is clicked multiple times", () => {
      renderMetadataTab();

      const addButton = screen.getByRole("button", { name: /add entry/i });

      fireEvent.click(addButton);
      fireEvent.click(addButton);
      fireEvent.click(addButton);

      const keyInputs = screen.getAllByPlaceholderText("Key");
      const valueInputs = screen.getAllByPlaceholderText("Value");

      expect(keyInputs).toHaveLength(3);
      expect(valueInputs).toHaveLength(3);
    });

    it("should hide empty state message after adding first entry", () => {
      renderMetadataTab();

      expect(
        screen.getByText(
          'No metadata entries. Click "Add Entry" to add key-value pairs.',
        ),
      ).toBeInTheDocument();

      const addButton = screen.getByRole("button", { name: /add entry/i });
      fireEvent.click(addButton);

      expect(
        screen.queryByText(
          'No metadata entries. Click "Add Entry" to add key-value pairs.',
        ),
      ).not.toBeInTheDocument();
    });
  });

  describe("Removing Entries", () => {
    it("should render remove button for each entry", () => {
      renderMetadataTab({
        metadata: { key1: "value1", key2: "value2" },
      });

      const removeButtons = screen.getAllByRole("button", { name: "" }); // Trash icon buttons have no text
      expect(removeButtons).toHaveLength(2);
    });

    it("should remove entry when remove button is clicked", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({
        metadata: { key1: "value1", key2: "value2" },
        onMetadataChange,
      });

      const removeButtons = screen.getAllByRole("button", { name: "" });
      fireEvent.click(removeButtons[0]);

      expect(onMetadataChange).toHaveBeenCalledWith({ key2: "value2" });
    });

    it("should remove correct entry when multiple entries exist", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({
        metadata: {
          FIRST: "first-value",
          SECOND: "second-value",
          THIRD: "third-value",
        },
        onMetadataChange,
      });

      const removeButtons = screen.getAllByRole("button", { name: "" });
      fireEvent.click(removeButtons[1]); // Remove second entry

      expect(onMetadataChange).toHaveBeenCalledWith({
        FIRST: "first-value",
        THIRD: "third-value",
      });
    });

    it("should show empty state message after removing all entries", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({
        metadata: { key1: "value1" },
        onMetadataChange,
      });

      const removeButton = screen.getByRole("button", { name: "" });
      fireEvent.click(removeButton);

      expect(onMetadataChange).toHaveBeenCalledWith({});
    });
  });

  describe("Editing Entries", () => {
    it("should update key when key input is changed", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({
        metadata: { oldKey: "value1" },
        onMetadataChange,
      });

      const keyInput = screen.getByDisplayValue("oldKey");
      fireEvent.change(keyInput, { target: { value: "newKey" } });

      expect(onMetadataChange).toHaveBeenCalledWith({ newKey: "value1" });
    });

    it("should update value when value input is changed", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({
        metadata: { key1: "oldValue" },
        onMetadataChange,
      });

      const valueInput = screen.getByDisplayValue("oldValue");
      fireEvent.change(valueInput, { target: { value: "newValue" } });

      expect(onMetadataChange).toHaveBeenCalledWith({ key1: "newValue" });
    });

    it("should handle editing multiple entries independently", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({
        metadata: {
          key1: "value1",
          key2: "value2",
        },
        onMetadataChange,
      });

      const keyInputs = screen.getAllByPlaceholderText("Key");
      const valueInputs = screen.getAllByPlaceholderText("Value");

      // Edit first entry key
      fireEvent.change(keyInputs[0], { target: { value: "newKey1" } });
      expect(onMetadataChange).toHaveBeenCalledWith({
        newKey1: "value1",
        key2: "value2",
      });

      // Clear mock to test second edit independently
      onMetadataChange.mockClear();

      // Edit second entry value
      fireEvent.change(valueInputs[1], { target: { value: "newValue2" } });
      expect(onMetadataChange).toHaveBeenCalledWith({
        newKey1: "value1",
        key2: "newValue2",
      });
    });
  });

  describe("Reserved Metadata Keys", () => {
    test.each`
      description                             | value                             | message                       | shouldDisableValue
      ${"reserved keys with prefix"}          | ${"modelcontextprotocol.io/flip"} | ${RESERVED_NAMESPACE_MESSAGE} | ${true}
      ${"reserved root without slash"}        | ${"modelcontextprotocol.io"}      | ${RESERVED_NAMESPACE_MESSAGE} | ${true}
      ${"nested modelcontextprotocol domain"} | ${"api.modelcontextprotocol.org"} | ${RESERVED_NAMESPACE_MESSAGE} | ${false}
      ${"nested mcp domain"}                  | ${"tools.mcp.com/path"}           | ${RESERVED_NAMESPACE_MESSAGE} | ${false}
      ${"invalid name segments"}              | ${"custom/bad-"}                  | ${META_NAME_RULES_MESSAGE}    | ${false}
      ${"invalid prefix labels"}              | ${"1invalid-prefix/value"}        | ${META_PREFIX_RULES_MESSAGE}  | ${false}
    `(
      "should display an error for $description",
      ({ value, message, shouldDisableValue }) => {
        const onMetadataChange = jest.fn();
        renderMetadataTab({ onMetadataChange });

        const addButton = screen.getByRole("button", { name: /add entry/i });
        fireEvent.click(addButton);

        const keyInput = screen.getByPlaceholderText("Key");
        fireEvent.change(keyInput, { target: { value } });

        const valueInput = screen.getByPlaceholderText("Value");
        if (shouldDisableValue) {
          expect(valueInput).toBeDisabled();
        }

        expect(screen.getByText(message)).toBeInTheDocument();
        expect(onMetadataChange).toHaveBeenLastCalledWith({});
      },
    );
  });

  describe("Data Validation and Trimming", () => {
    it("should trim whitespace from keys and values", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({ onMetadataChange });

      const addButton = screen.getByRole("button", { name: /add entry/i });
      fireEvent.click(addButton);

      const keyInput = screen.getByPlaceholderText("Key");
      const valueInput = screen.getByPlaceholderText("Value");

      fireEvent.change(keyInput, { target: { value: "  trimmedKey  " } });
      fireEvent.change(valueInput, { target: { value: "  trimmedValue  " } });

      expect(onMetadataChange).toHaveBeenCalledWith({
        trimmedKey: "trimmedValue",
      });
    });

    it("should exclude entries with empty keys or values after trimming", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({ onMetadataChange });

      const addButton = screen.getByRole("button", { name: /add entry/i });
      fireEvent.click(addButton);
      fireEvent.click(addButton);

      const keyInputs = screen.getAllByPlaceholderText("Key");
      const valueInputs = screen.getAllByPlaceholderText("Value");

      // First entry: valid key and value
      fireEvent.change(keyInputs[0], { target: { value: "validKey" } });
      fireEvent.change(valueInputs[0], { target: { value: "validValue" } });

      // Second entry: empty key (should be excluded)
      fireEvent.change(keyInputs[1], { target: { value: "" } });
      fireEvent.change(valueInputs[1], { target: { value: "someValue" } });

      expect(onMetadataChange).toHaveBeenCalledWith({
        validKey: "validValue",
      });
    });

    it("should exclude entries with whitespace-only keys or values", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({ onMetadataChange });

      const addButton = screen.getByRole("button", { name: /add entry/i });
      fireEvent.click(addButton);
      fireEvent.click(addButton);

      const keyInputs = screen.getAllByPlaceholderText("Key");
      const valueInputs = screen.getAllByPlaceholderText("Value");

      // First entry: valid key and value
      fireEvent.change(keyInputs[0], { target: { value: "validKey" } });
      fireEvent.change(valueInputs[0], { target: { value: "validValue" } });

      // Second entry: whitespace-only key (should be excluded)
      fireEvent.change(keyInputs[1], { target: { value: "   " } });
      fireEvent.change(valueInputs[1], { target: { value: "someValue" } });

      expect(onMetadataChange).toHaveBeenCalledWith({
        validKey: "validValue",
      });
    });

    it("should handle mixed valid and invalid entries", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({ onMetadataChange });

      const addButton = screen.getByRole("button", { name: /add entry/i });
      fireEvent.click(addButton);
      fireEvent.click(addButton);
      fireEvent.click(addButton);

      const keyInputs = screen.getAllByPlaceholderText("Key");
      const valueInputs = screen.getAllByPlaceholderText("Value");

      // First entry: valid
      fireEvent.change(keyInputs[0], { target: { value: "key1" } });
      fireEvent.change(valueInputs[0], { target: { value: "value1" } });

      // Second entry: empty key (invalid)
      fireEvent.change(keyInputs[1], { target: { value: "" } });
      fireEvent.change(valueInputs[1], { target: { value: "value2" } });

      // Third entry: valid
      fireEvent.change(keyInputs[2], { target: { value: "key3" } });
      fireEvent.change(valueInputs[2], { target: { value: "value3" } });

      expect(onMetadataChange).toHaveBeenCalledWith({
        key1: "value1",
        key3: "value3",
      });
    });
  });

  describe("Input Accessibility", () => {
    it("should have proper labels for screen readers", () => {
      renderMetadataTab({
        metadata: { key1: "value1" },
      });

      const keyLabel = screen.getByLabelText("Key", { selector: "input" });
      const valueLabel = screen.getByLabelText("Value", { selector: "input" });

      expect(keyLabel).toBeInTheDocument();
      expect(valueLabel).toBeInTheDocument();
    });

    it("should have unique IDs for each input pair", () => {
      renderMetadataTab({
        metadata: {
          key1: "value1",
          key2: "value2",
        },
      });

      const keyInputs = screen.getAllByPlaceholderText("Key");
      const valueInputs = screen.getAllByPlaceholderText("Value");

      expect(keyInputs[0]).toHaveAttribute("id", "key-0");
      expect(keyInputs[1]).toHaveAttribute("id", "key-1");
      expect(valueInputs[0]).toHaveAttribute("id", "value-0");
      expect(valueInputs[1]).toHaveAttribute("id", "value-1");
    });

    it("should have proper placeholder text", () => {
      renderMetadataTab();

      const addButton = screen.getByRole("button", { name: /add entry/i });
      fireEvent.click(addButton);

      const keyInput = screen.getByPlaceholderText("Key");
      const valueInput = screen.getByPlaceholderText("Value");

      expect(keyInput).toHaveAttribute("placeholder", "Key");
      expect(valueInput).toHaveAttribute("placeholder", "Value");
    });
  });

  describe("Edge Cases", () => {
    it("should flag invalid names that contain unsupported characters", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({ onMetadataChange });

      const addButton = screen.getByRole("button", { name: /add entry/i });
      fireEvent.click(addButton);

      const keyInput = screen.getByPlaceholderText("Key");
      const valueInput = screen.getByPlaceholderText("Value");

      fireEvent.change(keyInput, {
        target: { value: "key-with-special@chars!" },
      });
      fireEvent.change(valueInput, {
        target: { value: "value with spaces & symbols $%^" },
      });

      expect(screen.getByText(META_NAME_RULES_MESSAGE)).toBeInTheDocument();
      expect(onMetadataChange).toHaveBeenLastCalledWith({});
    });

    it("should reject unicode names that do not start with an alphanumeric character", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({ onMetadataChange });

      const addButton = screen.getByRole("button", { name: /add entry/i });
      fireEvent.click(addButton);

      const keyInput = screen.getByPlaceholderText("Key");
      const valueInput = screen.getByPlaceholderText("Value");

      fireEvent.change(keyInput, { target: { value: "🔑_key" } });
      fireEvent.change(valueInput, { target: { value: "值_value_🎯" } });

      expect(screen.getByText(META_NAME_RULES_MESSAGE)).toBeInTheDocument();
      expect(onMetadataChange).toHaveBeenLastCalledWith({});
    });

    it("should handle very long keys and values", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({ onMetadataChange });

      const addButton = screen.getByRole("button", { name: /add entry/i });
      fireEvent.click(addButton);

      const keyInput = screen.getByPlaceholderText("Key");
      const valueInput = screen.getByPlaceholderText("Value");

      const longKey = "A".repeat(100);
      const longValue = "B".repeat(500);

      fireEvent.change(keyInput, { target: { value: longKey } });
      fireEvent.change(valueInput, { target: { value: longValue } });

      expect(onMetadataChange).toHaveBeenCalledWith({
        [longKey]: longValue,
      });
    });

    it("should handle duplicate keys by keeping the last one", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({ onMetadataChange });

      const addButton = screen.getByRole("button", { name: /add entry/i });
      fireEvent.click(addButton);
      fireEvent.click(addButton);

      const keyInputs = screen.getAllByPlaceholderText("Key");
      const valueInputs = screen.getAllByPlaceholderText("Value");

      // Set same key for both entries
      fireEvent.change(keyInputs[0], { target: { value: "duplicateKey" } });
      fireEvent.change(valueInputs[0], { target: { value: "firstValue" } });

      fireEvent.change(keyInputs[1], { target: { value: "duplicateKey" } });
      fireEvent.change(valueInputs[1], { target: { value: "secondValue" } });

      // The second value should overwrite the first
      expect(onMetadataChange).toHaveBeenCalledWith({
        duplicateKey: "secondValue",
      });
    });
  });

  describe("Integration with Parent Component", () => {
    it("should not call onMetadataChange when component mounts with existing data", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({
        metadata: { key1: "value1" },
        onMetadataChange,
      });

      expect(onMetadataChange).not.toHaveBeenCalled();
    });

    it("should call onMetadataChange only when user makes changes", () => {
      const onMetadataChange = jest.fn();
      renderMetadataTab({
        metadata: { key1: "value1" },
        onMetadataChange,
      });

      // Should not be called on mount
      expect(onMetadataChange).not.toHaveBeenCalled();

      // Should be called when user changes value
      const valueInput = screen.getByDisplayValue("value1");
      fireEvent.change(valueInput, { target: { value: "newValue" } });

      expect(onMetadataChange).toHaveBeenCalledTimes(1);
      expect(onMetadataChange).toHaveBeenCalledWith({ key1: "newValue" });
    });

    it("should maintain internal state when props change (component doesn't sync with prop changes)", () => {
      const { rerender } = renderMetadataTab({
        metadata: { key1: "value1" },
      });

      expect(screen.getByDisplayValue("key1")).toBeInTheDocument();
      expect(screen.getByDisplayValue("value1")).toBeInTheDocument();

      // Rerender with different props - component should maintain its internal state
      // This is the intended behavior since useState initializer only runs once
      rerender(
        <Tabs defaultValue="metadata">
          <MetadataTab
            metadata={{ key2: "value2", key3: "value3" }}
            onMetadataChange={jest.fn()}
          />
        </Tabs>,
      );

      // The component should still show the original values since it maintains internal state
      expect(screen.getByDisplayValue("key1")).toBeInTheDocument();
      expect(screen.getByDisplayValue("value1")).toBeInTheDocument();
      // The new prop values should not be displayed
      expect(screen.queryByDisplayValue("key2")).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue("value2")).not.toBeInTheDocument();
    });
  });
});
