import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { InspectorFormSchema } from "../../../utils/jsonUtils";
import { toFormSchema } from "../../../utils/jsonUtils";
import {
  fireEvent,
  renderWithMantine,
  screen,
  waitFor,
} from "../../../test/renderWithMantine";
import { getAceTextByLabel, setAceTextByLabel } from "../../../test/aceEditor";
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
    const input = screen.getByRole("textbox", { name: /Name/ });
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

  it("uses enumNames for string-enum option labels while submitting the raw value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        pet: {
          type: "string",
          title: "Pet",
          enum: ["pet-1", "pet-2", "pet-3"],
          enumNames: ["Cats", "Dogs", "Birds"],
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    await user.click(screen.getByRole("textbox", { name: "Pet" }));
    // The option shows the enumNames label...
    const option = await screen.findByRole("option", {
      name: "Dogs",
      hidden: true,
    });
    await user.click(option);
    // ...but the value persisted is the raw enum value.
    expect(onChange).toHaveBeenCalledWith({ pet: "pet-2" });
  });

  it("preselects a default string-enum value showing its enumNames label", () => {
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        pet: {
          type: "string",
          title: "Pet",
          enum: ["pet-1", "pet-2", "pet-3"],
          enumNames: ["Cats", "Dogs", "Birds"],
          default: "pet-1",
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    // Default pet-1 preselects and shows its human-readable label.
    expect(screen.getByDisplayValue("Cats")).toBeInTheDocument();
  });

  it("falls back to raw string-enum values when enumNames length mismatches", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        pet: {
          type: "string",
          title: "Pet",
          enum: ["pet-1", "pet-2", "pet-3"],
          // Only two names for three values — a wrong-length zip would
          // mislabel, so the raw values are shown instead.
          enumNames: ["Cats", "Dogs"],
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    await user.click(screen.getByRole("textbox", { name: "Pet" }));
    const option = await screen.findByRole("option", {
      name: "pet-2",
      hidden: true,
    });
    await user.click(option);
    expect(onChange).toHaveBeenCalledWith({ pet: "pet-2" });
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

  describe("number fields (#1888)", () => {
    // The real callers keep the form values in state and feed them back in, so
    // the bug only reproduces against a genuinely controlled SchemaForm: an
    // uncontrolled render never rewrites the box and would pass either way.
    function ControlledSchemaForm({
      schema,
      initialValues = {},
      onChange,
    }: {
      schema: InspectorFormSchema;
      initialValues?: Record<string, unknown>;
      onChange: (values: Record<string, unknown>) => void;
    }) {
      const [values, setValues] =
        useState<Record<string, unknown>>(initialValues);
      return (
        <SchemaForm
          schema={schema}
          values={values}
          onChange={(next) => {
            setValues(next);
            onChange(next);
          }}
        />
      );
    }

    const numberSchema: InspectorFormSchema = {
      type: "object",
      properties: {
        divisor: { type: "number", title: "Divisor" },
      },
    };

    it("lets a decimal be typed all the way through", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithMantine(
        <ControlledSchemaForm schema={numberSchema} onChange={onChange} />,
      );
      const input = screen.getByLabelText(/Divisor/) as HTMLInputElement;
      await user.type(input, "1.5");
      expect(input.value).toBe("1.5");
      expect(onChange).toHaveBeenLastCalledWith({ divisor: 1.5 });
    });

    it("keeps the trailing decimal point visible mid-entry", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithMantine(
        <ControlledSchemaForm schema={numberSchema} onChange={onChange} />,
      );
      const input = screen.getByLabelText(/Divisor/) as HTMLInputElement;
      await user.type(input, "1.");
      // The point survives on screen even though "1." parses to plain 1.
      expect(input.value).toBe("1.");
      expect(onChange).toHaveBeenLastCalledWith({ divisor: 1 });
    });

    it("keeps a trailing zero after the decimal point", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithMantine(
        <ControlledSchemaForm schema={numberSchema} onChange={onChange} />,
      );
      const input = screen.getByLabelText(/Divisor/) as HTMLInputElement;
      await user.type(input, "1.50");
      expect(input.value).toBe("1.50");
      expect(onChange).toHaveBeenLastCalledWith({ divisor: 1.5 });
    });

    it("reports a lone minus sign as no value while leaving it typed", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithMantine(
        <ControlledSchemaForm schema={numberSchema} onChange={onChange} />,
      );
      const input = screen.getByLabelText(/Divisor/) as HTMLInputElement;
      await user.type(input, "-");
      expect(input.value).toBe("-");
      expect(onChange).toHaveBeenLastCalledWith({ divisor: undefined });
      await user.type(input, "2.5");
      expect(onChange).toHaveBeenLastCalledWith({ divisor: -2.5 });
    });

    it("rejects a decimal point in an integer field", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const schema: InspectorFormSchema = {
        type: "object",
        properties: {
          count: { type: "integer", title: "Count" },
        },
      };
      renderWithMantine(
        <ControlledSchemaForm schema={schema} onChange={onChange} />,
      );
      const input = screen.getByLabelText(/Count/) as HTMLInputElement;
      await user.type(input, "1.5");
      expect(input.value).toBe("15");
      expect(onChange).toHaveBeenLastCalledWith({ count: 15 });
    });

    it("reports no value for a magnitude JS cannot hold exactly", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithMantine(
        <ControlledSchemaForm schema={numberSchema} onChange={onChange} />,
      );
      const input = screen.getByLabelText(/Divisor/) as HTMLInputElement;
      // Past Number.MAX_SAFE_INTEGER, Mantine stops emitting a number and hands
      // back the raw string to avoid destroying precision. Number() would round
      // this to ...904, so parsing it would send a value the user never typed.
      await user.type(input, "90071992547409910");
      expect(input.value).toBe("90071992547409910");
      expect(onChange).toHaveBeenLastCalledWith({ divisor: undefined });
    });

    it("still parses a long decimal, which stays exactly representable", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithMantine(
        <ControlledSchemaForm schema={numberSchema} onChange={onChange} />,
      );
      const input = screen.getByLabelText(/Divisor/) as HTMLInputElement;
      // Guards the safe-integer check against over-rejecting: the fractional
      // digits are not what overflows, so this must not be dropped.
      await user.type(input, "3.14159265358979");
      expect(onChange).toHaveBeenLastCalledWith({ divisor: 3.14159265358979 });
    });

    it("drops in-progress text when resetKey moves the form to another entity", async () => {
      const user = userEvent.setup();
      // Both "tools" expose the same-named number field with no default, so the
      // value is `undefined` before and after the switch. The value comparison
      // sees no divergence, and only resetKey can tell the field to start over.
      const schema: InspectorFormSchema = {
        type: "object",
        properties: { divisor: { type: "number", title: "Divisor" } },
      };
      function Harness() {
        const [tool, setTool] = useState("tool-a");
        const [values, setValues] = useState<Record<string, unknown>>({});
        return (
          <>
            <button
              type="button"
              onClick={() => {
                setTool("tool-b");
                // What ToolsScreen does on select: replace the form values.
                setValues({});
              }}
            >
              Switch tool
            </button>
            <SchemaForm
              schema={schema}
              values={values}
              onChange={setValues}
              resetKey={tool}
            />
          </>
        );
      }
      renderWithMantine(<Harness />);
      const input = () => screen.getByLabelText(/Divisor/) as HTMLInputElement;
      await user.type(input(), "-");
      expect(input().value).toBe("-");
      // fireEvent, not user.click: a real click also blurs the input, and
      // Mantine sanitizes an incomplete value on blur — which would mask
      // whether the switch itself cleared the draft. This drives the state
      // change without the blur, isolating the reset to resetKey.
      fireEvent.click(screen.getByRole("button", { name: "Switch tool" }));
      expect(input().value).toBe("");
    });

    it("keeps in-progress text across re-renders of the same entity", async () => {
      const user = userEvent.setup();
      // The counterpart to the test above: a stable resetKey must NOT remount
      // the field, or every keystroke would wipe the draft and reinstate #1888.
      const schema: InspectorFormSchema = {
        type: "object",
        properties: { divisor: { type: "number", title: "Divisor" } },
      };
      function Harness() {
        const [values, setValues] = useState<Record<string, unknown>>({});
        return (
          <SchemaForm
            schema={schema}
            values={values}
            onChange={setValues}
            resetKey="tool-a"
          />
        );
      }
      renderWithMantine(<Harness />);
      const input = screen.getByLabelText(/Divisor/) as HTMLInputElement;
      await user.type(input, "1.5");
      expect(input.value).toBe("1.5");
    });

    it("re-syncs the displayed text when the value changes externally", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      function Harness() {
        const [values, setValues] = useState<Record<string, unknown>>({
          divisor: 1.5,
        });
        return (
          <>
            <button type="button" onClick={() => setValues({ divisor: 42 })}>
              Load example
            </button>
            <SchemaForm
              schema={numberSchema}
              values={values}
              onChange={(next) => {
                setValues(next);
                onChange(next);
              }}
            />
          </>
        );
      }
      renderWithMantine(<Harness />);
      const input = screen.getByLabelText(/Divisor/) as HTMLInputElement;
      expect(input.value).toBe("1.5");
      await user.click(screen.getByRole("button", { name: "Load example" }));
      expect(input.value).toBe("42");
    });
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
    expect(screen.getByRole("textbox", { name: /Street/ })).toBeInTheDocument();
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
    await user.type(screen.getByRole("textbox", { name: /Street/ }), "1");
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

  it("invokes onChange via the JSON editor when valid JSON is pasted", async () => {
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
    await setAceTextByLabel(/Config/, "[1,2]");
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.config).toEqual([1, 2]);
  });

  // The JSON field used to store unparseable text back as the *value*, which
  // the next render re-stringified — so each keystroke added a layer of
  // escaping (`[` → `"["` → `"\"[\""`). That compounding escape is #1928's
  // original symptom, and it lived here rather than in the dispatch. It matters
  // more since #2007, whose fix deliberately routes object unions to this
  // editor: a fallback nobody can type into is not a fallback.
  it("shows an error while the JSON draft does not parse", async () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        config: { type: "array", title: "Config" },
      },
    };
    function Harness() {
      const [values, setValues] = useState<Record<string, unknown>>({});
      return (
        <SchemaForm schema={schema} values={values} onChange={setValues} />
      );
    }
    renderWithMantine(<Harness />);

    await setAceTextByLabel(/Config/, "[1,");
    // Invalid text yields no value, so without this the field would submit as
    // absent while the user is still looking at what they typed.
    expect(screen.getByText(/Not valid JSON/)).toBeInTheDocument();

    await setAceTextByLabel(/Config/, "[1,2]");
    expect(screen.queryByText(/Not valid JSON/)).not.toBeInTheDocument();
  });

  // "Not valid JSON" would misdiagnose a document that parses perfectly well
  // and holds a number this client cannot put on the wire — leaving the user
  // reading about syntax while looking at syntactically fine JSON.
  it("says why the draft cannot be sent, not just that it cannot", async () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        config: { type: "array", title: "Config" },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={vi.fn()} />,
    );

    await setAceTextByLabel(/Config/, "[1,");
    expect(screen.getByText(/^Not valid JSON/)).toBeInTheDocument();

    await setAceTextByLabel(/Config/, "[1e400]");
    expect(screen.getByText(/^Numbers must be finite/)).toBeInTheDocument();

    await setAceTextByLabel(/Config/, "[9007199254740993]");
    expect(
      screen.getByText(/^`9007199254740993` would not arrive as written/),
    ).toBeInTheDocument();

    await setAceTextByLabel(/Config/, '[{"a":1,"a":2}]');
    expect(screen.getByText(/^`a` appears twice/)).toBeInTheDocument();

    await setAceTextByLabel(/Config/, "[1,2]");
    expect(screen.queryByText(/this field will be omitted/)).toBeNull();
  });

  // An untouched optional field is not a problem, but it is not a value either
  // — excluding it before the reason check rather than by it is what keeps
  // `JSON.parse("")` from throwing out of the change handler.
  it("reports no value and no error for an emptied JSON field", async () => {
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        config: { type: "array", title: "Config", default: [1] },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );

    await setAceTextByLabel(/Config/, "");
    expect(onChange).toHaveBeenLastCalledWith({ config: undefined });
    expect(screen.queryByText(/this field will be omitted/)).toBeNull();
  });

  it("shows no error for an empty optional field", () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        config: { type: "array", title: "Config" },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={vi.fn()} />,
    );
    expect(screen.queryByText(/Not valid JSON/)).not.toBeInTheDocument();
  });

  it("reports no value, not raw text, while the JSON is mid-edit", async () => {
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
    await setAceTextByLabel(/Config/, "x");
    expect(onChange).toHaveBeenLastCalledWith({ config: undefined });
  });

  // Ace is not typed into here — it reads keystrokes through an offscreen
  // textarea plus selection state happy-dom does not implement, so a simulated
  // keypress produces no edit at all (see `test/aceEditor.ts`). What this can
  // still pin is the mechanism that broke: each settled draft is displayed
  // verbatim rather than re-serialized. Real character-by-character typing is
  // covered by the `SchemaForm` play function, which runs in Chromium.
  it("shows each JSON draft verbatim as it is built up", async () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        config: { type: "array", title: "Config" },
      },
    };
    // Drive the real controlled loop: each onChange feeds straight back in as
    // `values`, which is what turned the old handler's raw-text write into a
    // compounding re-escape.
    function Harness() {
      const [values, setValues] = useState<Record<string, unknown>>({});
      return (
        <SchemaForm schema={schema} values={values} onChange={setValues} />
      );
    }
    renderWithMantine(<Harness />);

    for (const step of ["[", "[1", '[1,"', '[1,"a', '[1,"a"]']) {
      await setAceTextByLabel(/Config/, step);
      // The box shows exactly what was typed — no injected quotes, no
      // backslashes, at any point along the way.
      expect(getAceTextByLabel(/Config/)).toBe(step);
    }
  });

  it("keeps an in-progress draft visible instead of rewriting it", async () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        config: { type: "array", title: "Config" },
      },
    };
    function Harness() {
      const [values, setValues] = useState<Record<string, unknown>>({});
      return (
        <SchemaForm schema={schema} values={values} onChange={setValues} />
      );
    }
    renderWithMantine(<Harness />);

    await setAceTextByLabel(/Config/, "[1,");
    // Unparseable so far, and it must survive the re-render untouched.
    expect(getAceTextByLabel(/Config/)).toBe("[1,");

    await setAceTextByLabel(/Config/, "[1,2]");
    expect(getAceTextByLabel(/Config/)).toBe("[1,2]");
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
    expect(screen.getByRole("textbox", { name: /Name/ })).toBeDisabled();
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
    expect(
      screen.getByRole("textbox", { name: /rawField/ }),
    ).toBeInTheDocument();
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

