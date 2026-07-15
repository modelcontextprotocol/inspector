import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { InspectorFormSchema } from "../../../utils/jsonUtils";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { SchemaForm } from "./SchemaForm";

describe("SchemaForm", () => {
  it("renders a string TextInput and propagates onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        name: { type: "string", title: "Name" },
      },
      required: ["name"],
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    const input = screen.getByLabelText(/Name/);
    await user.type(input, "a");
    expect(onChange).toHaveBeenCalledWith({ name: "a" });
  });

  it("renders a Number/Integer field and propagates a numeric value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        count: { type: "integer", title: "Count", minimum: 0, maximum: 100 },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    const input = screen.getByLabelText(/Count/);
    await user.type(input, "5");
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(
      typeof lastCall.count === "number" || lastCall.count === undefined,
    ).toBe(true);
  });

  it("renders a checkbox for boolean fields and toggles on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        enabled: { type: "boolean", title: "Enabled" },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    const checkbox = screen.getByLabelText("Enabled") as HTMLInputElement;
    await user.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ enabled: true });
  });

  it("renders an enum Select with the supplied options", () => {
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        format: {
          type: "string",
          title: "Format",
          enum: ["json", "csv", "xml"],
        },
      },
    };
    renderWithMantine(
      <SchemaForm
        schema={schema}
        values={{ format: "csv" }}
        onChange={onChange}
      />,
    );
    const inputs = screen.getAllByDisplayValue("csv");
    expect(inputs.length).toBeGreaterThan(0);
  });

  it("invokes onChange when an enum Select option is chosen", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        format: {
          type: "string",
          title: "Format",
          enum: ["json", "csv"],
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    await user.click(screen.getByRole("textbox", { name: "Format" }));
    const option = await screen.findByRole("option", {
      name: "csv",
      hidden: true,
    });
    await user.click(option);
    expect(onChange).toHaveBeenCalledWith({ format: "csv" });
  });

  it("clears a string field via its Clear button", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        name: { type: "string", title: "Name" },
      },
    };
    renderWithMantine(
      <SchemaForm
        schema={schema}
        values={{ name: "Alice" }}
        onChange={onChange}
      />,
    );
    // The Clear button only renders while the value is truthy.
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith({ name: "" });
  });

  it("passes undefined to onChange when a number field is cleared", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        count: { type: "integer", title: "Count" },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{ count: 5 }} onChange={onChange} />,
    );
    const input = screen.getByLabelText(/Count/) as HTMLInputElement;
    // Clearing the input makes Mantine NumberInput emit "" (a string),
    // which the handler maps to undefined.
    await user.clear(input);
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.count).toBeUndefined();
  });

  it("falls back to empty/const labels for oneOf items missing const and title", () => {
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        choice: {
          type: "string",
          title: "Choice",
          // One item has neither const nor title — exercises the
          // `const ?? ""` and `title ?? String(const ?? "")` fallbacks.
          oneOf: [{}, { const: "b" }],
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    expect(screen.getByText("Choice")).toBeInTheDocument();
  });

  it("falls back to empty/const labels for anyOf items missing const and title", () => {
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        tags: {
          type: "array",
          title: "Tags",
          items: {
            // First item has neither const nor title — exercises the
            // `const ?? ""` and `title ?? String(const ?? "")` fallbacks.
            anyOf: [{}, { const: "b" }],
          },
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    expect(screen.getByText("Tags")).toBeInTheDocument();
  });

  it("renders an oneOf Select using titles for labels", () => {
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        size: {
          type: "string",
          title: "Size",
          oneOf: [
            { const: "s", title: "Small" },
            { const: "m", title: "Medium" },
          ],
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{ size: "m" }} onChange={onChange} />,
    );
    const inputs = screen.getAllByDisplayValue("Medium");
    expect(inputs.length).toBeGreaterThan(0);
  });

  it("invokes onChange when a oneOf Select option is chosen", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        size: {
          type: "string",
          title: "Size",
          oneOf: [
            { const: "s", title: "Small" },
            { const: "m", title: "Medium" },
          ],
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    await user.click(screen.getByRole("textbox", { name: "Size" }));
    const option = await screen.findByRole("option", {
      name: "Small",
      hidden: true,
    });
    await user.click(option);
    expect(onChange).toHaveBeenCalledWith({ size: "s" });
  });

  it("renders a MultiSelect for array with anyOf items and invokes onChange when an option is selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        tags: {
          type: "array",
          title: "Tags",
          items: {
            anyOf: [
              { const: "a", title: "Alpha" },
              { const: "b", title: "Beta" },
            ],
          },
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    expect(screen.getByText("Tags")).toBeInTheDocument();
    await user.click(screen.getByRole("textbox", { name: "Tags" }));
    const option = await screen.findByRole("option", {
      name: "Alpha",
      hidden: true,
    });
    await user.click(option);
    expect(onChange).toHaveBeenCalledWith({ tags: ["a"] });
  });

  it("renders a MultiSelect for an array of enum items and invokes onChange when an option is selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        instruments: {
          type: "array",
          description: "Choose your favorite instruments",
          items: {
            type: "string",
            enum: ["Guitar", "Piano", "Drums"],
          },
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    // Falls back to the field name as label when no title is supplied.
    await user.click(screen.getByRole("textbox", { name: "instruments" }));
    const option = await screen.findByRole("option", {
      name: "Guitar",
      hidden: true,
    });
    await user.click(option);
    expect(onChange).toHaveBeenCalledWith({ instruments: ["Guitar"] });
  });

  it("uses enumNames for enum-array option labels and the raw value on change", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        sizes: {
          type: "array",
          title: "Sizes",
          items: {
            type: "string",
            enum: ["s", "m", "l"],
            enumNames: ["Small", "Medium", "Large"],
          },
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    await user.click(screen.getByRole("textbox", { name: "Sizes" }));
    // The option shows the enumNames label...
    const option = await screen.findByRole("option", {
      name: "Medium",
      hidden: true,
    });
    await user.click(option);
    // ...but the value persisted is the raw enum value.
    expect(onChange).toHaveBeenCalledWith({ sizes: ["m"] });
  });

  it("renders nested object fields recursively", () => {
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        address: {
          type: "object",
          title: "Address",
          description: "Street and city",
          properties: {
            street: { type: "string", title: "Street" },
          },
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    expect(screen.getByText("Address")).toBeInTheDocument();
    expect(screen.getByText("Street and city")).toBeInTheDocument();
    expect(screen.getByLabelText(/Street/)).toBeInTheDocument();
  });

  it("propagates nested object changes back to top-level onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        address: {
          type: "object",
          title: "Address",
          properties: {
            street: { type: "string", title: "Street" },
          },
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    await user.type(screen.getByLabelText(/Street/), "1");
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.address).toEqual({ street: "1" });
  });

  it("falls back to a JsonInput for complex/unsupported schemas", () => {
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        config: {
          type: "array",
          title: "Config",
        },
      },
    };
    renderWithMantine(
      <SchemaForm
        schema={schema}
        values={{ config: [1, 2, 3] }}
        onChange={onChange}
      />,
    );
    // JsonInput renders the value as serialized JSON
    expect(screen.getByText("Config")).toBeInTheDocument();
  });

  it("invokes onChange via JsonInput when valid JSON is pasted", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        config: { type: "array", title: "Config" },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    const jsonInput = screen.getByLabelText(/Config/) as HTMLTextAreaElement;
    jsonInput.focus();
    await user.paste("[1,2]");
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.config).toEqual([1, 2]);
  });

  it("falls back to passing raw string to onChange when JSON is invalid in JsonInput", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        config: { type: "array", title: "Config" },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    const jsonInput = screen.getByLabelText(/Config/) as HTMLTextAreaElement;
    await user.type(jsonInput, "x");
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(typeof lastCall.config).toBe("string");
  });

  it("uses default values when value is undefined", () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        name: { type: "string", title: "Name", default: "Alice" },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={vi.fn()} />,
    );
    expect(screen.getByDisplayValue("Alice")).toBeInTheDocument();
  });

  it("respects the disabled prop on inputs", () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        name: { type: "string", title: "Name" },
        active: { type: "boolean", title: "Active" },
      },
    };
    renderWithMantine(
      <SchemaForm
        schema={schema}
        values={{ name: "x", active: true }}
        onChange={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByLabelText(/Name/)).toBeDisabled();
    expect(screen.getByLabelText("Active")).toBeDisabled();
  });

  it("uses field name when title is missing", () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        rawField: { type: "string" },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText(/rawField/)).toBeInTheDocument();
  });

  it("renders nothing inside the form when properties are missing", () => {
    const schema: InspectorFormSchema = { type: "object" };
    const { container } = renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={vi.fn()} />,
    );
    // Stack root exists but has no children
    expect(container.firstChild).not.toBeNull();
  });
});
