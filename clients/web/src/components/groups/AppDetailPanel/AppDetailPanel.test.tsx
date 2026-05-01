import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { AppDetailPanel } from "./AppDetailPanel";

const ICON_SRC = "data:image/svg+xml,%3Csvg/%3E";

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

const optionalFieldTool: Tool = {
  name: "greet",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The name to greet" },
    },
  },
};

const baseProps = {
  formValues: {},
  isOpening: false,
  onFormChange: vi.fn(),
  onOpenApp: vi.fn(),
};

describe("AppDetailPanel", () => {
  it("prefers the title over the name", () => {
    renderWithMantine(
      <AppDetailPanel {...baseProps} tool={requiredFieldTool} />,
    );
    expect(screen.getByText("Greet")).toBeInTheDocument();
  });

  it("falls back to the name when title is missing", () => {
    renderWithMantine(
      <AppDetailPanel {...baseProps} tool={optionalFieldTool} />,
    );
    expect(screen.getByText("greet")).toBeInTheDocument();
  });

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

  it("renders the first icon when tool.icons is present", () => {
    renderWithMantine(
      <AppDetailPanel
        {...baseProps}
        tool={{ ...noFieldsTool, icons: [{ src: ICON_SRC }] }}
      />,
    );
    const img = screen.getByRole("presentation");
    expect(img).toHaveAttribute("src", ICON_SRC);
  });

  it("does not render an icon when tool.icons is missing", () => {
    renderWithMantine(<AppDetailPanel {...baseProps} tool={noFieldsTool} />);
    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
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
});