// #1928: "optional AND explicitly nullable" (Zod's `.nullish()`) compiles to a
// nullable union rather than a plain type. Before the normalization step these
// matched no branch and fell through to the raw-JSON fallback, where every
// keystroke re-escaped the value.
describe("SchemaForm nullable unions", () => {
  it("renders a Select for an anyOf string-enum|null field", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        type: {
          title: "Type",
          anyOf: [
            { type: "string", enum: ["envio", "recebimento"] },
            { type: "null" },
          ],
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    await user.click(screen.getByRole("textbox", { name: "Type" }));
    await user.click(
      await screen.findByRole("option", { name: "envio", hidden: true }),
    );
    expect(onChange).toHaveBeenCalledWith({ type: "envio" });
  });

  it("clears a nullable enum back to null", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        type: {
          title: "Type",
          anyOf: [{ type: "string", enum: ["envio"] }, { type: "null" }],
        },
      },
    };
    renderWithMantine(
      <SchemaForm
        schema={schema}
        values={{ type: "envio" }}
        onChange={onChange}
      />,
    );
    // Mantine marks its combobox clear button `aria-hidden` (it is mouse-only,
    // `tabIndex={-1}`), so it is only reachable with `hidden: true`.
    await user.click(screen.getByRole("button", { hidden: true }));
    expect(onChange).toHaveBeenCalledWith({ type: null });
  });

  it("offers no clear affordance on a non-nullable enum", () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        format: { type: "string", title: "Format", enum: ["json"] },
      },
    };
    renderWithMantine(
      <SchemaForm
        schema={schema}
        values={{ format: "json" }}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { hidden: true }),
    ).not.toBeInTheDocument();
  });

  // The other supported nullable encoding: keywords stay at the top level, so
  // the null sentinel sits inside the enum list rather than on a branch.
  it("renders a Select for a type: [string, null] enum, without a null option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // Built through `toFormSchema`, the same narrowing boundary every
    // production call site uses, rather than cast into `InspectorFormSchema`.
    // A `null` member is valid JSON Schema but outside that type's `string[]`
    // `enum`, and this fixture *is* wire data — so the honest way to introduce
    // it is the wire→form narrow, not a double cast that erases the mismatch.
    const schema = toFormSchema({
      type: "object",
      properties: {
        direction: {
          title: "Direction",
          type: ["string", "null"],
          enum: ["envio", "recebimento", null],
        },
      },
    });
    renderWithMantine(
      <SchemaForm schema={schema!} values={{}} onChange={onChange} />,
    );
    await user.click(screen.getByRole("textbox", { name: "Direction" }));
    const options = await screen.findAllByRole("option", { hidden: true });
    expect(options.map((option) => option.textContent)).toEqual([
      "envio",
      "recebimento",
    ]);
    await user.click(options[0]);
    expect(onChange).toHaveBeenCalledWith({ direction: "envio" });
  });

  it("renders a TextInput for a type: [string, null] field", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        note: { type: ["string", "null"], title: "Note" },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    await user.type(screen.getByRole("textbox", { name: /Note/ }), "a");
    expect(onChange).toHaveBeenCalledWith({ note: "a" });
  });

  it("renders a checkbox for an anyOf boolean|null field", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        enabled: {
          title: "Enabled",
          anyOf: [{ type: "boolean" }, { type: "null" }],
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    await user.click(screen.getByLabelText("Enabled"));
    expect(onChange).toHaveBeenCalledWith({ enabled: true });
  });

  it("renders a MultiSelect for an anyOf array-of-enum|null field", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        tags: {
          title: "Tags",
          anyOf: [
            { type: "array", items: { type: "string", enum: ["a", "b"] } },
            { type: "null" },
          ],
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    await user.click(screen.getByRole("textbox", { name: "Tags" }));
    await user.click(
      await screen.findByRole("option", { name: "a", hidden: true }),
    );
    expect(onChange).toHaveBeenCalledWith({ tags: ["a"] });
  });

  it("renders nested fields for an anyOf object|null field", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        profile: {
          title: "Profile",
          anyOf: [
            {
              type: "object",
              properties: { nick: { type: "string", title: "Nick" } },
            },
            { type: "null" },
          ],
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    await user.type(screen.getByRole("textbox", { name: /Nick/ }), "z");
    expect(onChange).toHaveBeenCalledWith({ profile: { nick: "z" } });
  });

  // #2007: `z.array(z.union([z.object(…), z.object(…)]))` gives an `items.anyOf`
  // whose branches carry no top-level `const`, so every MultiSelect option was
  // the empty string — and Mantine *throws* on duplicate option values, greying
  // out the whole tool panel. The nullable form below is reachable only because
  // this PR now collapses it into `type: "array"`, so it has to be safe too.
  it("falls back to the JSON input for an array of object-union items", () => {
    const objectBranch = (name: string): InspectorFormSchema => ({
      type: "object",
      properties: { type: { type: "string", const: name } },
      required: ["type"],
    });
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        items: {
          title: "Items",
          type: "array",
          items: { anyOf: [objectBranch("A"), objectBranch("B")] },
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText(/Items/).tagName).toBe("TEXTAREA");
  });

  it("falls back to the JSON input for a nullable array of object-union items", () => {
    const objectBranch = (name: string): InspectorFormSchema => ({
      type: "object",
      properties: { type: { type: "string", const: name } },
      required: ["type"],
    });
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        items: {
          title: "Items",
          anyOf: [
            { type: "array", items: { anyOf: [objectBranch("A")] } },
            { type: "null" },
          ],
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText(/Items/).tagName).toBe("TEXTAREA");
  });

  // Mantine's select is string-valued, so a numeric const would submit "1" for
  // 1 — the same wrong-type-on-the-wire problem that keeps a numeric enum off
  // the select path.
  it("falls back to the JSON input for non-string anyOf consts", () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        items: {
          title: "Items",
          type: "array",
          items: { anyOf: [{ const: 1 }, { const: 2 }] },
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText(/Items/).tagName).toBe("TEXTAREA");
  });

  it("falls back to the JSON input when two anyOf branches share a const", () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        items: {
          title: "Items",
          type: "array",
          items: { anyOf: [{ const: "dup" }, { const: "dup" }] },
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText(/Items/).tagName).toBe("TEXTAREA");
  });

  it("falls back to a text input for a string oneOf with no consts", () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        mode: {
          title: "Mode",
          type: "string",
          oneOf: [{ type: "string" }, { type: "string" }],
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("textbox", { name: /Mode/ }).tagName).toBe("INPUT");
  });

  it("still renders a MultiSelect when every anyOf branch has a distinct const", () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        items: {
          title: "Items",
          type: "array",
          items: { anyOf: [{ const: "a", title: "Alpha" }, { const: "b" }] },
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("textbox", { name: "Items" })).toBeInTheDocument();
  });

  // Reachable only since the collapse landed: the nullable wrapper had no
  // top-level `type` before, so it fell to the JSON editor rather than into a
  // string-valued MultiSelect that would submit ["1"] for [1].
  it("falls back to the JSON input for a nullable array of numeric item enums", () => {
    // Wire data again — a numeric `enum` is valid JSON Schema but outside
    // `InspectorFormSchema`'s `string[]`, so it comes in through the narrow.
    const schema = toFormSchema({
      type: "object",
      properties: {
        levels: {
          title: "Levels",
          anyOf: [{ type: "array", items: { enum: [1, 2] } }, { type: "null" }],
        },
      },
    });
    renderWithMantine(
      <SchemaForm schema={schema!} values={{}} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText(/Levels/).tagName).toBe("TEXTAREA");
  });

  // The sibling enum rules null out even though the type list names it, so the
  // field must not get a clear button that emits a value the schema rejects.
  it("offers no clear button when a sibling enum excludes null", () => {
    const schema = toFormSchema({
      type: "object",
      properties: {
        direction: {
          title: "Direction",
          type: ["string", "null"],
          enum: ["envio", "recebimento"],
        },
      },
    });
    renderWithMantine(
      <SchemaForm
        schema={schema!}
        values={{ direction: "envio" }}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { hidden: true }),
    ).not.toBeInTheDocument();
  });

  it("still falls back to the JSON input for a union of two real types", () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        mixed: {
          title: "Mixed",
          anyOf: [{ type: "string" }, { type: "number" }],
        },
      },
    };
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText(/Mixed/).tagName).toBe("TEXTAREA");
  });
});

