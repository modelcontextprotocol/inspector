import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Tool } from "@modelcontextprotocol/client";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { setAceTextByLabel } from "../../../test/aceEditor";
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

  describe("Collapsible description", () => {
    it("renders the description shown by default (Hide description toggle)", () => {
      renderWithMantine(<ToolDetailPanel {...baseProps} tool={titledTool} />);
      const toggle = screen.getByRole("button", { name: "Hide description" });
      expect(toggle).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Show description" }),
      ).not.toBeInTheDocument();
    });

    it("hides the description when the toggle is clicked", async () => {
      const user = userEvent.setup();
      renderWithMantine(<ToolDetailPanel {...baseProps} tool={titledTool} />);
      await user.click(
        screen.getByRole("button", { name: "Hide description" }),
      );
      expect(
        screen.getByRole("button", { name: "Show description" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Hide description" }),
      ).not.toBeInTheDocument();
    });

    it("shows the description again when the collapsed toggle is clicked", async () => {
      const user = userEvent.setup();
      renderWithMantine(<ToolDetailPanel {...baseProps} tool={titledTool} />);
      await user.click(
        screen.getByRole("button", { name: "Hide description" }),
      );
      await user.click(
        screen.getByRole("button", { name: "Show description" }),
      );
      expect(
        screen.getByRole("button", { name: "Hide description" }),
      ).toBeInTheDocument();
    });

    it("resets to shown when switching to a different tool", async () => {
      const user = userEvent.setup();
      const { rerender } = renderWithMantine(
        <ToolDetailPanel {...baseProps} tool={titledTool} />,
      );
      await user.click(
        screen.getByRole("button", { name: "Hide description" }),
      );
      expect(
        screen.getByRole("button", { name: "Show description" }),
      ).toBeInTheDocument();

      // Switching tools (different name) should reset the local hidden state.
      rerender(<ToolDetailPanel {...baseProps} tool={annotatedTool} />);
      expect(
        screen.getByRole("button", { name: "Hide description" }),
      ).toBeInTheDocument();
    });

    it("wires the toggle as an expandable control (aria-expanded + aria-controls)", async () => {
      const user = userEvent.setup();
      renderWithMantine(<ToolDetailPanel {...baseProps} tool={titledTool} />);
      const toggle = screen.getByRole("button", { name: "Hide description" });
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      // aria-controls points at the Collapse region holding the description.
      const regionId = toggle.getAttribute("aria-controls");
      expect(regionId).toBeTruthy();
      expect(document.getElementById(regionId as string)).toContainElement(
        screen.getByText("Sends a message to the recipient"),
      );

      await user.click(toggle);
      expect(
        screen.getByRole("button", { name: "Show description" }),
      ).toHaveAttribute("aria-expanded", "false");
    });

    it("does not render a description toggle when the tool has no description", () => {
      renderWithMantine(<ToolDetailPanel {...baseProps} tool={simpleTool} />);
      expect(
        screen.queryByRole("button", { name: "Show description" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Hide description" }),
      ).not.toBeInTheDocument();
    });
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
    renderWithMantine(
      <ToolDetailPanel
        {...baseProps}
        tool={simpleTool}
        formValues={{ message: "hi" }}
      />,
    );
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
        formValues={{ message: "hi" }}
        onExecute={onExecute}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Execute Tool" }));
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  // #2171: the panel opts its form into tool-argument type enforcement, so a
  // raw-JSON draft the client would retype is refused here rather than sent as
  // something other than what the editor showed.
  it("refuses a raw-JSON argument the schema would retype", async () => {
    const user = userEvent.setup();
    const numericTool: Tool = {
      name: "add",
      inputSchema: {
        type: "object",
        properties: { count: { type: "number" } },
      },
    };
    renderWithMantine(
      <ToolDetailPanel {...baseProps} tool={numericTool} formValues={{}} />,
    );
    await user.click(screen.getByLabelText("Edit as JSON"));
    await setAceTextByLabel(/Arguments JSON/, '{"count":"01"}');

    expect(
      screen.getByText(/`count` would be converted to the type/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Execute Tool" })).toBeDisabled();
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

    it("shows the toggle for a task-forbidden tool on a modern connection (#1631)", () => {
      // On modern (SEP-2663) task creation is server-directed, so any tool can
      // become a task — the toggle is offered regardless of per-tool taskSupport.
      renderWithMantine(
        <ToolDetailPanel
          {...baseProps}
          tool={toolWithSupport("forbidden")}
          serverSupportsTaskToolCalls={true}
          modernTasks={true}
          runAsTask={false}
        />,
      );
      const toggle = screen.getByLabelText("Run as task");
      expect(toggle).not.toBeChecked();
      expect(toggle).not.toBeDisabled();
    });

    it("routes the user's runAsTask choice on a modern connection (#1631)", async () => {
      const user = userEvent.setup();
      const onExecute = vi.fn();
      renderWithMantine(
        <ToolDetailPanel
          {...baseProps}
          tool={toolWithSupport("forbidden")}
          serverSupportsTaskToolCalls={true}
          modernTasks={true}
          runAsTask={true}
          onExecute={onExecute}
        />,
      );
      // The toggle is checked (user's choice), and executing forwards true.
      expect(screen.getByLabelText("Run as task")).toBeChecked();
      await user.click(screen.getByRole("button", { name: "Execute Tool" }));
      expect(onExecute).toHaveBeenCalledWith(true);
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

    it("gates onExecute to false when the server lacks task-tool-call support, even with a stale runAsTask", async () => {
      const user = userEvent.setup();
      const onExecute = vi.fn();
      // The toggle is hidden (server doesn't support it), but a leftover
      // runAsTask=true must not leak into the effective decision.
      renderWithMantine(
        <ToolDetailPanel
          {...baseProps}
          tool={toolWithSupport("optional")}
          serverSupportsTaskToolCalls={false}
          runAsTask={true}
          onExecute={onExecute}
        />,
      );
      expect(screen.queryByLabelText("Run as task")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Execute Tool" }));
      expect(onExecute).toHaveBeenCalledWith(false);
    });
  });

  describe("mirrored request headers (SEP-2243, #1632)", () => {
    const mirroredTool: Tool = {
      name: "get_weather",
      inputSchema: {
        type: "object",
        properties: {
          city: { type: "string", "x-mcp-header": "City" },
          country: { type: "string", "x-mcp-header": "Country" },
        },
      },
    };

    it("lists each mirrored arg and its Mcp-Param header", () => {
      renderWithMantine(<ToolDetailPanel {...baseProps} tool={mirroredTool} />);
      expect(
        screen.getByText("Mirrored request headers (SEP-2243)"),
      ).toBeInTheDocument();
      // The header names are unique to this section (the arg names `city` /
      // `country` also appear as form-field labels below).
      expect(screen.getByText("Mcp-Param-City")).toBeInTheDocument();
      expect(screen.getByText("Mcp-Param-Country")).toBeInTheDocument();
      // The arg path renders in a <code> alongside its header.
      expect(screen.getAllByText("city").length).toBeGreaterThanOrEqual(1);
    });

    it("omits the section for a tool without x-mcp-header annotations", () => {
      renderWithMantine(<ToolDetailPanel {...baseProps} tool={simpleTool} />);
      expect(
        screen.queryByText("Mirrored request headers (SEP-2243)"),
      ).not.toBeInTheDocument();
    });
  });

  describe("schema portability findings (#1005)", () => {
    const unportableTool: Tool = {
      name: "info",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: { data: true } },
    };

    // The findings address the server author but render above the argument
    // form the caller fills in, so they open collapsed behind their counts
    // (#2205). The preference is global, hence the cleared localStorage.
    beforeEach(() => {
      window.localStorage.clear();
    });

    it("summarizes the findings without unfurling them", () => {
      renderWithMantine(
        <ToolDetailPanel {...baseProps} tool={unportableTool} />,
      );
      expect(screen.getByText("Schema portability")).toBeVisible();
      expect(screen.getByText("1 error(s), 0 warning(s)")).toBeVisible();
      expect(
        screen.getByText("outputSchema.properties.data"),
      ).not.toBeVisible();
    });

    it("lists a finding with its path once expanded", async () => {
      const user = userEvent.setup();
      renderWithMantine(
        <ToolDetailPanel {...baseProps} tool={unportableTool} />,
      );

      await user.click(
        screen.getByRole("button", { name: /Schema portability/ }),
      );

      expect(screen.getByText("outputSchema.properties.data")).toBeVisible();
    });

    // Global rather than per tool: the panel is reused across selections, so a
    // per-tool disclosure would re-collapse on every click — the scrolling
    // #2205 is about, by another route.
    it("keeps the expanded choice across a tool switch", async () => {
      const user = userEvent.setup();
      const { rerender } = renderWithMantine(
        <ToolDetailPanel {...baseProps} tool={unportableTool} />,
      );

      await user.click(
        screen.getByRole("button", { name: /Schema portability/ }),
      );

      rerender(
        <ToolDetailPanel
          {...baseProps}
          tool={{ ...unportableTool, name: "other" }}
        />,
      );

      expect(
        screen.getByRole("button", { name: /Schema portability/ }),
      ).toHaveAttribute("aria-expanded", "true");
    });

    it("omits the section for a portable tool", () => {
      renderWithMantine(<ToolDetailPanel {...baseProps} tool={simpleTool} />);
      expect(screen.queryByTestId("schema-findings")).not.toBeInTheDocument();
    });
  });

  // #2020: Execute used to be gated on `isExecuting` alone — this panel never
  // called `hasMissingRequiredFields`, unlike the App and elicitation panels —
  // so arguments that could not be sent were executed anyway and simply arrived
  // absent at the server.
  describe("submit gating (#2020)", () => {
    const optionalJsonTool: Tool = {
      name: "record_shipment",
      inputSchema: {
        type: "object",
        // An array of no declared item type renders through the JSON editor,
        // which is where a draft can fail to parse.
        properties: { payload: { type: "array", title: "Payload" } },
      },
    };

    it("disables Execute while a required argument has no value", () => {
      renderWithMantine(
        <ToolDetailPanel {...baseProps} tool={simpleTool} formValues={{}} />,
      );
      expect(
        screen.getByRole("button", { name: "Execute Tool" }),
      ).toBeDisabled();
    });

    it("enables Execute once the required argument is filled", () => {
      renderWithMantine(
        <ToolDetailPanel
          {...baseProps}
          tool={simpleTool}
          formValues={{ message: "hi" }}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Execute Tool" }),
      ).not.toBeDisabled();
    });

    it("disables Execute while an optional field holds text it cannot send", async () => {
      renderWithMantine(
        <ToolDetailPanel {...baseProps} tool={optionalJsonTool} />,
      );
      const execute = screen.getByRole("button", { name: "Execute Tool" });
      expect(execute).not.toBeDisabled();

      // The draft never reaches `formValues` — the field reports `undefined`
      // for text it cannot parse — so only the form's validity channel makes
      // this visible to the gate.
      await setAceTextByLabel(/Payload/, "x");
      expect(execute).toBeDisabled();

      await setAceTextByLabel(/Payload/, "");
      expect(execute).not.toBeDisabled();
    });
  });
});
