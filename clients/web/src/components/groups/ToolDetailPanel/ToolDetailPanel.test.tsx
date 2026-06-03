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

const ICON_SRC = "data:image/svg+xml,%3Csvg/%3E";

const iconedTool: Tool = {
  name: "send_message",
  title: "Send Message",
  icons: [{ src: ICON_SRC }],
  inputSchema: {
    type: "object",
    properties: {},
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
  serverSupportsTaskToolCalls: false,
  runAsTask: false,
  onRunAsTaskChange: vi.fn(),
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

  it("renders the first icon when tool.icons is present", () => {
    renderWithMantine(<ToolDetailPanel {...baseProps} tool={iconedTool} />);
    const img = screen.getByRole("presentation");
    expect(img).toHaveAttribute("src", ICON_SRC);
  });

  it("does not render an icon when tool.icons is missing", () => {
    renderWithMantine(<ToolDetailPanel {...baseProps} tool={simpleTool} />);
    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
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

  describe("Run as task toggle", () => {
    const toolWithSupport = (
      taskSupport: "forbidden" | "optional" | "required",
    ): Tool => ({
      name: "run_job",
      execution: { taskSupport },
      inputSchema: { type: "object", properties: {} },
    });

    it("hides the toggle when the server doesn't support task tool calls", () => {
      renderWithMantine(
        <ToolDetailPanel
          {...baseProps}
          tool={toolWithSupport("optional")}
          serverSupportsTaskToolCalls={false}
        />,
      );
      expect(screen.queryByLabelText("Run as task")).not.toBeInTheDocument();
    });

    it("hides the toggle for a task-forbidden tool even when the server supports tasks", () => {
      renderWithMantine(
        <ToolDetailPanel
          {...baseProps}
          tool={toolWithSupport("forbidden")}
          serverSupportsTaskToolCalls={true}
        />,
      );
      expect(screen.queryByLabelText("Run as task")).not.toBeInTheDocument();
    });

    it("shows an unchecked, enabled toggle for an optional tool (off by default)", () => {
      renderWithMantine(
        <ToolDetailPanel
          {...baseProps}
          tool={toolWithSupport("optional")}
          serverSupportsTaskToolCalls={true}
          runAsTask={false}
        />,
      );
      const toggle = screen.getByLabelText("Run as task");
      expect(toggle).not.toBeChecked();
      expect(toggle).not.toBeDisabled();
    });

    it("reflects the runAsTask prop for an optional tool", () => {
      renderWithMantine(
        <ToolDetailPanel
          {...baseProps}
          tool={toolWithSupport("optional")}
          serverSupportsTaskToolCalls={true}
          runAsTask={true}
        />,
      );
      expect(screen.getByLabelText("Run as task")).toBeChecked();
    });

    it("forces the toggle on and disabled for a required tool", () => {
      renderWithMantine(
        <ToolDetailPanel
          {...baseProps}
          tool={toolWithSupport("required")}
          serverSupportsTaskToolCalls={true}
          runAsTask={false}
        />,
      );
      const toggle = screen.getByLabelText("Run as task");
      expect(toggle).toBeChecked();
      expect(toggle).toBeDisabled();
    });

    it("invokes onRunAsTaskChange when an optional toggle is clicked", async () => {
      const user = userEvent.setup();
      const onRunAsTaskChange = vi.fn();
      renderWithMantine(
        <ToolDetailPanel
          {...baseProps}
          tool={toolWithSupport("optional")}
          serverSupportsTaskToolCalls={true}
          runAsTask={false}
          onRunAsTaskChange={onRunAsTaskChange}
        />,
      );
      await user.click(screen.getByLabelText("Run as task"));
      expect(onRunAsTaskChange).toHaveBeenCalledWith(true);
    });

    it("passes the effective run-as-task decision to onExecute", async () => {
      const user = userEvent.setup();
      const onExecute = vi.fn();
      // optional + runAsTask=true → effective true
      renderWithMantine(
        <ToolDetailPanel
          {...baseProps}
          tool={toolWithSupport("optional")}
          serverSupportsTaskToolCalls={true}
          runAsTask={true}
          onExecute={onExecute}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Execute Tool" }));
      expect(onExecute).toHaveBeenCalledWith(true);
    });

    it("passes runAsTask=true to onExecute for a required tool regardless of the prop", async () => {
      const user = userEvent.setup();
      const onExecute = vi.fn();
      renderWithMantine(
        <ToolDetailPanel
          {...baseProps}
          tool={toolWithSupport("required")}
          serverSupportsTaskToolCalls={true}
          runAsTask={false}
          onExecute={onExecute}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Execute Tool" }));
      expect(onExecute).toHaveBeenCalledWith(true);
    });
  });
});