// #2020: a field holding text it cannot turn into a value reports `undefined`,
// which is exactly what an *empty* field reports. That makes the two states
// indistinguishable to the caller, so invalid text in an optional field was
// submittable and simply arrived at the server absent. The form reports draft
// validity directly so a submit gate can see what `values` cannot.
describe("SchemaForm draft validity (#2020)", () => {
  const jsonSchema: InspectorFormSchema = {
    type: "object",
    properties: {
      config: { type: "array", title: "Config" },
    },
  };

  function ValidityHarness({
    schema,
    onValidityChange,
    resetKey,
  }: {
    schema: InspectorFormSchema;
    onValidityChange: (hasInvalidDraft: boolean) => void;
    resetKey?: string;
  }) {
    const [values, setValues] = useState<Record<string, unknown>>({});
    return (
      <SchemaForm
        schema={schema}
        values={values}
        onChange={setValues}
        resetKey={resetKey}
        onValidityChange={onValidityChange}
      />
    );
  }

  it("reports an empty optional field as valid", () => {
    const onValidityChange = vi.fn();
    renderWithMantine(
      <ValidityHarness
        schema={jsonSchema}
        onValidityChange={onValidityChange}
      />,
    );
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });

  it("reports an unparseable JSON draft, then clears it once the text parses", async () => {
    const onValidityChange = vi.fn();
    renderWithMantine(
      <ValidityHarness
        schema={jsonSchema}
        onValidityChange={onValidityChange}
      />,
    );

    await setAceTextByLabel(/Config/, "[1,");
    expect(onValidityChange).toHaveBeenLastCalledWith(true);

    await setAceTextByLabel(/Config/, "[1,2]");
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });

  it("reports a number this client cannot send exactly, and says so on the field", async () => {
    const user = userEvent.setup();
    const onValidityChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        divisor: { type: "number", title: "Divisor" },
      },
    };
    renderWithMantine(
      <ValidityHarness schema={schema} onValidityChange={onValidityChange} />,
    );

    // Past MAX_SAFE_INTEGER the field reports no value rather than a rounded
    // one, so — like the JSON editor — the text on screen would otherwise be
    // submitted as an absent argument.
    const input = screen.getByLabelText(/Divisor/) as HTMLInputElement;
    await user.type(input, "90071992547409910");
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/this field will be omitted/)).toBeInTheDocument();

    await user.clear(input);
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    expect(
      screen.queryByText(/this field will be omitted/),
    ).not.toBeInTheDocument();
  });

  it("stays invalid while any one field is invalid", async () => {
    const onValidityChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        first: { type: "array", title: "First" },
        second: { type: "array", title: "Second" },
      },
    };
    renderWithMantine(
      <ValidityHarness schema={schema} onValidityChange={onValidityChange} />,
    );

    await setAceTextByLabel(/First/, "x");
    await setAceTextByLabel(/Second/, "y");
    expect(onValidityChange).toHaveBeenLastCalledWith(true);

    // One of the two recovering is not enough.
    await setAceTextByLabel(/First/, "");
    expect(onValidityChange).toHaveBeenLastCalledWith(true);

    await setAceTextByLabel(/Second/, "");
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });

  it("surfaces a nested object's invalid draft through the outer form", async () => {
    const onValidityChange = vi.fn();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        outer: {
          type: "object",
          title: "Outer",
          properties: {
            config: { type: "array", title: "Config" },
          },
        },
      },
    };
    renderWithMantine(
      <ValidityHarness schema={schema} onValidityChange={onValidityChange} />,
    );

    await setAceTextByLabel(/Config/, "x");
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
  });

  it("clears a stale invalid draft when the form moves to another entity", async () => {
    const onValidityChange = vi.fn();
    const { rerender } = renderWithMantine(
      <ValidityHarness
        schema={jsonSchema}
        onValidityChange={onValidityChange}
        resetKey="first_tool"
      />,
    );

    await setAceTextByLabel(/Config/, "x");
    expect(onValidityChange).toHaveBeenLastCalledWith(true);

    // Switching entities remounts the field, discarding its draft — so text
    // typed for the previous one must not keep the new one blocked.
    rerender(
      <ValidityHarness
        schema={jsonSchema}
        onValidityChange={onValidityChange}
        resetKey="second_tool"
      />,
    );
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });

  it("reports valid when the form unmounts holding an invalid draft", async () => {
    const onValidityChange = vi.fn();
    const { unmount } = renderWithMantine(
      <ValidityHarness
        schema={jsonSchema}
        onValidityChange={onValidityChange}
      />,
    );

    await setAceTextByLabel(/Config/, "x");
    expect(onValidityChange).toHaveBeenLastCalledWith(true);

    unmount();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });

  it("renders without a validity callback", async () => {
    renderWithMantine(
      <SchemaForm schema={jsonSchema} values={{}} onChange={vi.fn()} />,
    );
    await setAceTextByLabel(/Config/, "x");
    expect(screen.getByText(/Not valid JSON/)).toBeInTheDocument();
  });
});

// Three separate reports of one defect: the JSON editor re-escaping the text
// being typed. #1853 saw it while typing an array, #1856 on the Backspace that
// first makes a valid array invalid, and #1885 on a nullable parameter whose
// default `null` had to be edited in place. All three come from the same
// mechanism — unparseable draft text stored back as the field's *value*, which
// the next controlled render re-`JSON.stringify`d, adding a layer of quotes and
// backslashes per keystroke.
//
// The mechanism was removed by the draft/value split in `SchemaJsonField`
// (#1928/#2007) and the nullable-union collapse that keeps a `T | null` field
// off this editor entirely (#1928). These lock each report's own reproduction
// to it, since the fixes were made for differently-framed issues and nothing
// otherwise pins the reported flows.
describe("JSON editor escaping (#1853, #1856, #1885)", () => {
  function EscapingHarness({
    schema,
    initial = {},
  }: {
    schema: InspectorFormSchema;
    initial?: Record<string, unknown>;
  }) {
    const [values, setValues] = useState<Record<string, unknown>>(initial);
    return <SchemaForm schema={schema} values={values} onChange={setValues} />;
  }

  // #1853: `batch_process_items`, typed character by character.
  it("types a string array through without escaping it (#1853)", async () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        itemIds: {
          type: "array",
          title: "Item Ids",
          items: { type: "string" },
        },
      },
      required: ["itemIds"],
    };
    renderWithMantine(<EscapingHarness schema={schema} />);

    await setAceTextByLabel(/Item Ids/, '["item-1","item-2"]');

    expect(getAceTextByLabel(/Item Ids/)).toBe('["item-1","item-2"]');
    expect(getAceTextByLabel(/Item Ids/)).not.toContain("\\");
  });

  // #1853 again, from the comment thread: the caret sitting *outside* the
  // quotes of a `""` value. One keystroke there made the draft invalid, which
  // is all it took — `""` + `a` rendered as `"\"\"a"`.
  it("keeps a keystroke typed outside a string's quotes literal (#1853)", async () => {
    const schema: InspectorFormSchema = {
      type: "object",
      // No `type`, so the field lands on the JSON editor holding a string.
      properties: { note: { title: "Note" } },
    };
    renderWithMantine(
      <EscapingHarness schema={schema} initial={{ note: "" }} />,
    );

    expect(getAceTextByLabel(/Note/)).toBe('""');
    await setAceTextByLabel(/Note/, '""a');

    expect(getAceTextByLabel(/Note/)).toBe('""a');
  });

  // #1856: `sum_numbers`, Backspace with the caret after the closing `]`.
  it("keeps the draft raw when Backspace invalidates an array (#1856)", async () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        numbers: {
          type: "array",
          title: "Numbers",
          items: { type: "number" },
        },
      },
      required: ["numbers"],
    };
    renderWithMantine(
      <EscapingHarness schema={schema} initial={{ numbers: [1, 2] }} />,
    );

    expect(getAceTextByLabel(/Numbers/)).toBe("[\n  1,\n  2\n]");

    // Exactly the seeded text minus its last character — the draft the reporter
    // expected, where the field instead showed a quoted, escaped string.
    await setAceTextByLabel(/Numbers/, "[\n  1,\n  2\n");
    expect(getAceTextByLabel(/Numbers/)).toBe("[\n  1,\n  2\n");

    // Each further edit compounded the escaping, so keep going.
    await setAceTextByLabel(/Numbers/, "[\n  1,\n  ");
    expect(getAceTextByLabel(/Numbers/)).not.toContain("\\");
    expect(getAceTextByLabel(/Numbers/).startsWith('"')).toBe(false);

    // And the draft is still live: closing it back up produces a real array.
    await setAceTextByLabel(/Numbers/, "[\n  1,\n  2]");
    expect(getAceTextByLabel(/Numbers/)).toBe("[\n  1,\n  2]");
  });

  // #1885: FastMCP's `b: int | None = None`, which compiles to an `anyOf` with
  // a null branch and `default: null`. The reporter was editing the literal
  // `null` token in a raw JSON box; collapsing the union routes the field to a
  // real number input, so there is no JSON token to edit in the first place.
  it("edits a nullable integer as a number input, not a null token (#1885)", async () => {
    const user = userEvent.setup();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        a: { type: "integer", title: "A" },
        b: {
          title: "B",
          anyOf: [{ type: "integer" }, { type: "null" }],
          default: null,
        },
      },
      required: ["a"],
    };
    // No seeded value: the `null` has to come from the schema's `default`,
    // which is where the reporter's did.
    renderWithMantine(<EscapingHarness schema={schema} />);

    const b = screen.getByLabelText(/^B$/) as HTMLInputElement;
    expect(b.tagName).toBe("INPUT");
    // `null` is rendered as "no value", not as four editable characters.
    expect(b.value).toBe("");

    await user.click(b);
    await user.keyboard("42{Backspace}");
    expect(b.value).toBe("4");
    expect(b.value).not.toContain("\\");
  });

  // The same nullable-with-`default: null` shape on a field the collapse still
  // sends to the JSON editor (an array union). Backspacing the `null` token
  // there is the exact keystroke sequence from #1885's recording.
  it("backspaces a null default in the JSON editor without escaping (#1885)", async () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        cfg: {
          title: "Cfg",
          anyOf: [{ type: "array" }, { type: "null" }],
          default: null,
        },
      },
    };
    // Again unseeded, so the editor's opening `null` is the schema default
    // being resolved — the state the reporter's recording starts from.
    renderWithMantine(<EscapingHarness schema={schema} />);

    expect(getAceTextByLabel(/Cfg/)).toBe("null");

    await setAceTextByLabel(/Cfg/, "nul");
    expect(getAceTextByLabel(/Cfg/)).toBe("nul");

    await setAceTextByLabel(/Cfg/, "");
    expect(getAceTextByLabel(/Cfg/)).toBe("");
    expect(getAceTextByLabel(/Cfg/)).not.toContain("\\");
  });
});

