import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ToolDetailPanel } from "./ToolDetailPanel";

const simpleTool: Tool = {
  name: "send_message",
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string", description: "The message to send" },
    },
    required: ["message"],
  },
};

const titledTool: Tool = {
  name: "send_message",
  title: "Send Message",
  description: "Sends a message to the recipient",
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string" },
    },
  },
};

const annotatedTool: Tool = {
  name: "delete_records",
  description: "Deletes records",
  annotations: {
    readOnlyHint: true,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string" },
    },
  },
};

const baseProps = {
  formValues: {},
  isExecuting: false,
  onFormChange: vi.fn(),
  onExecute: vi.fn(),
  onCancel: vi.fn(),
};

describe("ToolDetailPanel", () => {
  it("renders the tool name when no title is provided", () => {
    renderWithMantine(<ToolDetailPanel {...baseProps} tool={simpleTool} />);
    expect(screen.getByText("send_message")).toBeInTheDocument();
  });

  it("prefers the title over the name when title is provided", () => {
    renderWithMantine(<ToolDetailPanel {...baseProps} tool={titledTool} />);
    expect(screen.getByText("Send Message")).toBeInTheDocument();
    expect(
      screen.getByText("Sends a message to the recipient"),
    ).toBeInTheDocument();
  });

  it("does not render the description when none is provided", () => {
    renderWithMantine(<ToolDetailPanel {...baseProps} tool={simpleTool} />);
    expect(
      screen.queryByText("Sends a message to the recipient"),
    ).not.toBeInTheDocument();
  });

  it("renders all annotation badges when annotations are present", () => {
    renderWithMantine(<ToolDetailPanel {...baseProps} tool={annotatedTool} />);
    expect(screen.getByText("read-only")).toBeInTheDocument();
    expect(screen.getByText("destructive")).toBeInTheDocument();
    expect(screen.getByText("idempotent")).toBeInTheDocument();
    expect(screen.getByText("open-world")).toBeInTheDocument();
  });

  it("does not render annotation row when no annotation flags are set", () => {
    renderWithMantine(<ToolDetailPanel {...baseProps} tool={simpleTool} />);
    expect(screen.queryByText("read-only")).not.toBeInTheDocument();
    expect(screen.queryByText("destructive")).not.toBeInTheDocument();
  });

  it("does not render annotation row when annotations object is empty", () => {
    const toolWithEmptyAnnotations: Tool = {
      name: "no_hints",
      annotations: { title: "Does not matter" },
      inputSchema: {
        type: "object",
        properties: {},
      },
    };
    renderWithMantine(
      <ToolDetailPanel {...baseProps} tool={toolWithEmptyAnnotations} />,
    );
    expect(screen.queryByText("read-only")).not.toBeInTheDocument();
    expect(screen.queryByText("destructive")).not.toBeInTheDocument();
    expect(screen.queryByText("idempotent")).not.toBeInTheDocument();
    expect(screen.queryByText("open-world")).not.toBeInTheDocument();
  });

  it("renders the Execute Tool button enabled when not executing", () => {
    renderWithMantine(<ToolDetailPanel {...baseProps} tool={simpleTool} />);
    const button = screen.getByRole("button", { name: "Execute Tool" });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });

  it("invokes onExecute when Execute Tool is clicked", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    renderWithMantine(
      <ToolDetailPanel
        {...baseProps}
        tool={simpleTool}
        onExecute={onExecute}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Execute Tool" }));
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it("disables the Execute Tool button while executing and renders Cancel", () => {
    renderWithMantine(
      <ToolDetailPanel {...baseProps} tool={simpleTool} isExecuting={true} />,
    );
    expect(screen.getByRole("button", { name: "Execute Tool" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("invokes onCancel when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderWithMantine(
      <ToolDetailPanel
        {...baseProps}
        tool={simpleTool}
        isExecuting={true}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders progress display when progress is provided", () => {
    renderWithMantine(
      <ToolDetailPanel
        {...baseProps}
        tool={simpleTool}
        progress={{ progress: 3, total: 5, message: "Step 3 of 5" }}
      />,
    );
    expect(screen.getByText("Step 3 of 5")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
  });

  it("renders the schema form using the tool's inputSchema", () => {
    renderWithMantine(<ToolDetailPanel {...baseProps} tool={simpleTool} />);
    // The string field 'message' should render with its description
    expect(screen.getByText("The message to send")).toBeInTheDocument();
  });

  it("invokes onFormChange when the user types in a form field", async () => {
    const user = userEvent.setup();
    const onFormChange = vi.fn();
    renderWithMantine(
      <ToolDetailPanel
        {...baseProps}
        tool={simpleTool}
        onFormChange={onFormChange}
      />,
    );
    const input = screen.getByRole("textbox");
    await user.type(input, "hi");
    expect(onFormChange).toHaveBeenCalled();
  });
});
