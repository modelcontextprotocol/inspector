import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, jest } from "@jest/globals";
import DynamicJsonForm from "../DynamicJsonForm";
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