// A schema `default` is what a field *opens* with, not a value re-imposed on
// every unsendable draft. Unsendable text reports `undefined` by design, and
// `resolveValue` used to turn that straight back into the default — a change
// from the previous value, so the draft/value re-sync rewrote the box and
// reverted the keystroke.
//
// The two halves differed in how reachable they were, which the tests below
// mirror deliberately:
//
// - **The number field reverted in the app.** Numbers compare by value, so
//   clearing a defaulted box (value `3` → resolved default `30`) always fired
//   the re-sync and refilled itself.
// - **The JSON field was latent.** `collectSchemaDefaults` assigns
//   `fieldSchema.default` itself, so a field seeded from the schema holds the
//   *same reference* the substitution returns and nothing fires. It needs a
//   structurally-equal but distinct value object to become observable — which
//   is what parsed wire/deep-link values and rebuilt nested-object defaults
//   produce, and what these tests construct.
describe("SchemaForm defaulted fields (#2026)", () => {
  function DefaultHarness({
    schema,
    initial = {},
  }: {
    schema: InspectorFormSchema;
    initial?: Record<string, unknown>;
  }) {
    const [values, setValues] = useState<Record<string, unknown>>(initial);
    return <SchemaForm schema={schema} values={values} onChange={setValues} />;
  }

  const arrayWithDefault: InspectorFormSchema = {
    type: "object",
    properties: { tags: { type: "array", title: "Tags", default: ["a"] } },
  };

  it("opens the JSON editor on the schema default", () => {
    renderWithMantine(<DefaultHarness schema={arrayWithDefault} />);
    expect(getAceTextByLabel(/Tags/)).toBe('[\n  "a"\n]');
  });

  it("keeps a keystroke typed into a defaulted JSON field", async () => {
    // Seeded with a value that is equal to the schema default but is not the
    // same object — how values parsed off the wire or out of a deep link
    // arrive. Sharing the reference (what `collectSchemaDefaults` produces) is
    // what keeps this latent rather than what makes it safe.
    renderWithMantine(
      <DefaultHarness schema={arrayWithDefault} initial={{ tags: ["a"] }} />,
    );

    await setAceTextByLabel(/Tags/, '[\n  "a"\n]x');

    // The invalid draft is the user's, not the default reasserting itself.
    expect(getAceTextByLabel(/Tags/)).toBe('[\n  "a"\n]x');
  });

  it("lets a defaulted JSON field be edited to a new value", async () => {
    // Distinct-object seed again, for the reason above.
    renderWithMantine(
      <DefaultHarness schema={arrayWithDefault} initial={{ tags: ["a"] }} />,
    );

    await setAceTextByLabel(/Tags/, '["b"]');

    expect(getAceTextByLabel(/Tags/)).toBe('["b"]');
    expect(screen.queryByText(/Not valid JSON/)).not.toBeInTheDocument();
  });

  it("lets a defaulted number field be emptied", async () => {
    const user = userEvent.setup();
    const schema: InspectorFormSchema = {
      type: "object",
      properties: { n: { type: "integer", title: "N", default: 30 } },
    };
    renderWithMantine(<DefaultHarness schema={schema} initial={{ n: 30 }} />);

    // Anchored: the form now also renders an "Edit as JSON" switch, which a
    // bare /N/ matches too.
    const n = screen.getByLabelText(/^N$/) as HTMLInputElement;
    expect(n.value).toBe("30");

    await user.click(n);
    await user.keyboard("{End}{Backspace}{Backspace}");

    // The box stays empty instead of refilling itself with the default.
    expect(n.value).toBe("");
  });

  // An explicit `null` is a value, not an absent one, so a non-null default
  // must not be substituted for it. Note the field itself never emits `null` —
  // clearing it reports `undefined` (pinned by "passes undefined to onChange
  // when a number field is cleared") — so this arrives from parent state: a
  // value received from the server, restored from a deep link, or written by a
  // caller for a nullable schema.
  it("shows an explicit null as empty, not as the default", () => {
    const schema: InspectorFormSchema = {
      type: "object",
      properties: {
        n: {
          title: "N",
          anyOf: [{ type: "integer" }, { type: "null" }],
          default: 30,
        },
      },
    };
    renderWithMantine(<DefaultHarness schema={schema} initial={{ n: null }} />);

    expect((screen.getByLabelText(/^N$/) as HTMLInputElement).value).toBe("");
  });

  it("still re-syncs a defaulted field when the value changes externally", async () => {
    function ExternalHarness() {
      const [values, setValues] = useState<Record<string, unknown>>({
        tags: ["a"],
      });
      return (
        <>
          <SchemaForm
            schema={arrayWithDefault}
            values={values}
            onChange={setValues}
          />
          <button type="button" onClick={() => setValues({ tags: ["z"] })}>
            load example
          </button>
        </>
      );
    }
    const user = userEvent.setup();
    renderWithMantine(<ExternalHarness />);

    await user.click(screen.getByRole("button", { name: "load example" }));
    expect(getAceTextByLabel(/Tags/)).toBe('[\n  "z"\n]');
  });
});

