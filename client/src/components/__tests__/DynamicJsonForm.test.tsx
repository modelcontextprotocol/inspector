import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, jest } from "@jest/globals";
import { useRef } from "react";
import DynamicJsonForm, { DynamicJsonFormRef } from "../DynamicJsonForm";
import type { JsonSchemaType } from "@/utils/jsonUtils";

describe("DynamicJsonForm String Fields", () => {
  const renderForm = (props = {}) => {
    const defaultProps = {
      schema: {
        type: "string" as const,
        description: "Test string field",
      } satisfies JsonSchemaType,
      value: undefined,
      onChange: jest.fn(),
    };
    return render(<DynamicJsonForm {...defaultProps} {...props} />);
  };

  describe("Type Validation", () => {
    it("should handle numeric input as string type", () => {
      const onChange = jest.fn();
      renderForm({ onChange });

      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "123321" } });

      expect(onChange).toHaveBeenCalledWith("123321");
      // Verify the value is a string, not a number
      expect(typeof onChange.mock.calls[0][0]).toBe("string");
    });

    it("should render as text input, not number input", () => {
      renderForm();
      const input = screen.getByRole("textbox");
      expect(input).toHaveProperty("type", "text");
    });

    it("should handle a union type of string and null", () => {
      const schema: JsonSchemaType = {
        type: ["string", "null"],
        description: "Test string or null field",
      };
      render(
        <DynamicJsonForm schema={schema} value={null} onChange={jest.fn()} />,
      );
      const input = screen.getByRole("textbox");
      expect(input).toHaveProperty("type", "text");
    });
  });

  describe("Format Support", () => {
    it("should render email input for email format", () => {
      const schema: JsonSchemaType = {
        type: "string",
        format: "email",
        description: "Email address",
      };
      render(<DynamicJsonForm schema={schema} value="" onChange={jest.fn()} />);

      const input = screen.getByRole("textbox");
      expect(input).toHaveProperty("type", "email");
    });

    it("should render url input for uri format", () => {
      const schema: JsonSchemaType = {
        type: "string",
        format: "uri",
        description: "Website URL",
      };
      render(<DynamicJsonForm schema={schema} value="" onChange={jest.fn()} />);

      const input = screen.getByRole("textbox");
      expect(input).toHaveProperty("type", "url");
    });

    it("should render date input for date format", () => {
      const schema: JsonSchemaType = {
        type: "string",
        format: "date",
        description: "Birth date",
      };
      render(<DynamicJsonForm schema={schema} value="" onChange={jest.fn()} />);

      const input = screen.getByDisplayValue("");
      expect(input).toHaveProperty("type", "date");
    });

    it("should render datetime-local input for date-time format", () => {
      const schema: JsonSchemaType = {
        type: "string",
        format: "date-time",
        description: "Event datetime",
      };
      render(<DynamicJsonForm schema={schema} value="" onChange={jest.fn()} />);

      const input = screen.getByDisplayValue("");
      expect(input).toHaveProperty("type", "datetime-local");
    });
  });

  describe("Enum Support", () => {
    it("should render select dropdown for enum fields", () => {
      const schema: JsonSchemaType = {
        type: "string",
        enum: ["option1", "option2", "option3"],
        description: "Select an option",
      };
      render(<DynamicJsonForm schema={schema} value="" onChange={jest.fn()} />);

      const select = screen.getByRole("combobox");
      expect(select.tagName).toBe("SELECT");

      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(4);
    });

    it("should use oneOf with const and title for labeled options", () => {
      const schema: JsonSchemaType = {
        type: "string",
        oneOf: [
          { const: "val1", title: "Label 1" },
          { const: "val2", title: "Label 2" },
        ],
        description: "Select with labels",
      };
      render(<DynamicJsonForm schema={schema} value="" onChange={jest.fn()} />);

      const options = screen.getAllByRole("option");
      expect(options[1]).toHaveProperty("textContent", "Label 1");
      expect(options[2]).toHaveProperty("textContent", "Label 2");
    });

    it("should call onChange with selected oneOf value", () => {
      const onChange = jest.fn();
      const schema: JsonSchemaType = {
        type: "string",
        oneOf: [
          { const: "option1", title: "Option 1" },
          { const: "option2", title: "Option 2" },
        ],
        description: "Select an option",
      };
      render(<DynamicJsonForm schema={schema} value="" onChange={onChange} />);

      const select = screen.getByRole("combobox");
      fireEvent.change(select, { target: { value: "option1" } });

      expect(onChange).toHaveBeenCalledWith("option1");
    });

    it("should call onChange with selected enum value", () => {
      const onChange = jest.fn();
      const schema: JsonSchemaType = {
        type: "string",
        enum: ["option1", "option2"],
        description: "Select an option",
      };
      render(<DynamicJsonForm schema={schema} value="" onChange={onChange} />);

      const select = screen.getByRole("combobox");
      fireEvent.change(select, { target: { value: "option1" } });

      expect(onChange).toHaveBeenCalledWith("option1");
    });

    it("should render JSON Schema spec compliant oneOf with const for labeled enums", () => {
      // Example from JSON Schema spec: labeled enums using oneOf with const
      const onChange = jest.fn();
      const schema: JsonSchemaType = {
        type: "string",
        title: "Traffic Light",
        description: "Select a traffic light color",
        oneOf: [
          { const: "red", title: "Stop" },
          { const: "amber", title: "Caution" },
          { const: "green", title: "Go" },
        ],
      };
      render(<DynamicJsonForm schema={schema} value="" onChange={onChange} />);

      // Should render as a select dropdown
      const select = screen.getByRole("combobox");
      expect(select.tagName).toBe("SELECT");

      // Should have options with proper labels
      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(4); // 3 options + 1 default "Select an option..."

      expect(options[0]).toHaveProperty("textContent", "Select an option...");
      expect(options[1]).toHaveProperty("textContent", "Stop");
      expect(options[2]).toHaveProperty("textContent", "Caution");
      expect(options[3]).toHaveProperty("textContent", "Go");

      // Should have proper values
      expect(options[1]).toHaveProperty("value", "red");
      expect(options[2]).toHaveProperty("value", "amber");
      expect(options[3]).toHaveProperty("value", "green");

      // Test onChange behavior
      fireEvent.change(select, { target: { value: "amber" } });
      expect(onChange).toHaveBeenCalledWith("amber");
    });
  });

  describe("Validation Attributes", () => {
    it("should apply minLength and maxLength", () => {
      const schema: JsonSchemaType = {
        type: "string",
        minLength: 3,
        maxLength: 10,
        description: "Username",
      };
      render(<DynamicJsonForm schema={schema} value="" onChange={jest.fn()} />);

      const input = screen.getByRole("textbox");
      expect(input).toHaveProperty("minLength", 3);
      expect(input).toHaveProperty("maxLength", 10);
    });

    it("should apply pattern validation", () => {
      const schema: JsonSchemaType = {
        type: "string",
        pattern: "^[A-Za-z]+$",
        description: "Letters only",
      };
      render(<DynamicJsonForm schema={schema} value="" onChange={jest.fn()} />);

      const input = screen.getByRole("textbox");
      expect(input).toHaveProperty("pattern", "^[A-Za-z]+$");
    });
  });
});

