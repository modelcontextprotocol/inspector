import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Tool } from "@modelcontextprotocol/client";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { setAceTextByLabel } from "../../../test/aceEditor";
import { AppDetailPanel } from "./AppDetailPanel";

const noFieldsTool: Tool = {
  name: "no_input_app",
  title: "No Input App",
  description: "Takes no parameters",
  inputSchema: { type: "object" },
};

const requiredFieldTool: Tool = {
  name: "greet",
  title: "Greet",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The name to greet" },
    },
    required: ["name"],
  },
};

const baseProps = {
  formValues: {},
  isOpening: false,
  onFormChange: vi.fn(),
  onOpenApp: vi.fn(),
};

describe("AppDetailPanel", () => {
  it("renders the description when provided", () => {
    renderWithMantine(<AppDetailPanel {...baseProps} tool={noFieldsTool} />);
    expect(screen.getByText("Takes no parameters")).toBeInTheDocument();
  });

  it("does not render the description when missing", () => {
    renderWithMantine(
      <AppDetailPanel {...baseProps} tool={requiredFieldTool} />,
    );
    expect(screen.queryByText("Takes no parameters")).not.toBeInTheDocument();
  });

  it("renders the schema form using the tool's inputSchema", () => {
    renderWithMantine(
      <AppDetailPanel {...baseProps} tool={requiredFieldTool} />,
    );
    expect(screen.getByText("The name to greet")).toBeInTheDocument();
  });

  it("invokes onFormChange when the user types in a form field", async () => {
    const user = userEvent.setup();
    const onFormChange = vi.fn();
    renderWithMantine(
      <AppDetailPanel
        {...baseProps}
        tool={requiredFieldTool}
        onFormChange={onFormChange}
      />,
    );
    await user.type(screen.getByRole("textbox"), "h");
    expect(onFormChange).toHaveBeenCalled();
  });

  it("renders a divider above the form when the schema has properties", () => {
    renderWithMantine(
      <AppDetailPanel {...baseProps} tool={requiredFieldTool} />,
    );
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("omits the divider when the schema has no properties", () => {
    renderWithMantine(<AppDetailPanel {...baseProps} tool={noFieldsTool} />);
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("disables the Open App button when a required field is empty", () => {
    renderWithMantine(
      <AppDetailPanel {...baseProps} tool={requiredFieldTool} />,
    );
    expect(screen.getByRole("button", { name: /open app/i })).toBeDisabled();
  });

  it("enables the Open App button when required fields are populated", () => {
    renderWithMantine(
      <AppDetailPanel
        {...baseProps}
        tool={requiredFieldTool}
        formValues={{ name: "Ada" }}
      />,
    );
    expect(
      screen.getByRole("button", { name: /open app/i }),
    ).not.toBeDisabled();
  });

  it("enables the Open App button when there are no required fields", () => {
    renderWithMantine(<AppDetailPanel {...baseProps} tool={noFieldsTool} />);
    expect(
      screen.getByRole("button", { name: /open app/i }),
    ).not.toBeDisabled();
  });

  it("treats null and empty-string values as missing required fields", () => {
    const { rerender } = renderWithMantine(
      <AppDetailPanel
        {...baseProps}
        tool={requiredFieldTool}
        formValues={{ name: null }}
      />,
    );
    expect(screen.getByRole("button", { name: /open app/i })).toBeDisabled();

    rerender(
      <AppDetailPanel
        {...baseProps}
        tool={requiredFieldTool}
        formValues={{ name: "" }}
      />,
    );
    expect(screen.getByRole("button", { name: /open app/i })).toBeDisabled();
  });

  it("disables the Open App button while opening", () => {
    renderWithMantine(
      <AppDetailPanel
        {...baseProps}
        tool={requiredFieldTool}
        formValues={{ name: "Ada" }}
        isOpening={true}
      />,
    );
    expect(screen.getByRole("button", { name: /open app/i })).toBeDisabled();
  });

  // #2171: an App's arguments are a `tools/call` like any other, so its form
  // opts into the same enforcement the Tools tab uses.
  it("refuses a raw-JSON argument the schema would retype", async () => {
    const user = userEvent.setup();
    const numericTool: Tool = {
      name: "chart",
      inputSchema: {
        type: "object",
        properties: { count: { type: "number" } },
      },
    };
    renderWithMantine(
      <AppDetailPanel {...baseProps} tool={numericTool} formValues={{}} />,
    );
    await user.click(screen.getByLabelText("Edit as JSON"));
    await setAceTextByLabel(/Arguments JSON/, '{"count":"01"}');

    expect(
      screen.getByText(/`count` would be converted to the type/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open app/i })).toBeDisabled();
  });

  it("invokes onOpenApp when the button is clicked", async () => {
    const user = userEvent.setup();
    const onOpenApp = vi.fn();
    renderWithMantine(
      <AppDetailPanel
        {...baseProps}
        tool={requiredFieldTool}
        formValues={{ name: "Ada" }}
        onOpenApp={onOpenApp}
      />,
    );
    await user.click(screen.getByRole("button", { name: /open app/i }));
    expect(onOpenApp).toHaveBeenCalledTimes(1);
  });

  it("drops a previous app's in-progress number text when the app changes", async () => {
    const user = userEvent.setup();
    // AppsScreen swaps selectedAppName + formValues in place rather than
    // remounting this panel, so two apps exposing a same-named number field
    // share the field component. Both values here are undefined, which the
    // draft/value re-sync cannot distinguish — only the resetKey identity can.
    const numberFieldTool = (name: string): Tool => ({
      name,
      title: name,
      inputSchema: {
        type: "object",
        properties: { scale: { type: "number", title: "Scale" } },
      },
    });
    const { rerender } = renderWithMantine(
      <AppDetailPanel {...baseProps} tool={numberFieldTool("app_a")} />,
    );
    const input = () => screen.getByLabelText(/Scale/) as HTMLInputElement;
    await user.type(input(), "-");
    expect(input().value).toBe("-");
    rerender(<AppDetailPanel {...baseProps} tool={numberFieldTool("app_b")} />);
    expect(input().value).toBe("");
  });

  // #2020: `hasMissingRequiredFields` sees a field with no value, but text a
  // field could not turn into a value looks identical to it — both report
  // `undefined` — so an optional argument was dropped from the call with no
  // gate. The form reports draft validity for this reason.
  it("disables Open App while a field holds text it cannot send", async () => {
    const jsonFieldTool: Tool = {
      name: "chart_app",
      title: "Chart App",
      inputSchema: {
        type: "object",
        properties: { series: { type: "array", title: "Series" } },
      },
    };
    renderWithMantine(<AppDetailPanel {...baseProps} tool={jsonFieldTool} />);
    const openApp = screen.getByRole("button", { name: /open app/i });
    expect(openApp).not.toBeDisabled();

    await setAceTextByLabel(/Series/, "x");
    expect(openApp).toBeDisabled();

    await setAceTextByLabel(/Series/, "");
    expect(openApp).not.toBeDisabled();
  });
});