// The v1 escape hatch, restored (#2151): a rendered form can be flipped over to
// editing its whole arguments object as JSON, so a value the widgets cannot
// express — or a payload the user wants to paste in whole — has a route in.
describe("SchemaForm raw JSON (#2151)", () => {
  const schema: InspectorFormSchema = {
    type: "object",
    properties: {
      name: { type: "string", title: "Name" },
      count: { type: "integer", title: "Count" },
    },
  };

  function RawHarness({
    initial = {},
    onValidityChange,
    enforceToolArgumentTypes,
    resetKey,
    schema: override,
  }: {
    initial?: Record<string, unknown>;
    onValidityChange?: (hasInvalidDraft: boolean) => void;
    enforceToolArgumentTypes?: boolean;
    resetKey?: string;
    schema?: InspectorFormSchema;
  }) {
    const [values, setValues] = useState<Record<string, unknown>>(initial);
    return (
      <SchemaForm
        schema={override ?? schema}
        values={values}
        onChange={setValues}
        resetKey={resetKey}
        onValidityChange={onValidityChange}
        enforceToolArgumentTypes={enforceToolArgumentTypes}
      />
    );
  }

  async function enableRawJson(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByLabelText("Edit as JSON"));
  }

  // #2171. The widgets hand every value over as text, so `callTool` retypes a
  // string to whatever the schema declares — which for a JSON draft means the
  // wire would carry something other than what the editor showed. The draft is
  // refused instead, and the value to rewrite is named.
  describe("tool-argument type enforcement", () => {
    it("refuses a draft the client would retype, and says which value", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithMantine(
        <SchemaForm
          schema={schema}
          values={{}}
          onChange={onChange}
          enforceToolArgumentTypes
        />,
      );
      await enableRawJson(user);
      await setAceTextByLabel(/Arguments JSON/, '{"count":"01"}');

      expect(
        screen.getByText(/`count` would be converted to the type/),
      ).toBeInTheDocument();
      // Not merely flagged: the value must not reach the parent either, or a
      // submit gated on something else would still send it.
      expect(onChange).not.toHaveBeenCalledWith({ count: "01" });
    });

    it("blocks submission while such a draft is held", async () => {
      const user = userEvent.setup();
      const onValidityChange = vi.fn();
      renderWithMantine(
        <RawHarness
          onValidityChange={onValidityChange}
          enforceToolArgumentTypes
        />,
      );
      await enableRawJson(user);
      await setAceTextByLabel(/Arguments JSON/, '{"count":"01"}');
      expect(onValidityChange).toHaveBeenLastCalledWith(true);

      // Rewritten with the declared type, it is sendable again.
      await setAceTextByLabel(/Arguments JSON/, '{"count":1}');
      expect(onValidityChange).toHaveBeenLastCalledWith(false);
    });

    // The conversion only ever looks at strings, so a value already written
    // with its declared type is not a mismatch — and neither is a string in a
    // field the schema declares as one.
    it("accepts values already written with the declared type", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithMantine(
        <SchemaForm
          schema={schema}
          values={{}}
          onChange={onChange}
          enforceToolArgumentTypes
        />,
      );
      await enableRawJson(user);
      await setAceTextByLabel(/Arguments JSON/, '{"name":"a","count":2}');
      expect(screen.queryByText(/would be converted/)).toBeNull();
      expect(onChange).toHaveBeenLastCalledWith({ name: "a", count: 2 });
    });

    // Off by default, and that default is load-bearing: an elicitation renders
    // through this same form and its values are never converted, so enforcing
    // there would refuse a draft for a reason that is not true of it.
    it("does not enforce when the caller has not opted in", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithMantine(
        <SchemaForm schema={schema} values={{}} onChange={onChange} />,
      );
      await enableRawJson(user);
      await setAceTextByLabel(/Arguments JSON/, '{"count":"01"}');
      expect(screen.queryByText(/would be converted/)).toBeNull();
      expect(onChange).toHaveBeenLastCalledWith({ count: "01" });
    });
  });

  it("replaces the widgets with one editor holding the current values", async () => {
    const user = userEvent.setup();
    renderWithMantine(<RawHarness initial={{ name: "a", count: 2 }} />);
    expect(screen.getByLabelText(/^Name$/)).toBeInTheDocument();

    await enableRawJson(user);

    expect(screen.queryByLabelText(/^Name$/)).toBeNull();
    expect(getAceTextByLabel(/Arguments JSON/)).toBe(
      '{\n  "name": "a",\n  "count": 2\n}',
    );
  });

  it("emits the edited object, and the widgets show it on the way back", async () => {
    const user = userEvent.setup();
    renderWithMantine(<RawHarness initial={{ name: "a", count: 2 }} />);
    await enableRawJson(user);

    await setAceTextByLabel(/Arguments JSON/, '{"name":"b","count":9}');
    await user.click(screen.getByLabelText("Edit as JSON"));

    expect((screen.getByLabelText(/^Name$/) as HTMLInputElement).value).toBe(
      "b",
    );
    expect((screen.getByLabelText(/^Count$/) as HTMLInputElement).value).toBe(
      "9",
    );
  });

  // A field the schema does not declare has no widget, which is the case the
  // escape hatch exists for — so it must survive the round trip.
  it("carries a value no widget can express", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithMantine(
      <SchemaForm schema={schema} values={{}} onChange={onChange} />,
    );
    await enableRawJson(user);
    await setAceTextByLabel(/Arguments JSON/, '{"extra":{"deep":[1,2]}}');
    expect(onChange).toHaveBeenLastCalledWith({ extra: { deep: [1, 2] } });
  });

  it("blocks submission while the draft does not parse, and clears it after", async () => {
    const user = userEvent.setup();
    const onValidityChange = vi.fn();
    renderWithMantine(<RawHarness onValidityChange={onValidityChange} />);
    await enableRawJson(user);

    await setAceTextByLabel(/Arguments JSON/, '{"a":');
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/Not valid JSON/)).toBeInTheDocument();

    await setAceTextByLabel(/Arguments JSON/, '{"a":1}');
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });

  it("blocks submission for JSON that is not an object", async () => {
    const user = userEvent.setup();
    const onValidityChange = vi.fn();
    renderWithMantine(<RawHarness onValidityChange={onValidityChange} />);
    await enableRawJson(user);

    await setAceTextByLabel(/Arguments JSON/, "[1,2]");
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/must be a JSON object/i)).toBeInTheDocument();
  });

  // Turning the switch back off unmounts the editor, so text that can no longer
  // be seen must not keep the submit button disabled.
  it("clears the block when switched back to the widgets", async () => {
    const user = userEvent.setup();
    const onValidityChange = vi.fn();
    renderWithMantine(<RawHarness onValidityChange={onValidityChange} />);
    await enableRawJson(user);
    await setAceTextByLabel(/Arguments JSON/, '{"a":');
    expect(onValidityChange).toHaveBeenLastCalledWith(true);

    await user.click(screen.getByLabelText("Edit as JSON"));
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });

  it("clears an empty editor to no arguments rather than erroring", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithMantine(
      <SchemaForm schema={schema} values={{ name: "a" }} onChange={onChange} />,
    );
    await enableRawJson(user);
    await setAceTextByLabel(/Arguments JSON/, "");
    expect(onChange).toHaveBeenLastCalledWith({});
    expect(screen.queryByText(/Not valid JSON/)).toBeNull();
  });

  // `JSON.parse("1e400")` yields `Infinity`, which `JSON.stringify` writes back
  // as `null`. Submitting it would send a number the user never typed while the
  // editor still showed what they wrote.
  it("blocks submission for a number that cannot survive being sent", async () => {
    const user = userEvent.setup();
    const onValidityChange = vi.fn();
    renderWithMantine(<RawHarness onValidityChange={onValidityChange} />);
    await enableRawJson(user);

    await setAceTextByLabel(/Arguments JSON/, '{"count":1e400}');
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/Numbers must be finite/)).toBeInTheDocument();
  });

  // The quieter half of the same defect the `1e400` case covers: a whole number
  // past 2^53−1 is rounded by `JSON.parse`, so the editor would show digits the
  // wire will not carry.
  it("blocks submission for a whole number that loses digits when parsed", async () => {
    const user = userEvent.setup();
    const onValidityChange = vi.fn();
    renderWithMantine(<RawHarness onValidityChange={onValidityChange} />);
    await enableRawJson(user);

    await setAceTextByLabel(/Arguments JSON/, '{"id":9007199254740993}');
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/would not arrive as written/)).toBeInTheDocument();
  });

  // `JSON.parse` keeps only the last occurrence, so the editor would show a
  // document that submits as less than it says.
  it("blocks submission for a document that names the same member twice", async () => {
    const user = userEvent.setup();
    const onValidityChange = vi.fn();
    renderWithMantine(<RawHarness onValidityChange={onValidityChange} />);
    await enableRawJson(user);

    await setAceTextByLabel(
      /Arguments JSON/,
      '{"mode":"safe","mode":"unsafe"}',
    );
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/`mode` appears twice/)).toBeInTheDocument();
  });

  // Nothing in `values` names a branch, so the picker's index is held by the
  // form. Editing the discriminator in the raw document is a change to which
  // branch is in effect, and it carries no other signal — without the re-derive
  // the picker keeps showing the outgoing branch over the incoming values.
  it("moves the branch picker when the raw document changes the discriminator", async () => {
    const user = userEvent.setup();
    const union: InspectorFormSchema = {
      type: "object",
      anyOf: [
        {
          type: "object",
          title: "Email",
          properties: {
            kind: { type: "string", const: "email" },
            address: { type: "string", title: "Address" },
          },
          required: ["kind"],
        },
        {
          type: "object",
          title: "SMS",
          properties: {
            kind: { type: "string", const: "sms" },
            phone: { type: "string", title: "Phone" },
          },
          required: ["kind"],
        },
      ],
    };
    renderWithMantine(
      <RawHarness schema={union} initial={{ kind: "email" }} />,
    );
    expect(
      (screen.getByRole("textbox", { name: /Variant/ }) as HTMLInputElement)
        .value,
    ).toBe("Email");

    await enableRawJson(user);
    await setAceTextByLabel(
      /Arguments JSON/,
      '{"kind":"sms","phone":"555-0100"}',
    );

    expect(
      (screen.getByRole("textbox", { name: /Variant/ }) as HTMLInputElement)
        .value,
    ).toBe("SMS");

    // And the widgets agree with it on the way back.
    await user.click(screen.getByLabelText("Edit as JSON"));
    // Anchored: the branch picker's own options carry these words too.
    expect(screen.getByLabelText(/^Phone$/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Address$/)).toBeNull();
  });

  // The editor holds the whole arguments object, not a per-branch slice, so a
  // branch move must not remount it — that would reformat the text being typed
  // and drop the caret to the top. Pinned by the text surviving verbatim: a
  // remount reseeds from `values`, which is pretty-printed.
  it("does not reformat the draft when the branch moves under it", async () => {
    const user = userEvent.setup();
    const union: InspectorFormSchema = {
      type: "object",
      anyOf: [
        {
          type: "object",
          title: "Email",
          properties: { kind: { type: "string", const: "email" } },
          required: ["kind"],
        },
        {
          type: "object",
          title: "SMS",
          properties: { kind: { type: "string", const: "sms" } },
          required: ["kind"],
        },
      ],
    };
    renderWithMantine(
      <RawHarness schema={union} initial={{ kind: "email" }} />,
    );
    await enableRawJson(user);

    await setAceTextByLabel(/Arguments JSON/, '{"kind":"sms"}');
    expect(getAceTextByLabel(/Arguments JSON/)).toBe('{"kind":"sms"}');
  });

  // The discriminator is cleared and retyped on the way between branches, so
  // snapping to the first branch the moment it stops matching would move the
  // picker under the user mid-edit.
  it("keeps the current branch while the discriminator is absent", async () => {
    const user = userEvent.setup();
    const union: InspectorFormSchema = {
      type: "object",
      anyOf: [
        {
          type: "object",
          title: "Email",
          properties: { kind: { type: "string", const: "email" } },
          required: ["kind"],
        },
        {
          type: "object",
          title: "SMS",
          properties: { kind: { type: "string", const: "sms" } },
          required: ["kind"],
        },
      ],
    };
    renderWithMantine(<RawHarness schema={union} initial={{ kind: "sms" }} />);
    await enableRawJson(user);
    expect(
      (screen.getByRole("textbox", { name: /Variant/ }) as HTMLInputElement)
        .value,
    ).toBe("SMS");

    await setAceTextByLabel(/Arguments JSON/, '{"note":"mid-edit"}');
    expect(
      (screen.getByRole("textbox", { name: /Variant/ }) as HTMLInputElement)
        .value,
    ).toBe("SMS");
  });

  // #2123: switching a root union drops the outgoing branch's values. The raw
  // editor is seeded from what the form holds, so a round trip through it must
  // not resurrect them.
  it("does not resurrect a pruned branch's values", async () => {
    const user = userEvent.setup();
    const union: InspectorFormSchema = {
      type: "object",
      anyOf: [
        {
          type: "object",
          title: "Email",
          properties: { address: { type: "string", title: "Address" } },
        },
        {
          type: "object",
          title: "SMS",
          properties: { phone: { type: "string", title: "Phone" } },
        },
      ],
    };
    renderWithMantine(
      <RawHarness schema={union} initial={{ address: "a@b.c" }} />,
    );

    // Switch branches — `address` belongs to the outgoing shape and is dropped.
    await user.click(screen.getByRole("textbox", { name: /Variant/ }));
    await user.click(screen.getByRole("option", { name: "SMS" }));

    await enableRawJson(user);
    expect(getAceTextByLabel(/Arguments JSON/)).not.toContain("address");
  });

  // A draft is typed for one entity. Left in the box, it would be submitted for
  // the next — the same reasoning `resetKey` documents for every other
  // draft-holding field.
  it("discards the draft when the form moves to another entity", async () => {
    const user = userEvent.setup();
    // Uncontrolled on purpose: the values must stay put so the only thing that
    // could carry the text across is the editor's own draft.
    const { rerender } = renderWithMantine(
      <SchemaForm
        schema={schema}
        values={{}}
        onChange={vi.fn()}
        resetKey="first_tool"
      />,
    );
    await enableRawJson(user);
    await setAceTextByLabel(/Arguments JSON/, '{"name":"typed for the first"}');

    rerender(
      <SchemaForm
        schema={schema}
        values={{}}
        onChange={vi.fn()}
        resetKey="second_tool"
      />,
    );
    expect(getAceTextByLabel(/Arguments JSON/)).toBe("{}");
  });

  // A per-field switch would offer to edit a fragment of the payload the outer
  // switch already covers whole — and would nest one JSON editor inside another
  // the moment both were on.
  it("offers no switch on a nested object's form", async () => {
    const user = userEvent.setup();
    const nested: InspectorFormSchema = {
      type: "object",
      properties: {
        outer: {
          type: "object",
          title: "Outer",
          properties: { inner: { type: "string", title: "Inner" } },
        },
      },
    };
    renderWithMantine(<RawHarness schema={nested} />);
    expect(screen.getAllByLabelText("Edit as JSON")).toHaveLength(1);

    await enableRawJson(user);
    expect(screen.getAllByLabelText("Edit as JSON")).toHaveLength(1);
  });

  // #2224: a root union whose alternatives are all declined resolves to a base
  // with nothing on it, so the form renders no picker and no fields. The switch
  // is the only way to make the call — open it rather than leaving the user in
  // front of a blank form to work that out.
  describe("fallback for an unrenderable root union (#2224)", () => {
    // Every member requires a name it never declares, so none is offerable.
    const deadEnd: InspectorFormSchema = {
      type: "object",
      anyOf: [
        {
          type: "object",
          properties: { kind: { type: "string", const: "a" } },
          required: ["kind", "payload"],
        },
        {
          type: "object",
          properties: { kind: { type: "string", const: "b" } },
          required: ["kind", "payload"],
        },
      ],
    };

    function switchElement(): HTMLInputElement {
      return screen.getByLabelText("Edit as JSON") as HTMLInputElement;
    }

    it("opens the editor when the form would otherwise be empty", () => {
      renderWithMantine(<RawHarness schema={deadEnd} />);
      expect(switchElement().checked).toBe(true);
      expect(getAceTextByLabel(/Arguments JSON/)).toBe("{}");
    });

    it("leaves the editor closed for a tool that takes no arguments", () => {
      // Nothing to render here either, but nothing is missing: seeding a JSON
      // editor for `{}` would be noise on every no-argument tool.
      renderWithMantine(
        <RawHarness schema={{ type: "object", properties: {} }} />,
      );
      expect(switchElement().checked).toBe(false);
    });

    it("still lets the user switch back to the fields", async () => {
      const user = userEvent.setup();
      renderWithMantine(<RawHarness schema={deadEnd} />);
      await user.click(switchElement());
      expect(switchElement().checked).toBe(false);
    });

    it("opens the editor for a schema that arrives after the first render", () => {
      // The form is reused across tools rather than remounted, so a `useState`
      // initializer alone would only ever see the tool it mounted on.
      const { rerender } = renderWithMantine(
        <SchemaForm schema={schema} values={{}} onChange={vi.fn()} />,
      );
      expect(switchElement().checked).toBe(false);

      rerender(<SchemaForm schema={deadEnd} values={{}} onChange={vi.fn()} />);
      expect(switchElement().checked).toBe(true);
    });

    it("does not close an editor the user opened when the schema changes", async () => {
      // One-way: the fallback opens the editor, and nothing closes it but the
      // user.
      const user = userEvent.setup();
      const { rerender } = renderWithMantine(
        <SchemaForm schema={schema} values={{}} onChange={vi.fn()} />,
      );
      await enableRawJson(user);

      rerender(
        <SchemaForm
          schema={{ type: "object", properties: {} }}
          values={{}}
          onChange={vi.fn()}
        />,
      );
      expect(switchElement().checked).toBe(true);
    });
  });
});

