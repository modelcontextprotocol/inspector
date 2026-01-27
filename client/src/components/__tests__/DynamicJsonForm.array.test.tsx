import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, jest } from "@jest/globals";
import DynamicJsonForm from "../DynamicJsonForm";
import type { JsonSchemaType } from "@/utils/jsonUtils";

describe("DynamicJsonForm Array Fields", () => {
  const renderSimpleArrayForm = (props = {}) => {
    const defaultProps = {
      schema: {
        type: "array" as const,
        description: "Test array field",
        items: {
          type: "string" as const,
          description: "Array item",
        },
      } satisfies JsonSchemaType,
      value: [],
      onChange: jest.fn(),
    };
    return render(<DynamicJsonForm {...defaultProps} {...props} />);
  };

  const renderComplexArrayForm = (props = {}) => {
    const defaultProps = {
      schema: {
        type: "array" as const,
        description: "Test complex array field",
        items: {
          type: "object" as const,
          properties: {
            nested: { type: "object" as const },
          },
        },
      } satisfies JsonSchemaType,
      value: [],
      onChange: jest.fn(),
    };
    return render(<DynamicJsonForm {...defaultProps} {...props} />);
  };

  describe("Simple Array Rendering", () => {
    it("should render form fields for simple array items", () => {
      renderSimpleArrayForm({ value: ["item1", "item2"] });

      // Should show array description
      expect(screen.getByText("Test array field")).toBeDefined();
      expect(screen.getByText("Items: Array item")).toBeDefined();

      // Should show input fields for each item
      const inputs = screen.getAllByRole("textbox");
      expect(inputs).toHaveLength(2);
      expect(inputs[0]).toHaveProperty("value", "item1");
      expect(inputs[1]).toHaveProperty("value", "item2");

      // Should show remove buttons
      const removeButtons = screen.getAllByText("Remove");
      expect(removeButtons).toHaveLength(2);

      // Should show add button
      expect(screen.getByText("Add Item")).toBeDefined();
    });

    it("should add new items when Add Item button is clicked", () => {
      const onChange = jest.fn();
      renderSimpleArrayForm({ value: ["item1"], onChange });

      const addButton = screen.getByText("Add Item");
      fireEvent.click(addButton);

      expect(onChange).toHaveBeenCalledWith(["item1", ""]);
    });

    it("should remove items when Remove button is clicked", () => {
      const onChange = jest.fn();
      renderSimpleArrayForm({ value: ["item1", "item2"], onChange });

      const removeButtons = screen.getAllByText("Remove");
      fireEvent.click(removeButtons[0]);

      expect(onChange).toHaveBeenCalledWith(["item2"]);
    });

    it("should update item values when input changes", () => {
      const onChange = jest.fn();
      renderSimpleArrayForm({ value: ["item1"], onChange });

      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "updated item" } });

      expect(onChange).toHaveBeenCalledWith(["updated item"]);
    });

    it("should handle empty arrays", () => {
      renderSimpleArrayForm({ value: [] });

      // Should show description and add button but no items
      expect(screen.getByText("Test array field")).toBeDefined();
      expect(screen.getByText("Add Item")).toBeDefined();
      expect(screen.queryByText("Remove")).toBeNull();
    });
  });

  describe("Complex Array Fallback", () => {
    it("should render JSON editor for complex arrays", () => {
      renderComplexArrayForm();

      // Initially renders form view with Switch to JSON button; switch to JSON to see textarea
      const switchBtn = screen.getByRole("button", { name: /switch to json/i });
      expect(switchBtn).toBeInTheDocument();
      fireEvent.click(switchBtn);

      const textarea = screen.getByRole("textbox");
      expect(textarea).toHaveProperty("type", "textarea");

      // Should not show form-specific array controls
      expect(screen.queryByText("Add Item")).toBeNull();
      expect(screen.queryByText("Remove")).toBeNull();
    });
  });

  describe("Array Type Detection", () => {
    it("should detect string arrays as simple", () => {
      const schema = {
        type: "array" as const,
        items: { type: "string" as const },
      };
      renderSimpleArrayForm({ schema, value: ["test"] });

      // Should render form fields, not JSON editor
      expect(screen.getByRole("textbox")).not.toHaveProperty(
        "type",
        "textarea",
      );
    });

    it("should detect number arrays as simple", () => {
      const schema = {
        type: "array" as const,
        items: { type: "number" as const },
      };
      renderSimpleArrayForm({ schema, value: [1, 2] });

      // Should render form fields (number inputs)
      const inputs = screen.getAllByRole("spinbutton");
      expect(inputs).toHaveLength(2);
    });

    it("should detect boolean arrays as simple", () => {
      const schema = {
        type: "array" as const,
        items: { type: "boolean" as const },
      };
      renderSimpleArrayForm({ schema, value: [true, false] });

      // Should render form fields (checkboxes)
      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes).toHaveLength(2);
    });

    it("should detect simple object arrays as simple", () => {
      const schema = {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            name: { type: "string" as const },
            age: { type: "number" as const },
          },
        },
      };
      renderSimpleArrayForm({ schema, value: [{ name: "John", age: 30 }] });

      // Should render form fields for simple objects
      expect(screen.getByText("Add Item")).toBeDefined();
      expect(screen.getByText("Remove")).toBeDefined();
    });
  });

  describe("Array with Different Item Types", () => {
    it("should render multi-select for untitled items.enum with helper text", () => {
      const schema: JsonSchemaType = {
        type: "array",
        title: "Colors",
        description: "Pick colors",
        minItems: 1,
        maxItems: 3,
        items: { type: "string", enum: ["red", "green", "blue"] },
      } as JsonSchemaType;
      const onChange = jest.fn();
      render(
        <DynamicJsonForm schema={schema} value={["red"]} onChange={onChange} />,
      );

      // Description visible
      expect(screen.getByText("Pick colors")).toBeInTheDocument();
      // Multi-select present
      const listbox = screen.getByRole("listbox");
      expect(listbox).toHaveAttribute("multiple");

      // Helper text shows min/max
      expect(screen.getByText(/Select at least 1/i)).toBeInTheDocument();
      expect(screen.getByText(/Select at most 3/i)).toBeInTheDocument();

      // Select another option by toggling option.selected
      const colorOptions = screen.getAllByRole("option");
      // options: red, green, blue
      colorOptions[0].selected = true; // red
      colorOptions[2].selected = true; // blue
      fireEvent.change(listbox);
      expect(onChange).toHaveBeenCalledWith(["red", "blue"]);
    });

    it("should render titled multi-select for items.anyOf with const/title", () => {
      const schema: JsonSchemaType = {
        type: "array",
        description: "Pick fish",
        items: {
          anyOf: [
            { const: "fish-1", title: "Tuna" },
            { const: "fish-2", title: "Salmon" },
            { const: "fish-3", title: "Trout" },
          ],
        } as unknown as JsonSchemaType,
      } as unknown as JsonSchemaType;
      const onChange = jest.fn();
      render(
        <DynamicJsonForm
          schema={schema}
          value={["fish-1"]}
          onChange={onChange}
        />,
      );

      // Description visible
      expect(screen.getByText("Pick fish")).toBeInTheDocument();

      const listbox = screen.getByRole("listbox");
      expect(listbox).toHaveAttribute("multiple");

      // Ensure options have titles as labels
      const options = screen.getAllByRole("option");
      expect(options[0]).toHaveProperty("textContent", "Tuna");
      expect(options[1]).toHaveProperty("textContent", "Salmon");
      expect(options[2]).toHaveProperty("textContent", "Trout");

      // Select fish-2 and fish-3
      const fishOptions = screen.getAllByRole("option");
      // options: Tuna (fish-1), Salmon (fish-2), Trout (fish-3)
      fishOptions[0].selected = false; // deselect fish-1
      fishOptions[1].selected = true; // fish-2
      fishOptions[2].selected = true; // fish-3
      fireEvent.change(listbox);
      expect(onChange).toHaveBeenCalledWith(["fish-2", "fish-3"]);
    });
    it("should handle integer array items", () => {
      const schema = {
        type: "array" as const,
        items: { type: "integer" as const },
      };
      const onChange = jest.fn();
      renderSimpleArrayForm({ schema, value: [1, 2], onChange });

      const inputs = screen.getAllByRole("spinbutton");
      expect(inputs).toHaveLength(2);
      expect(inputs[0]).toHaveProperty("value", "1");
      expect(inputs[1]).toHaveProperty("value", "2");

      // Test adding new integer item
      const addButton = screen.getByText("Add Item");
      fireEvent.click(addButton);
      expect(onChange).toHaveBeenCalledWith([1, 2, 0]);
    });

    it("should handle boolean array items", () => {
      const schema = {
        type: "array" as const,
        items: { type: "boolean" as const },
      };
      const onChange = jest.fn();
      renderSimpleArrayForm({ schema, value: [true, false], onChange });

      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes).toHaveLength(2);
      expect(checkboxes[0]).toHaveProperty("checked", true);
      expect(checkboxes[1]).toHaveProperty("checked", false);

      // Test adding new boolean item
      const addButton = screen.getByText("Add Item");
      fireEvent.click(addButton);
      expect(onChange).toHaveBeenCalledWith([true, false, false]);
    });
  });

  describe("Array Item Descriptions", () => {
    it("should show item description when available", () => {
      const schema = {
        type: "array" as const,
        description: "List of names",
        items: {
          type: "string" as const,
          description: "Person name",
        },
      };
      renderSimpleArrayForm({ schema });

      expect(screen.getByText("List of names")).toBeDefined();
      expect(screen.getByText("Items: Person name")).toBeDefined();
    });

    it("should use item description in add button title", () => {
      const schema = {
        type: "array" as const,
        items: {
          type: "string" as const,
          description: "Email address",
        },
      };
      renderSimpleArrayForm({ schema });

      const addButton = screen.getByText("Add Item");
      expect(addButton).toHaveProperty("title", "Add new Email address");
    });

    it("should use default title when no item description", () => {
      const schema = {
        type: "array" as const,
        items: { type: "string" as const },
      };
      renderSimpleArrayForm({ schema });

      const addButton = screen.getByText("Add Item");
      expect(addButton).toHaveProperty("title", "Add new item");
    });
  });
});