describe("DynamicJsonForm Integer Fields", () => {
  const renderForm = (props = {}) => {
    const defaultProps = {
      schema: {
        type: "integer" as const,
        description: "Test integer field",
      } satisfies JsonSchemaType,
      value: undefined,
      onChange: jest.fn(),
    };
    return render(<DynamicJsonForm {...defaultProps} {...props} />);
  };

  describe("Basic Operations", () => {
    it("should render number input with step=1", () => {
      renderForm();
      const input = screen.getByRole("spinbutton");
      expect(input).toHaveProperty("type", "number");
      expect(input).toHaveProperty("step", "1");
    });

    it("should pass integer values to onChange", () => {
      const onChange = jest.fn();
      renderForm({ onChange });

      const input = screen.getByRole("spinbutton");
      fireEvent.change(input, { target: { value: "42" } });

      expect(onChange).toHaveBeenCalledWith(42);
      // Verify the value is a number, not a string
      expect(typeof onChange.mock.calls[0][0]).toBe("number");
    });

    it("should not pass string values to onChange", () => {
      const onChange = jest.fn();
      renderForm({ onChange });

      const input = screen.getByRole("spinbutton");
      fireEvent.change(input, { target: { value: "abc" } });

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("Validation", () => {
    it("should apply min and max constraints", () => {
      const schema: JsonSchemaType = {
        type: "integer",
        minimum: 0,
        maximum: 100,
        description: "Age",
      };
      render(
        <DynamicJsonForm schema={schema} value={0} onChange={jest.fn()} />,
      );

      const input = screen.getByRole("spinbutton");
      expect(input).toHaveProperty("min", "0");
      expect(input).toHaveProperty("max", "100");
    });

    it("should only accept integer values", () => {
      const onChange = jest.fn();
      const schema: JsonSchemaType = {
        type: "integer",
        description: "Count",
      };
      render(<DynamicJsonForm schema={schema} value={0} onChange={onChange} />);

      const input = screen.getByRole("spinbutton");
      fireEvent.change(input, { target: { value: "3.14" } });

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("Edge Cases", () => {
    it("should handle non-numeric input by not calling onChange", () => {
      const onChange = jest.fn();
      renderForm({ onChange });

      const input = screen.getByRole("spinbutton");
      fireEvent.change(input, { target: { value: "abc" } });

      expect(onChange).not.toHaveBeenCalled();
    });
  });
});

describe("DynamicJsonForm Number Fields", () => {
  describe("Validation", () => {
    it("should apply min and max constraints", () => {
      const schema: JsonSchemaType = {
        type: "number",
        minimum: 0.5,
        maximum: 99.9,
        description: "Score",
      };
      render(
        <DynamicJsonForm schema={schema} value={0} onChange={jest.fn()} />,
      );

      const input = screen.getByRole("spinbutton");
      expect(input).toHaveProperty("min", "0.5");
      expect(input).toHaveProperty("max", "99.9");
    });

    it("should accept decimal values", () => {
      const onChange = jest.fn();
      const schema: JsonSchemaType = {
        type: "number",
        description: "Temperature",
      };
      render(<DynamicJsonForm schema={schema} value={0} onChange={onChange} />);

      const input = screen.getByRole("spinbutton");
      fireEvent.change(input, { target: { value: "98.6" } });

      expect(onChange).toHaveBeenCalledWith(98.6);
    });
  });
});

describe("DynamicJsonForm Boolean Fields", () => {
  describe("Basic Operations", () => {
    it("should render checkbox for boolean type", () => {
      const schema: JsonSchemaType = {
        type: "boolean",
        description: "Enable notifications",
      };
      render(
        <DynamicJsonForm schema={schema} value={false} onChange={jest.fn()} />,
      );

      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).toHaveProperty("type", "checkbox");
    });

    it("should call onChange with boolean value", () => {
      const onChange = jest.fn();
      const schema: JsonSchemaType = {
        type: "boolean",
        description: "Accept terms",
      };
      render(
        <DynamicJsonForm schema={schema} value={false} onChange={onChange} />,
      );

      const checkbox = screen.getByRole("checkbox");
      fireEvent.click(checkbox);

      expect(onChange).toHaveBeenCalledWith(true);
    });

    it("should render boolean field with description", () => {
      const schema: JsonSchemaType = {
        type: "boolean",
        description: "Enable dark mode",
      };
      render(
        <DynamicJsonForm schema={schema} value={false} onChange={jest.fn()} />,
      );

      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).toHaveProperty("checked", false);
    });
  });
});

describe("DynamicJsonForm Object Fields", () => {
  describe("Property Rendering", () => {
    it("should render input fields for object properties", () => {
      const schema: JsonSchemaType = {
        type: "object",
        properties: {
          name: {
            type: "string",
            title: "Full Name",
            description: "Your full name",
          },
          age: {
            type: "integer",
            title: "Age",
            description: "Your age in years",
            minimum: 18,
          },
          email: {
            type: "string",
            format: "email",
            title: "Email",
            description: "Your email address",
          },
        },
      };
      render(
        <DynamicJsonForm schema={schema} value={{}} onChange={jest.fn()} />,
      );

      const textInputs = screen.getAllByRole("textbox");
      const numberInput = screen.getByRole("spinbutton");

      expect(textInputs).toHaveLength(2);
      expect(textInputs[0]).toHaveProperty("type", "text");
      expect(textInputs[1]).toHaveProperty("type", "email");
      expect(numberInput).toHaveProperty("type", "number");
      expect(numberInput).toHaveProperty("min", "18");
    });

    it("should handle object field changes correctly", () => {
      const onChange = jest.fn();
      const schema: JsonSchemaType = {
        type: "object",
        properties: {
          username: {
            type: "string",
            description: "Your username",
          },
        },
      };
      render(
        <DynamicJsonForm schema={schema} value={{}} onChange={onChange} />,
      );

      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "testuser" } });

      expect(onChange).toHaveBeenCalledWith({ username: "testuser" });
    });

    it("should handle nested object values correctly", () => {
      const onChange = jest.fn();
      const schema: JsonSchemaType = {
        type: "object",
        properties: {
          name: {
            type: "string",
            title: "Name",
          },
        },
      };
      render(
        <DynamicJsonForm
          schema={schema}
          value={{ name: "John" }}
          onChange={onChange}
        />,
      );

      const input = screen.getByDisplayValue("John");
      fireEvent.change(input, { target: { value: "Jane" } });

      expect(onChange).toHaveBeenCalledWith({ name: "Jane" });
    });
  });

  describe("Required Fields", () => {
    it("should mark required fields with required attribute", () => {
      const schema: JsonSchemaType = {
        type: "object",
        properties: {
          name: {
            type: "string",
            title: "Name",
          },
          email: {
            type: "string",
            title: "Email",
          },
        },
        required: ["name"],
      };
      render(
        <DynamicJsonForm schema={schema} value={{}} onChange={jest.fn()} />,
      );

      const inputs = screen.getAllByRole("textbox");
      const nameInput = inputs[0];
      const emailInput = inputs[1];

      expect(nameInput).toHaveProperty("required", true);
      expect(emailInput).toHaveProperty("required", false);
    });

    it("should mark required fields with required attribute", () => {
      const schema: JsonSchemaType = {
        type: "object",
        properties: {
          name: {
            type: "string",
            title: "Name",
          },
          optional: {
            type: "string",
            title: "Optional",
          },
        },
        required: ["name"],
      };
      render(
        <DynamicJsonForm schema={schema} value={{}} onChange={jest.fn()} />,
      );

      const nameLabel = screen.getByText("name");
      const optionalLabel = screen.getByText("optional");

      const nameInput = nameLabel.closest("div")?.querySelector("input");
      const optionalInput = optionalLabel
        .closest("div")
        ?.querySelector("input");

      expect(nameInput).toHaveProperty("required", true);
      expect(optionalInput).toHaveProperty("required", false);
    });
  });
});

describe("DynamicJsonForm Complex Fields", () => {
  const renderForm = (props = {}) => {
    const defaultProps = {
      schema: {
        type: "object",
        properties: {
          // The simplified JsonSchemaType does not accept oneOf fields
          // But they exist in the more-complete JsonSchema7Type
          nested: { oneOf: [{ type: "string" }, { type: "integer" }] },
        },
      } as unknown as JsonSchemaType,
      value: undefined,
      onChange: jest.fn(),
    };
    return render(<DynamicJsonForm {...defaultProps} {...props} />);
  };

  describe("Basic Operations", () => {
    it("should render textbox and autoformat button, but no switch-to-form button", () => {
      renderForm();
      const input = screen.getByRole("textbox");
      expect(input).toHaveProperty("type", "textarea");
      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(2); // Copy JSON + Format JSON
      const copyButton = screen.getByRole("button", { name: /copy json/i });
      const formatButton = screen.getByRole("button", { name: /format json/i });
      expect(copyButton).toBeTruthy();
      expect(formatButton).toBeTruthy();
    });

    it("should pass changed values to onChange", () => {
      const onChange = jest.fn();
      renderForm({ onChange });

      const input = screen.getByRole("textbox");
      fireEvent.change(input, {
        target: { value: `{ "nested": "i am string" }` },
      });

      // The onChange handler is debounced when using the JSON view, so we need to wait a little bit
      waitFor(() => {
        expect(onChange).toHaveBeenCalledWith(`{ "nested": "i am string" }`);
      });
    });
  });
});

describe("DynamicJsonForm Copy JSON Functionality", () => {
  const mockWriteText = jest.fn(() => Promise.resolve());

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });
  });

  const renderFormInJsonMode = (props = {}) => {
    const defaultProps = {
      schema: {
        type: "object",
        properties: {
          nested: { oneOf: [{ type: "string" }, { type: "integer" }] },
        },
      } as unknown as JsonSchemaType,
      value: { nested: "test value" },
      onChange: jest.fn(),
    };
    return render(<DynamicJsonForm {...defaultProps} {...props} />);
  };

  describe("Copy JSON Button", () => {
    it("should render Copy JSON button when in JSON mode", () => {
      renderFormInJsonMode();

      const copyButton = screen.getByRole("button", { name: "Copy JSON" });
      expect(copyButton).toBeTruthy();
    });

    it("should not render Copy JSON button when not in JSON mode", () => {
      const simpleSchema = {
        type: "string" as const,
        description: "Test string field",
      };

      render(
        <DynamicJsonForm
          schema={simpleSchema}
          value="test"
          onChange={jest.fn()}
        />,
      );

      const copyButton = screen.queryByRole("button", { name: "Copy JSON" });
      expect(copyButton).toBeNull();
    });

    it("should copy JSON to clipboard when clicked", async () => {
      const testValue = { nested: "test value", number: 42 };

      renderFormInJsonMode({ value: testValue });

      const copyButton = screen.getByRole("button", { name: "Copy JSON" });
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(mockWriteText).toHaveBeenCalledWith(
          JSON.stringify(testValue, null, 2),
        );
      });
    });
  });
});