// A plain `<input>` swallows Enter, so a string argument could not be given a
// value containing newlines (#2042). Each string field carries an enlarge button
// that swaps it for a text area, one-way.
describe("SchemaForm multiline strings (#2042)", () => {
  const stringSchema: InspectorFormSchema = {
    type: "object",
    properties: {
      note: { type: "string", title: "Note", maxLength: 40 },
    },
  };

  function StringHarness({ resetKey }: { resetKey?: string }) {
    const [values, setValues] = useState<Record<string, unknown>>({});
    return (
      <SchemaForm
        schema={stringSchema}
        values={values}
        onChange={setValues}
        resetKey={resetKey}
      />
    );
  }

  it("renders a single-line input with an enlarge button by default", () => {
    renderWithMantine(<StringHarness />);
    expect(screen.getByRole("textbox", { name: /Note/ }).tagName).toBe("INPUT");
    expect(
      screen.getByRole("button", { name: "Enlarge Note" }),
    ).toBeInTheDocument();
  });

  it("swaps the input for a text area that accepts newlines", async () => {
    const user = userEvent.setup();
    renderWithMantine(<StringHarness />);

    await user.click(screen.getByRole("button", { name: "Enlarge Note" }));

    const textarea = screen.getByRole("textbox", {
      name: /Note/,
    }) as HTMLTextAreaElement;
    expect(textarea.tagName).toBe("TEXTAREA");
    await user.type(textarea, "one{Enter}two");
    expect(textarea.value).toBe("one\ntwo");
  });

  it("carries the constraints of the field it replaced", async () => {
    const user = userEvent.setup();
    renderWithMantine(<StringHarness />);
    await user.click(screen.getByRole("button", { name: "Enlarge Note" }));
    expect(screen.getByRole("textbox", { name: /Note/ })).toHaveAttribute(
      "maxlength",
      "40",
    );
  });

  it("is one-way — the enlarge button is gone once used", async () => {
    const user = userEvent.setup();
    renderWithMantine(<StringHarness />);
    await user.click(screen.getByRole("button", { name: "Enlarge Note" }));
    expect(
      screen.queryByRole("button", { name: "Enlarge Note" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the clear button working after enlarging", async () => {
    const user = userEvent.setup();
    renderWithMantine(<StringHarness />);

    await user.type(screen.getByRole("textbox", { name: /Note/ }), "typed");
    await user.click(screen.getByRole("button", { name: "Enlarge Note" }));
    const textarea = screen.getByRole("textbox", {
      name: /Note/,
    }) as HTMLTextAreaElement;
    expect(textarea.value).toBe("typed");

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(textarea.value).toBe("");
  });

  it("shows no clear button until the field holds a value", async () => {
    const user = userEvent.setup();
    renderWithMantine(<StringHarness />);
    expect(
      screen.queryByRole("button", { name: "Clear" }),
    ).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /Note/ }), "x");
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  // Enlarging belongs to the field the user enlarged, not to its name — the
  // same reasoning resetKey documents for the number field's draft.
  it("goes back to a single-line input when resetKey moves to another entity", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithMantine(<StringHarness resetKey="tool-a" />);

    await user.click(screen.getByRole("button", { name: "Enlarge Note" }));
    expect(screen.getByRole("textbox", { name: /Note/ }).tagName).toBe(
      "TEXTAREA",
    );

    rerender(<StringHarness resetKey="tool-b" />);
    expect(screen.getByRole("textbox", { name: /Note/ }).tagName).toBe("INPUT");
  });

  it("stays enlarged while resetKey is unchanged", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithMantine(<StringHarness resetKey="tool-a" />);

    await user.click(screen.getByRole("button", { name: "Enlarge Note" }));
    rerender(<StringHarness resetKey="tool-a" />);
    expect(screen.getByRole("textbox", { name: /Note/ }).tagName).toBe(
      "TEXTAREA",
    );
  });

  it("gives each field's enlarge button a distinct accessible name", () => {
    renderWithMantine(
      <SchemaForm
        schema={{
          type: "object",
          properties: {
            note: { type: "string", title: "Note" },
            summary: { type: "string", title: "Summary" },
          },
        }}
        values={{}}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Enlarge Note" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Enlarge Summary" }),
    ).toBeInTheDocument();
  });

  // The button unmounts in the same commit that mounts the text area, taking
  // the focused element with it, so without an explicit hand-off the user is
  // left focused on nothing. (The keyboard route hands off from the field
  // instead — see the #2138 suite.)
  it("moves focus into the text area, caret last, when activated", async () => {
    const user = userEvent.setup();
    renderWithMantine(<StringHarness />);

    await user.type(screen.getByRole("textbox", { name: /Note/ }), "typed");
    await user.click(screen.getByRole("button", { name: "Enlarge Note" }));

    const textarea = screen.getByRole("textbox", {
      name: /Note/,
    }) as HTMLTextAreaElement;
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveFocus();
    // Clicking asks for a bigger box and nothing else: the value is carried
    // over untouched, and only Enter — the key that means "new line" — enters
    // one (#2138).
    expect(textarea.value).toBe("typed");
    expect(textarea.selectionStart).toBe("typed".length);

    // And the caret really is at the end: typing appends rather than prepends.
    await user.keyboard("{Enter}more");
    expect(textarea.value).toBe("typed\nmore");
  });

  // A disabled form (a tool call in flight) must be inert as a whole: a live
  // button there would swap in a text area that mounts disabled, cannot take
  // focus, and so drops keyboard focus to the document.
  it("disables the enlarge button along with the field", () => {
    renderWithMantine(
      <SchemaForm
        schema={stringSchema}
        values={{}}
        onChange={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByRole("button", { name: "Enlarge Note" })).toBeDisabled();
  });
  describe("a root-level union (#2123)", () => {
    const UNION_SCHEMA: InspectorFormSchema = {
      type: "object",
      properties: { note: { type: "string", title: "Note" } },
      anyOf: [
        {
          type: "object",
          properties: {
            kind: { type: "string", const: "email" },
            address: { type: "string", title: "Address" },
          },
          required: ["kind", "address"],
        },
        {
          type: "object",
          properties: {
            kind: { type: "string", const: "sms" },
            phone: { type: "string", title: "Phone" },
          },
          required: ["kind", "phone"],
        },
      ],
    };

    it("renders the first branch's fields with a picker, not an empty form", () => {
      renderWithMantine(
        <SchemaForm schema={UNION_SCHEMA} values={{}} onChange={vi.fn()} />,
      );
      expect(screen.getByRole("textbox", { name: /Note/ })).toBeTruthy();
      expect(screen.getByRole("textbox", { name: /Address/ })).toBeTruthy();
      expect(screen.queryByRole("textbox", { name: /Phone/ })).toBeNull();
      expect(
        (screen.getByRole("textbox", { name: /Variant/ }) as HTMLInputElement)
          .value,
      ).toBe("email");
    });

    it("switches to the chosen branch's fields", async () => {
      const user = userEvent.setup();
      renderWithMantine(
        <SchemaForm schema={UNION_SCHEMA} values={{}} onChange={vi.fn()} />,
      );
      await user.click(screen.getByRole("textbox", { name: /Variant/ }));
      await user.click(screen.getByRole("option", { name: "sms" }));
      expect(screen.getByRole("textbox", { name: /Phone/ })).toBeTruthy();
      expect(screen.queryByRole("textbox", { name: /Address/ })).toBeNull();
    });

    it("drops the outgoing branch's values and seeds the incoming branch's const", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithMantine(
        <SchemaForm
          schema={UNION_SCHEMA}
          values={{ note: "hi", kind: "email", address: "a@b.c" }}
          onChange={onChange}
        />,
      );
      await user.click(screen.getByRole("textbox", { name: /Variant/ }));
      await user.click(screen.getByRole("option", { name: "sms" }));
      // `address` belongs to a shape this call is no longer making, so it must
      // not ride along invisibly into the submitted arguments.
      expect(onChange).toHaveBeenCalledWith({ note: "hi", kind: "sms" });
    });

    it("renders a const-pinned field read-only", () => {
      renderWithMantine(
        <SchemaForm
          schema={UNION_SCHEMA}
          values={{ kind: "email" }}
          onChange={vi.fn()}
        />,
      );
      const kind = screen.getByRole("textbox", {
        name: /kind/,
      }) as HTMLInputElement;
      expect(kind.readOnly).toBe(true);
      expect(kind.value).toBe("email");
    });

    it("lets an optional const be opted into and left out", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const optional: InspectorFormSchema = {
        type: "object",
        properties: { dryRun: { type: "boolean", const: true, title: "Dry" } },
      };
      function Host() {
        const [values, setValues] = useState<Record<string, unknown>>({});
        return (
          <SchemaForm
            schema={optional}
            values={values}
            onChange={(next) => {
              setValues(next);
              onChange(next);
            }}
          />
        );
      }
      renderWithMantine(<Host />);

      const field = screen.getByRole("textbox", {
        name: /Dry/,
      }) as HTMLInputElement;
      // Not supplied to begin with — `const` does not demand the property.
      expect(field.value).toBe("");

      await user.click(field);
      await user.click(screen.getByRole("option", { name: "true" }));
      // Opting in sends the schema's own typed value, not the label.
      expect(onChange).toHaveBeenCalledWith({ dryRun: true });

      // Mantine marks its combobox clear button `aria-hidden` (mouse-only,
      // `tabIndex={-1}`), so it is only reachable with `hidden: true`.
      await user.click(screen.getByRole("button", { hidden: true }));
      // …and opting back out leaves the property absent from the call.
      expect(onChange).toHaveBeenLastCalledWith({ dryRun: undefined });
    });

    it("renders a non-string constant read-only too", () => {
      // Reached before the number/boolean dispatch, so neither offers a value
      // the `const` forbids.
      renderWithMantine(
        <SchemaForm
          schema={{
            type: "object",
            properties: {
              n: { type: "number", const: 7, title: "N" },
              b: { type: "boolean", const: true, title: "B" },
            },
            required: ["n", "b"],
          }}
          values={{}}
          onChange={vi.fn()}
        />,
      );
      expect(
        (screen.getByRole("textbox", { name: /N/ }) as HTMLInputElement).value,
      ).toBe("7");
      expect(
        (screen.getByRole("textbox", { name: /B/ }) as HTMLInputElement).value,
      ).toBe("true");
    });

    it("keeps a const out of an enum select", () => {
      // A schema carrying both would otherwise reach the select and offer the
      // enum's other members, each of which the `const` rejects.
      renderWithMantine(
        <SchemaForm
          schema={{
            type: "object",
            properties: {
              mode: {
                type: "string",
                const: "fast",
                enum: ["fast", "slow"],
                title: "Mode",
              },
            },
            required: ["mode"],
          }}
          values={{}}
          onChange={vi.fn()}
        />,
      );
      const mode = screen.getByRole("textbox", {
        name: /Mode/,
      }) as HTMLInputElement;
      expect(mode.readOnly).toBe(true);
      expect(mode.value).toBe("fast");
    });

    it("opens on the branch the supplied values identify", () => {
      // A deep link overlays its args on the initial defaults, so values for
      // one branch can arrive while the picker would otherwise open on another.
      renderWithMantine(
        <SchemaForm
          schema={UNION_SCHEMA}
          values={{ kind: "sms", phone: "555" }}
          onChange={vi.fn()}
        />,
      );
      expect(
        (screen.getByRole("textbox", { name: /Variant/ }) as HTMLInputElement)
          .value,
      ).toBe("sms");
      expect(screen.getByRole("textbox", { name: /Phone/ })).toBeTruthy();
    });

    it("does not carry a value the outgoing branch declared", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const schema: InspectorFormSchema = {
        type: "object",
        anyOf: [
          {
            type: "object",
            title: "A",
            properties: { value: { type: "number", title: "Value" } },
          },
          {
            type: "object",
            title: "B",
            properties: { value: { type: "boolean", title: "Value" } },
          },
        ],
      };
      renderWithMantine(
        <SchemaForm
          schema={schema}
          values={{ value: 3 }}
          onChange={onChange}
        />,
      );
      await user.click(screen.getByRole("textbox", { name: /Variant/ }));
      await user.click(screen.getByRole("option", { name: "B" }));
      // Branch B types `value` as a boolean; carrying the 3 would check the box
      // and submit a number the branch rejects.
      expect(onChange).toHaveBeenCalledWith({});
    });

    it("keeps a root value the incoming branch merely inherits", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const schema: InspectorFormSchema = {
        type: "object",
        properties: { count: {} },
        anyOf: [
          {
            type: "object",
            title: "A",
            properties: { count: { type: "number", title: "Count" } },
          },
          {
            type: "object",
            title: "B",
            properties: { other: { type: "string", title: "Other" } },
          },
        ],
      };
      renderWithMantine(
        <SchemaForm
          schema={schema}
          values={{ count: 3 }}
          onChange={onChange}
        />,
      );
      await user.click(screen.getByRole("textbox", { name: /Variant/ }));
      await user.click(screen.getByRole("option", { name: "B" }));
      // Branch B does not redeclare `count`, so it is a root argument there —
      // dropping it would erase a value the schema still accepts.
      expect(onChange).toHaveBeenCalledWith({ count: 3 });
    });

    it("clears an in-progress draft when the branch changes", async () => {
      const user = userEvent.setup();
      const schema: InspectorFormSchema = {
        type: "object",
        anyOf: [
          {
            type: "object",
            title: "A",
            properties: { value: { type: "number", title: "Value" } },
          },
          {
            type: "object",
            title: "B",
            properties: { value: { type: "number", title: "Value" } },
          },
        ],
      };
      renderWithMantine(
        <SchemaForm schema={schema} values={{}} onChange={vi.fn()} />,
      );
      const before = screen.getByLabelText(/Value/) as HTMLInputElement;
      // A lone `-` parses to nothing, so the parent value stays `undefined` on
      // both sides of the switch — the field's own key is what has to change.
      await user.type(before, "-");
      expect(before.value).toBe("-");

      await user.click(screen.getByRole("textbox", { name: /Variant/ }));
      await user.click(screen.getByRole("option", { name: "B" }));
      expect((screen.getByLabelText(/Value/) as HTMLInputElement).value).toBe(
        "",
      );
    });

    it("resets a nested form's own branch when the outer branch changes", async () => {
      const user = userEvent.setup();
      const nested: InspectorFormSchema = {
        type: "object",
        properties: {
          config: {
            type: "object",
            title: "Config",
            properties: {},
            anyOf: [
              {
                type: "object",
                title: "Inner A",
                properties: { alpha: { type: "string", title: "Alpha" } },
              },
              {
                type: "object",
                title: "Inner B",
                properties: { beta: { type: "string", title: "Beta" } },
              },
            ],
          },
        },
        anyOf: [
          { type: "object", title: "Outer A", properties: { x: {} } },
          { type: "object", title: "Outer B", properties: { y: {} } },
        ],
      };
      renderWithMantine(
        <SchemaForm schema={nested} values={{}} onChange={vi.fn()} />,
      );
      const [outer, inner] = screen.getAllByRole("textbox", {
        name: /Variant/,
      });
      await user.click(inner!);
      await user.click(screen.getByRole("option", { name: "Inner B" }));
      expect(screen.getByRole("textbox", { name: /Beta/ })).toBeTruthy();

      await user.click(outer!);
      await user.click(screen.getByRole("option", { name: "Outer B" }));
      // The nested form is still mounted, so only a changed reset key can stop
      // it displaying a branch the newly seeded values do not describe.
      expect(screen.getByRole("textbox", { name: /Alpha/ })).toBeTruthy();
    });

    it("reports the branch's fixed values upward when mounted with none", async () => {
      // A read-only `const` the caller never seeded would otherwise be
      // displayed and, if required, keep submit disabled forever.
      const onChange = vi.fn();
      renderWithMantine(
        <SchemaForm schema={UNION_SCHEMA} values={{}} onChange={onChange} />,
      );
      await waitFor(() =>
        expect(onChange).toHaveBeenCalledWith({ kind: "email" }),
      );
    });

    it("reports nothing when the caller already seeded them", async () => {
      const onChange = vi.fn();
      renderWithMantine(
        <SchemaForm
          schema={UNION_SCHEMA}
          values={{ kind: "email" }}
          onChange={onChange}
        />,
      );
      // Nothing is missing, so the form does not touch the caller's values.
      await Promise.resolve();
      expect(onChange).not.toHaveBeenCalled();
    });

    it("keeps a cleared root field cleared across a branch switch", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const schema: InspectorFormSchema = {
        type: "object",
        properties: { count: { type: "number", default: 7, title: "Count" } },
        anyOf: [
          { type: "object", title: "A", properties: { x: {} } },
          { type: "object", title: "B", properties: { y: {} } },
        ],
      };
      renderWithMantine(
        <SchemaForm
          schema={schema}
          // What clearing a number field leaves behind: the name is present
          // with no value, which is the user's answer and not an absence.
          values={{ count: undefined }}
          onChange={onChange}
        />,
      );
      await user.click(screen.getByRole("textbox", { name: /Variant/ }));
      await user.click(screen.getByRole("option", { name: "B" }));
      expect(onChange).toHaveBeenCalledWith({ count: undefined });
    });

    it("seeds a newly pinned field when the schema changes in place", async () => {
      // A tool refreshed in place keeps its `resetKey` and its branch while the
      // schema changes underneath — the new read-only field must still be
      // seeded, or a required one leaves submit disabled with no way to fix it.
      const onChange = vi.fn();
      const before: InspectorFormSchema = {
        type: "object",
        properties: { a: { type: "string", title: "A" } },
      };
      const { rerender } = renderWithMantine(
        <SchemaForm
          schema={before}
          values={{}}
          onChange={onChange}
          resetKey="same-tool"
        />,
      );
      await Promise.resolve();
      onChange.mockClear();

      rerender(
        <SchemaForm
          schema={{
            type: "object",
            properties: {
              a: { type: "string", title: "A" },
              version: { type: "string", const: "2" },
            },
            required: ["version"],
          }}
          values={{}}
          onChange={onChange}
          resetKey="same-tool"
        />,
      );
      await waitFor(() =>
        expect(onChange).toHaveBeenCalledWith({ version: "2" }),
      );
    });

    it("re-derives the selection when the branches are reordered in place", () => {
      // Same `resetKey`, same branch count — only the order changed, so a
      // numeric index would now point at the other shape and the picker would
      // show SMS while `values` describe email.
      const reversed: InspectorFormSchema = {
        ...UNION_SCHEMA,
        anyOf: [...(UNION_SCHEMA.anyOf ?? [])].reverse(),
      };
      const values = { note: "hi", kind: "email", address: "a@b.c" };
      const { rerender } = renderWithMantine(
        <SchemaForm
          schema={UNION_SCHEMA}
          values={values}
          onChange={vi.fn()}
          resetKey="same-tool"
        />,
      );
      expect(screen.getByRole("textbox", { name: /Address/ })).toBeTruthy();

      rerender(
        <SchemaForm
          schema={reversed}
          values={values}
          onChange={vi.fn()}
          resetKey="same-tool"
        />,
      );
      // Still the email branch — the one the values describe — not whatever
      // now sits at the old index.
      expect(
        (screen.getByRole("textbox", { name: /Variant/ }) as HTMLInputElement)
          .value,
      ).toBe("email");
      expect(screen.getByRole("textbox", { name: /Address/ })).toBeTruthy();
    });

    it("corrects a stale const when the schema changes in place", async () => {
      // The user cannot edit a read-only field, so a `const` that moves under
      // an unchanged `resetKey` would display the new value while the old one
      // sat in `values`, waiting to be submitted.
      const onChange = vi.fn();
      const pinned = (value: string): InspectorFormSchema => ({
        type: "object",
        properties: {
          kind: { type: "string", const: value },
          note: { type: "string", title: "Note" },
        },
        required: ["kind"],
      });
      const { rerender } = renderWithMantine(
        <SchemaForm
          schema={pinned("email")}
          values={{ kind: "email", note: "kept" }}
          onChange={onChange}
          resetKey="same-tool"
        />,
      );
      await Promise.resolve();
      onChange.mockClear();

      rerender(
        <SchemaForm
          schema={pinned("sms")}
          values={{ kind: "email", note: "kept" }}
          onChange={onChange}
          resetKey="same-tool"
        />,
      );
      // The constant is corrected; what the user typed is left alone.
      await waitFor(() =>
        expect(onChange).toHaveBeenCalledWith({ kind: "sms", note: "kept" }),
      );
    });

    it("renders no picker for a single-branch union but still shows its fields", () => {
      const schema: InspectorFormSchema = {
        type: "object",
        anyOf: [
          {
            type: "object",
            properties: { only: { type: "string", title: "Only" } },
          },
        ],
      };
      renderWithMantine(
        <SchemaForm schema={schema} values={{}} onChange={vi.fn()} />,
      );
      expect(screen.getByRole("textbox", { name: /Only/ })).toBeTruthy();
      expect(screen.queryByRole("textbox", { name: /Variant/ })).toBeNull();
    });

    it("renders root allOf fields", () => {
      const schema: InspectorFormSchema = {
        type: "object",
        allOf: [
          {
            type: "object",
            properties: { merged: { type: "string", title: "Merged" } },
          },
        ],
      };
      renderWithMantine(
        <SchemaForm schema={schema} values={{}} onChange={vi.fn()} />,
      );
      expect(screen.getByRole("textbox", { name: /Merged/ })).toBeTruthy();
    });

    it("returns to the first branch when resetKey says the form moved on", async () => {
      const user = userEvent.setup();
      const { rerender } = renderWithMantine(
        <SchemaForm
          schema={UNION_SCHEMA}
          values={{}}
          onChange={vi.fn()}
          resetKey="tool-a"
        />,
      );
      await user.click(screen.getByRole("textbox", { name: /Variant/ }));
      await user.click(screen.getByRole("option", { name: "sms" }));
      expect(screen.getByRole("textbox", { name: /Phone/ })).toBeTruthy();

      rerender(
        <SchemaForm
          schema={UNION_SCHEMA}
          values={{}}
          onChange={vi.fn()}
          resetKey="tool-b"
        />,
      );
      expect(screen.getByRole("textbox", { name: /Address/ })).toBeTruthy();
      expect(screen.queryByRole("textbox", { name: /Phone/ })).toBeNull();
    });

    it("clamps a selection the next schema's shorter union cannot hold", async () => {
      const user = userEvent.setup();
      const { rerender } = renderWithMantine(
        <SchemaForm schema={UNION_SCHEMA} values={{}} onChange={vi.fn()} />,
      );
      await user.click(screen.getByRole("textbox", { name: /Variant/ }));
      await user.click(screen.getByRole("option", { name: "sms" }));

      // No `resetKey`, so nothing resets the selection: index 1 must be clamped
      // rather than reaching past the end of a one-branch union.
      const shorter: InspectorFormSchema = {
        type: "object",
        anyOf: [
          {
            type: "object",
            properties: { solo: { type: "string", title: "Solo" } },
          },
        ],
      };
      rerender(<SchemaForm schema={shorter} values={{}} onChange={vi.fn()} />);
      expect(screen.getByRole("textbox", { name: /Solo/ })).toBeTruthy();
    });
  });
});

