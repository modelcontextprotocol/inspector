import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, jest } from "@jest/globals";
import DynamicJsonForm from "../DynamicJsonForm";
import type { JsonSchemaType } from "@/utils/jsonUtils";

describe("DynamicJsonForm Complex Array Support", () => {
  // Test case for Issue #332: Complex arrays should render structured forms
  const complexOrderSchema = {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: "Order items",
        items: {
          type: "object",
          properties: {
            productName: { 
              type: "string",
              description: "Name of the product"
            },
            quantity: { 
              type: "number",
              description: "Quantity ordered"
            },
            unitPrice: { 
              type: "number",
              description: "Price per unit"
            },
            category: { 
              type: "string",
              description: "Product category",
              enum: ["electronics", "clothing", "books", "home", "other"]
            },
            metadata: {
              type: "object",
              properties: {
                weight: { 
                  type: "number",
                  description: "Weight in kg"
                },
                dimensions: {
                  type: "object",
                  properties: {
                    length: { type: "number" },
                    width: { type: "number" },
                    height: { type: "number" }
                  }
                }
              }
            }
          }
        }
      }
    }
  } as unknown as JsonSchemaType;

  const renderComplexOrderForm = (props = {}) => {
    const defaultProps = {
      schema: complexOrderSchema,
      value: { items: [] },
      onChange: jest.fn(),
    };
    return render(<DynamicJsonForm {...defaultProps} {...props} />);
  };

  describe("Complex Array Rendering (Issue #332)", () => {
    it("should render structured form for complex arrays instead of JSON editor", () => {
      renderComplexOrderForm();

      // Should show "Add Item" button for the items array
      expect(screen.getByText("Add Item")).toBeInTheDocument();
      
      // Should NOT show JSON editor controls
      expect(screen.queryByText("Copy JSON")).toBeNull();
      expect(screen.queryByText("Format JSON")).toBeNull();
      
      // Should show array description
      expect(screen.getByText("Order items")).toBeInTheDocument();
    });

    it("should add complex array items with structured fields", () => {
      const onChange = jest.fn();
      renderComplexOrderForm({ onChange });

      // Click "Add Item" button
      const addButton = screen.getByText("Add Item");
      fireEvent.click(addButton);

      // Should call onChange with a new item containing default values
      expect(onChange).toHaveBeenCalledWith({
        items: [{}] // Default object for complex item
      });
    });

    it("should render individual form fields for complex array items", () => {
      const initialValue = {
        items: [{
          productName: "Test Product",
          quantity: 2,
          unitPrice: 29.99,
          category: "electronics",
          metadata: {
            weight: 1.5,
            dimensions: {
              length: 10,
              width: 5,
              height: 3
            }
          }
        }]
      };

      renderComplexOrderForm({ value: initialValue });

      // Should show structured fields for the item
      expect(screen.getByDisplayValue("Test Product")).toBeInTheDocument();
      expect(screen.getByDisplayValue("2")).toBeInTheDocument();
      expect(screen.getByDisplayValue("29.99")).toBeInTheDocument();
      
      // Should show enum dropdown for category
      expect(screen.getByDisplayValue("electronics")).toBeInTheDocument();
      
      // Should show nested object fields
      expect(screen.getByDisplayValue("1.5")).toBeInTheDocument(); // weight
      expect(screen.getByDisplayValue("10")).toBeInTheDocument(); // length
      expect(screen.getByDisplayValue("5")).toBeInTheDocument(); // width
      expect(screen.getByDisplayValue("3")).toBeInTheDocument(); // height

      // Should show "Remove" button for the item
      expect(screen.getByText("Remove")).toBeInTheDocument();
    });

    it("should handle enum fields as dropdowns", () => {
      const initialValue = {
        items: [{
          productName: "Test Product",
          category: "electronics"
        }]
      };

      renderComplexOrderForm({ value: initialValue });

      // Should render category as a select dropdown
      const categorySelect = screen.getByDisplayValue("electronics");
      expect(categorySelect.tagName).toBe("SELECT");
      
      // Should have all enum options
      const options = categorySelect.querySelectorAll("option");
      const optionValues = Array.from(options).map(option => option.getAttribute("value"));
      expect(optionValues).toContain("electronics");
      expect(optionValues).toContain("clothing");
      expect(optionValues).toContain("books");
      expect(optionValues).toContain("home");
      expect(optionValues).toContain("other");
    });

    it("should update complex array item values", () => {
      const onChange = jest.fn();
      const initialValue = {
        items: [{
          productName: "Test Product",
          quantity: 1
        }]
      };

      renderComplexOrderForm({ value: initialValue, onChange });

      // Update product name
      const productNameInput = screen.getByDisplayValue("Test Product");
      fireEvent.change(productNameInput, { target: { value: "Updated Product" } });

      expect(onChange).toHaveBeenCalledWith({
        items: [{
          productName: "Updated Product",
          quantity: 1
        }]
      });
    });

    it("should remove complex array items", () => {
      const onChange = jest.fn();
      const initialValue = {
        items: [
          { productName: "Product 1" },
          { productName: "Product 2" }
        ]
      };

      renderComplexOrderForm({ value: initialValue, onChange });

      // Should show two items
      expect(screen.getByDisplayValue("Product 1")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Product 2")).toBeInTheDocument();

      // Click first "Remove" button
      const removeButtons = screen.getAllByText("Remove");
      fireEvent.click(removeButtons[0]);

      expect(onChange).toHaveBeenCalledWith({
        items: [{ productName: "Product 2" }]
      });
    });

    it("should handle deeply nested objects in array items", () => {
      const initialValue = {
        items: [{
          metadata: {
            dimensions: {
              length: 10,
              width: 5,
              height: 3
            }
          }
        }]
      };

      renderComplexOrderForm({ value: initialValue });

      // Should render nested object fields as structured forms, not JSON
      expect(screen.getByDisplayValue("10")).toBeInTheDocument(); // length
      expect(screen.getByDisplayValue("5")).toBeInTheDocument(); // width  
      expect(screen.getByDisplayValue("3")).toBeInTheDocument(); // height

      // Should show proper labels for nested fields
      expect(screen.getByText("metadata")).toBeInTheDocument();
      expect(screen.getByText("dimensions")).toBeInTheDocument();
      expect(screen.getByText("length")).toBeInTheDocument();
      expect(screen.getByText("width")).toBeInTheDocument();
      expect(screen.getByText("height")).toBeInTheDocument();
    });
  });

  describe("Regression Tests", () => {
    it("should still work with simple arrays", () => {
      const simpleArraySchema: JsonSchemaType = {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string" }
          }
        }
      };

      render(
        <DynamicJsonForm 
          schema={simpleArraySchema}
          value={{ tags: ["tag1", "tag2"] }}
          onChange={jest.fn()}
        />
      );

      // Should still show "Add Item" for simple arrays
      expect(screen.getByText("Add Item")).toBeInTheDocument();
      expect(screen.getByDisplayValue("tag1")).toBeInTheDocument();
      expect(screen.getByDisplayValue("tag2")).toBeInTheDocument();
    });

    it("should still fall back to JSON editor for extremely complex structures", () => {
      // Create a schema that exceeds our depth limit
      const veryComplexSchema: JsonSchemaType = {
        type: "array",
        items: {
          type: "object",
          properties: {
            level1: {
              type: "object",
              properties: {
                level2: {
                  type: "object", 
                  properties: {
                    level3: {
                      type: "object",
                      properties: {
                        level4: {
                          type: "object",
                          properties: {
                            level5: {
                              type: "object",
                              properties: {
                                tooDeep: { type: "string" }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      };

      render(
        <DynamicJsonForm 
          schema={veryComplexSchema}
          value={[]}
          onChange={jest.fn()}
        />
      );

      // Should fall back to JSON editor for overly complex structures
      expect(screen.queryByText("Add Item")).toBeNull();
      expect(screen.getByText("Copy JSON")).toBeInTheDocument();
    });
  });
});