describe("DynamicJsonForm Validation Functionality", () => {
  const renderFormWithRef = (props = {}) => {
    const TestComponent = () => {
      const formRef = useRef<DynamicJsonFormRef>(null);
      const defaultProps = {
        schema: {
          type: "object",
          properties: {
            nested: { oneOf: [{ type: "string" }, { type: "integer" }] },
          },
        } as unknown as JsonSchemaType,
        value: { nested: "test value" },
        onChange: jest.fn(),
        ref: formRef,
      };

      return (
        <div>
          <DynamicJsonForm {...defaultProps} {...props} />
          <button
            onClick={() => {
              const result = formRef.current?.validateJson();
              // Add data attributes to make validation result testable
              const button = document.querySelector(
                '[data-testid="validate-button"]',
              ) as HTMLElement;
              if (button && result) {
                button.setAttribute(
                  "data-validation-valid",
                  result.isValid.toString(),
                );
                button.setAttribute(
                  "data-validation-error",
                  result.error || "",
                );
              }
            }}
            data-testid="validate-button"
          >
            Validate
          </button>
        </div>
      );
    };

    return render(<TestComponent />);
  };

  describe("validateJson method", () => {
    it("should return valid for form mode", () => {
      const simpleSchema = {
        type: "string" as const,
        description: "Test string field",
      };

      const TestComponent = () => {
        const formRef = useRef<DynamicJsonFormRef>(null);

        return (
          <div>
            <DynamicJsonForm
              ref={formRef}
              schema={simpleSchema}
              value="test"
              onChange={jest.fn()}
            />
            <button
              onClick={() => {
                const result = formRef.current?.validateJson();
                const button = document.querySelector(
                  '[data-testid="validate-button"]',
                ) as HTMLElement;
                if (button && result) {
                  button.setAttribute(
                    "data-validation-valid",
                    result.isValid.toString(),
                  );
                  button.setAttribute(
                    "data-validation-error",
                    result.error || "",
                  );
                }
              }}
              data-testid="validate-button"
            >
              Validate
            </button>
          </div>
        );
      };

      render(<TestComponent />);

      const validateButton = screen.getByTestId("validate-button");
      fireEvent.click(validateButton);

      expect(validateButton.getAttribute("data-validation-valid")).toBe("true");
      expect(validateButton.getAttribute("data-validation-error")).toBe("");
    });

    it("should return valid for valid JSON in JSON mode", () => {
      renderFormWithRef();

      const validateButton = screen.getByTestId("validate-button");
      fireEvent.click(validateButton);

      expect(validateButton.getAttribute("data-validation-valid")).toBe("true");
      expect(validateButton.getAttribute("data-validation-error")).toBe("");
    });

    it("should return invalid for malformed JSON in JSON mode", async () => {
      renderFormWithRef();

      // Enter invalid JSON
      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: '{ "invalid": json }' } });

      // Wait a bit for any debounced updates
      await waitFor(() => {
        const validateButton = screen.getByTestId("validate-button");
        fireEvent.click(validateButton);

        expect(validateButton.getAttribute("data-validation-valid")).toBe(
          "false",
        );
        expect(validateButton.getAttribute("data-validation-error")).toContain(
          "JSON",
        );
      });
    });

    it("should return valid for empty JSON in JSON mode", () => {
      renderFormWithRef();

      // Clear the textarea
      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "" } });

      const validateButton = screen.getByTestId("validate-button");
      fireEvent.click(validateButton);

      expect(validateButton.getAttribute("data-validation-valid")).toBe("true");
      expect(validateButton.getAttribute("data-validation-error")).toBe("");
    });

    it("should set error state when validation fails", async () => {
      renderFormWithRef();

      // Enter invalid JSON
      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, {
        target: { value: '{ "trailing": "comma", }' },
      });

      // Trigger validation
      const validateButton = screen.getByTestId("validate-button");
      fireEvent.click(validateButton);

      // Check that validation result shows error
      expect(validateButton.getAttribute("data-validation-valid")).toBe(
        "false",
      );
      expect(validateButton.getAttribute("data-validation-error")).toContain(
        "JSON",
      );
    });
  });

  describe("forwardRef functionality", () => {
    it("should expose validateJson method through ref", () => {
      const TestComponent = () => {
        const formRef = useRef<DynamicJsonFormRef>(null);

        return (
          <div>
            <DynamicJsonForm
              ref={formRef}
              schema={{
                type: "object",
                properties: {
                  test: { type: "string" },
                },
              }}
              value={{ test: "value" }}
              onChange={jest.fn()}
            />
            <button
              onClick={() => {
                const hasValidateMethod =
                  typeof formRef.current?.validateJson === "function";
                const button = document.querySelector(
                  '[data-testid="ref-test-button"]',
                ) as HTMLElement;
                if (button) {
                  button.setAttribute(
                    "data-has-validate-method",
                    hasValidateMethod.toString(),
                  );
                }
              }}
              data-testid="ref-test-button"
            >
              Test Ref
            </button>
          </div>
        );
      };

      render(<TestComponent />);

      const testButton = screen.getByTestId("ref-test-button");
      fireEvent.click(testButton);

      expect(testButton.getAttribute("data-has-validate-method")).toBe("true");
    });
  });
});