// The enlarge button is clickable but out of the tab order, so tabbing runs
// field to field; Enter in a single-line string field takes its place as the
// keyboard route into multiline mode (#2138).
describe("SchemaForm enlarge keyboard access (#2138)", () => {
  const twoStringSchema: InspectorFormSchema = {
    type: "object",
    properties: {
      note: { type: "string", title: "Note" },
      summary: { type: "string", title: "Summary" },
    },
  };

  function TwoStringHarness({ disabled }: { disabled?: boolean }) {
    const [values, setValues] = useState<Record<string, unknown>>({});
    return (
      <SchemaForm
        schema={twoStringSchema}
        values={values}
        onChange={setValues}
        disabled={disabled}
      />
    );
  }

  // Seeds a value and holds it in real state. A stub `onChange` would leave the
  // field's value frozen, which makes "the value did not change" assertions
  // pass whatever the component does.
  function SeededHarness({
    maxLength,
    initial = "abc",
  }: {
    maxLength?: number;
    initial?: unknown;
  }) {
    const [values, setValues] = useState<Record<string, unknown>>({
      note: initial,
    });
    return (
      <SchemaForm
        schema={{
          type: "object",
          properties: { note: { type: "string", title: "Note", maxLength } },
        }}
        values={values}
        onChange={setValues}
      />
    );
  }

  const noteField = () =>
    screen.getByRole("textbox", { name: /Note/ }) as HTMLTextAreaElement;

  // The defect the issue was filed for: an extra stop per field, on every
  // string field of every tool form.
  it("tabs from one string field to the next, skipping the enlarge buttons", async () => {
    const user = userEvent.setup();
    renderWithMantine(<TwoStringHarness />);

    noteField().focus();
    await user.tab();

    expect(screen.getByRole("textbox", { name: /Summary/ })).toHaveFocus();
  });

  // A populated field renders the clear button too, so this is the widest the
  // right section ever gets — and still must not add a stop.
  it("skips both right-section buttons when the field holds a value", async () => {
    const user = userEvent.setup();
    renderWithMantine(<TwoStringHarness />);

    await user.type(noteField(), "typed");
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
    await user.tab();

    expect(screen.getByRole("textbox", { name: /Summary/ })).toHaveFocus();
  });

  it("enlarges the focused field when Enter is pressed", async () => {
    const user = userEvent.setup();
    renderWithMantine(<TwoStringHarness />);

    expect(noteField().tagName).toBe("INPUT");
    noteField().focus();
    await user.keyboard("{Enter}");

    expect(noteField().tagName).toBe("TEXTAREA");
  });

  // Enlarging is per field: the key must not reach the neighbour.
  it("enlarges only the focused field", async () => {
    const user = userEvent.setup();
    renderWithMantine(<TwoStringHarness />);

    noteField().focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("textbox", { name: /Summary/ }).tagName).toBe(
      "INPUT",
    );
  });

  // The other gesture a user reaches for when an input will not take a newline.
  it("enlarges on Shift+Enter too", async () => {
    const user = userEvent.setup();
    renderWithMantine(<TwoStringHarness />);

    noteField().focus();
    await user.keyboard("{Shift>}{Enter}{/Shift}");

    expect(noteField().tagName).toBe("TEXTAREA");
  });

  // Those chords read as "submit" and stay free for a consumer to bind to
  // running the tool; claiming them would silently enlarge a field instead.
  it.each([
    ["Ctrl", "{Control>}{Enter}{/Control}"],
    ["Meta", "{Meta>}{Enter}{/Meta}"],
    ["Alt", "{Alt>}{Enter}{/Alt}"],
  ])("leaves %s+Enter alone", async (_name, keys) => {
    const user = userEvent.setup();
    renderWithMantine(<TwoStringHarness />);

    noteField().focus();
    await user.keyboard(keys);

    expect(noteField().tagName).toBe("INPUT");
  });

  // Enter is also how an IME commits the candidate being composed, so acting on
  // it there would enlarge the field and insert a newline every time a
  // Japanese/Chinese/Korean user finished a word. userEvent has no composition
  // mode, so the event is dispatched directly with the flag React reads.
  it("ignores the Enter that commits an IME composition", () => {
    renderWithMantine(<TwoStringHarness />);

    fireEvent.keyDown(noteField(), { key: "Enter", isComposing: true });

    expect(noteField().tagName).toBe("INPUT");
    expect(noteField().value).toBe("");
  });

  // WebKit is reported to fire `compositionend` before the committing keydown,
  // so `isComposing` is already false there and the guard above cannot see it.
  // 229 is the older sentinel for "this key went to the IME", which that event
  // still carries (#2139 review).
  it("ignores a committing IME keydown that only reports keyCode 229", () => {
    renderWithMantine(<TwoStringHarness />);

    fireEvent.keyDown(noteField(), {
      key: "Enter",
      isComposing: false,
      keyCode: 229,
    });

    expect(noteField().tagName).toBe("INPUT");
    expect(noteField().value).toBe("");
  });

  // The control for the sentinel: a real Enter reports 13 and must still work,
  // so the guard cannot be swallowing ordinary keystrokes.
  it("still enlarges on an Enter reporting keyCode 13", () => {
    renderWithMantine(<TwoStringHarness />);

    fireEvent.keyDown(noteField(), { key: "Enter", keyCode: 13 });

    expect(noteField().tagName).toBe("TEXTAREA");
  });

  // Same event without the flag, to prove the guard above is what turned it
  // away rather than fireEvent simply not reaching the handler.
  it("still enlarges on an Enter that is not composing", () => {
    renderWithMantine(<TwoStringHarness />);

    fireEvent.keyDown(noteField(), { key: "Enter", isComposing: false });

    expect(noteField().tagName).toBe("TEXTAREA");
  });

  it("leaves the field alone for any other key", async () => {
    const user = userEvent.setup();
    renderWithMantine(<TwoStringHarness />);

    await user.type(noteField(), "text ");
    await user.keyboard("{Escape}{ArrowDown} ");

    expect(noteField().tagName).toBe("INPUT");
  });

  // The keystroke has to mean what it says. Enlarging without entering the
  // newline consumes the key and leaves the next word running on from the last
  // one — the user pressed "new line" and got a reshaped box.
  it("enters the newline it was asked for, not just the text area", async () => {
    const user = userEvent.setup();
    renderWithMantine(<TwoStringHarness />);

    await user.type(noteField(), "before");
    await user.keyboard("{Enter}");
    expect(noteField().value).toBe("before\n");

    await user.keyboard("after");
    expect(noteField().value).toBe("before\nafter");
  });

  // The caret follows the newline, so what is typed next lands under it rather
  // than back on the first line.
  it("leaves the caret after the newline", async () => {
    const user = userEvent.setup();
    renderWithMantine(<TwoStringHarness />);

    await user.type(noteField(), "before");
    await user.keyboard("{Enter}");

    expect(noteField().selectionStart).toBe("before\n".length);
  });

  // The newline goes in where the caret is, exactly as it would in a text area.
  // Appending at the end instead silently rewrites the value whenever the caret
  // was not already there — `abc|def` would become `abcdef` with a trailing
  // blank line (#2139 review).
  it("inserts the newline at the caret, not at the end", async () => {
    const user = userEvent.setup();
    renderWithMantine(<TwoStringHarness />);

    await user.type(noteField(), "abcdef");
    noteField().setSelectionRange(3, 3);
    fireEvent.keyDown(noteField(), { key: "Enter" });

    expect(noteField().value).toBe("abc\ndef");
    expect(noteField().selectionStart).toBe(4);
  });

  // And a selected range is replaced, not kept — again matching what typing
  // Enter into a real text area does.
  it("replaces a selected range with the newline", async () => {
    const user = userEvent.setup();
    renderWithMantine(<TwoStringHarness />);

    await user.type(noteField(), "abcdef");
    noteField().setSelectionRange(3, 6);
    fireEvent.keyDown(noteField(), { key: "Enter" });

    expect(noteField().value).toBe("abc\n");
    expect(noteField().selectionStart).toBe(4);
  });

  // Splitting at the very start is the boundary the slice arithmetic is most
  // likely to get wrong.
  it("splits at the start of the value", async () => {
    const user = userEvent.setup();
    renderWithMantine(<TwoStringHarness />);

    await user.type(noteField(), "abc");
    noteField().setSelectionRange(0, 0);
    fireEvent.keyDown(noteField(), { key: "Enter" });

    expect(noteField().value).toBe("\nabc");
    expect(noteField().selectionStart).toBe(1);
  });

  // A newline is a character, so a field with no room for one is enlarged
  // without it rather than pushed past a constraint its schema states.
  it("enlarges without a newline when the field is at its maxLength", async () => {
    const user = userEvent.setup();
    renderWithMantine(<SeededHarness maxLength={3} />);

    noteField().focus();
    await user.keyboard("{Enter}");

    expect(noteField().tagName).toBe("TEXTAREA");
    expect(noteField().value).toBe("abc");
  });

  // Replacing a selection frees room, so the same full field does take the
  // newline when the keystroke is removing something to make space for it.
  it("enters the newline at maxLength when a selection makes room", () => {
    renderWithMantine(<SeededHarness maxLength={3} />);

    noteField().setSelectionRange(1, 3);
    fireEvent.keyDown(noteField(), { key: "Enter" });

    expect(noteField().value).toBe("a\n");
  });

  // `values` is a Record<string, unknown> fed by whatever a server declares, so
  // a string field can arrive holding a number. It renders as text, and slicing
  // it as a string would throw — turning one keystroke into a crashed panel
  // (#2139 review). Reading the control's own value keeps it a string.
  it("survives a non-string value on a string field", () => {
    renderWithMantine(<SeededHarness initial={123} />);

    expect(noteField().value).toBe("123");
    noteField().setSelectionRange(3, 3);
    fireEvent.keyDown(noteField(), { key: "Enter" });

    expect(noteField().tagName).toBe("TEXTAREA");
    expect(noteField().value).toBe("123\n");
  });

  // Even when the newline does not fit, the keyboard had a real caret position
  // and it is kept — otherwise the user editing the middle of a full field is
  // thrown to the end on top of not getting their newline.
  it("keeps the caret where it was when the newline does not fit", () => {
    renderWithMantine(<SeededHarness maxLength={3} />);

    noteField().setSelectionRange(1, 1);
    fireEvent.keyDown(noteField(), { key: "Enter" });

    expect(noteField().value).toBe("abc");
    expect(noteField().selectionStart).toBe(1);
  });

  // JSON Schema counts maxLength in Unicode code points; String.length counts
  // UTF-16 code units, so an emoji reads as 2 and a field with room left is
  // treated as full (#2139 review).
  it("counts maxLength in code points, not UTF-16 units", () => {
    renderWithMantine(<SeededHarness maxLength={2} initial="😀" />);

    noteField().setSelectionRange(2, 2);
    fireEvent.keyDown(noteField(), { key: "Enter" });

    // One emoji plus one newline is two characters, so it fits.
    expect(noteField().value).toBe("😀\n");
  });

  // A field name that collides with something on Object.prototype must still
  // take the documented end-of-value fallback when enlarged by pointer, rather
  // than reading an inherited value off a bare record (#2139 review).
  it("handles a field named after an Object.prototype member", async () => {
    const user = userEvent.setup();

    // Both halves are annotated rather than inlined. Under a `constructor` key
    // the contextual type does not reach the nested literal, so `type: "string"`
    // widens to `string` and fails to typecheck — the type-level echo of the
    // very prototype collision this test is about.
    const ctorField: InspectorFormSchema = { type: "string", title: "Ctor" };
    const prototypeSchema: InspectorFormSchema = {
      type: "object",
      properties: { constructor: ctorField },
    };

    function PrototypeHarness() {
      const [values, setValues] = useState<Record<string, unknown>>({
        constructor: "abc",
      });
      return (
        <SchemaForm
          schema={prototypeSchema}
          values={values}
          onChange={setValues}
        />
      );
    }

    renderWithMantine(<PrototypeHarness />);
    await user.click(screen.getByRole("button", { name: "Enlarge Ctor" }));

    const field = screen.getByRole("textbox", {
      name: /Ctor/,
    }) as HTMLTextAreaElement;
    expect(field.tagName).toBe("TEXTAREA");
    expect(field.selectionStart).toBe("abc".length);
  });

  // The control: the same seeded field with no maxLength does take the newline,
  // so the test above is showing the constraint at work rather than a field
  // that never accepts one.
  it("enters the newline when the field has no maxLength", () => {
    renderWithMantine(<SeededHarness />);

    noteField().setSelectionRange(3, 3);
    fireEvent.keyDown(noteField(), { key: "Enter" });

    expect(noteField().value).toBe("abc\n");
  });

  // An empty field still has room, so the newline is entered there too.
  it("enters a newline in an empty field", async () => {
    const user = userEvent.setup();
    renderWithMantine(<TwoStringHarness />);

    noteField().focus();
    await user.keyboard("{Enter}");

    expect(noteField().value).toBe("\n");
  });

  // The binding is the keyboard's only route in now, so announce that the
  // field carries one rather than leaving it undiscoverable.
  it("advertises the shortcut on the single-line field, not the text area", async () => {
    const user = userEvent.setup();
    renderWithMantine(<TwoStringHarness />);

    expect(noteField()).toHaveAttribute("aria-keyshortcuts", "Enter");
    noteField().focus();
    await user.keyboard("{Enter}");

    expect(noteField()).not.toHaveAttribute("aria-keyshortcuts");
  });

  // Same reasoning as the disabled button: a text area mounting disabled cannot
  // take focus, so it would drop focus to the document.
  it("cannot be enlarged by keyboard while the form is disabled", async () => {
    const user = userEvent.setup();
    renderWithMantine(<TwoStringHarness disabled />);

    noteField().focus();
    await user.keyboard("{Enter}");

    expect(noteField().tagName).toBe("INPUT");
  });
});
