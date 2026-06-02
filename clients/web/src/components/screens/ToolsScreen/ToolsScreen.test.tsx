import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ToolsScreen, type ToolsScreenProps } from "./ToolsScreen";

const tools: Tool[] = [
  { name: "alpha", inputSchema: { type: "object" } },
  { name: "beta", inputSchema: { type: "object" } },
  {
    name: "gamma",
    inputSchema: {
      type: "object",
      properties: { mode: { type: "string", default: "fast" } },
    },
  },
];

const baseProps = {
  tools,
  listChanged: false,
  onSelectTool: vi.fn(),
  onFormChange: vi.fn(),
  onRefreshList: vi.fn(),
  onCallTool: vi.fn(),
};

// ToolsScreen is controlled: selection + form values live in the parent (App)
// so they persist across tab navigation (#1414). This host holds that state so
// clicking a tool drives the detail panel, mirroring how App owns it. Props
// passed in override defaults; the stateful selection/form wiring is applied
// last so callers can still observe selections via the spied callbacks.
function ControlledToolsScreen(props: Partial<ToolsScreenProps>) {
  const [selectedToolName, setSelectedToolName] = useState<string | undefined>(
    props.selectedToolName,
  );
  const [formValues, setFormValues] = useState<Record<string, unknown>>(
    props.formValues ?? {},
  );
  return (
    <ToolsScreen
      {...baseProps}
      {...props}
      selectedToolName={selectedToolName}
      formValues={formValues}
      onSelectTool={(name) => {
        setSelectedToolName(name);
        props.onSelectTool?.(name);
      }}
      onFormChange={(values) => {
        setFormValues(values);
        props.onFormChange?.(values);
      }}
    />
  );
}

describe("ToolsScreen", () => {
  it("renders the empty selection state", () => {
    renderWithMantine(<ToolsScreen {...baseProps} />);
    expect(
      screen.getByText("Select a tool to view details"),
    ).toBeInTheDocument();
    expect(screen.getByText("Results will appear here")).toBeInTheDocument();
  });

  it("shows the detail panel when a tool is selected", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledToolsScreen />);
    await user.click(screen.getByText("alpha"));
    expect(
      screen.queryByText("Select a tool to view details"),
    ).not.toBeInTheDocument();
  });

  it("renders selection and result from props (persisted across navigation)", () => {
    // App owns selection + result, so a remount after a tab switch re-renders
    // with both still set — the detail and result panels show without any
    // local re-selection.
    renderWithMantine(
      <ToolsScreen
        {...baseProps}
        selectedToolName="alpha"
        callState={{
          status: "ok",
          result: { content: [{ type: "text", text: "ok" }] },
        }}
      />,
    );
    expect(
      screen.queryByText("Select a tool to view details"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Results")).toBeInTheDocument();
  });

  it("renders the result panel when callState has a result", () => {
    renderWithMantine(
      <ToolsScreen
        {...baseProps}
        callState={{
          status: "ok",
          result: { content: [{ type: "text", text: "ok" }] },
        }}
      />,
    );
    expect(screen.getByText("Results")).toBeInTheDocument();
  });

  it("invokes onCallTool with form values on Execute", async () => {
    const user = userEvent.setup();
    const onCallTool = vi.fn();
    renderWithMantine(<ControlledToolsScreen onCallTool={onCallTool} />);
    await user.click(screen.getByText("alpha"));
    await user.click(screen.getByRole("button", { name: /Execute/ }));
    expect(onCallTool).toHaveBeenCalledWith("alpha", {});
  });

  it("seeds schema defaults so untouched fields are sent on Execute", async () => {
    const user = userEvent.setup();
    const onCallTool = vi.fn();
    renderWithMantine(<ControlledToolsScreen onCallTool={onCallTool} />);
    await user.click(screen.getByText("gamma"));
    // Execute without editing the form: the default must still be sent.
    await user.click(screen.getByRole("button", { name: /Execute/ }));
    expect(onCallTool).toHaveBeenCalledWith("gamma", { mode: "fast" });
  });

  it("invokes onClearResult when Clear is clicked on the result panel", async () => {
    const user = userEvent.setup();
    const onClearResult = vi.fn();
    renderWithMantine(
      <ToolsScreen
        {...baseProps}
        onClearResult={onClearResult}
        callState={{
          status: "ok",
          result: { content: [{ type: "text", text: "ok" }] },
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClearResult).toHaveBeenCalledTimes(1);
  });

  it("does not clear the result when the screen unmounts", () => {
    // The result is owned by App and must survive a tab switch (which unmounts
    // the screen), so unmounting must NOT call onClearResult — see #1414.
    const onClearResult = vi.fn();
    const { unmount } = renderWithMantine(
      <ToolsScreen
        {...baseProps}
        onClearResult={onClearResult}
        callState={{
          status: "ok",
          result: { content: [{ type: "text", text: "ok" }] },
        }}
      />,
    );
    unmount();
    expect(onClearResult).not.toHaveBeenCalled();
  });

  it("treats pending callState as executing", () => {
    renderWithMantine(
      <ToolsScreen
        {...baseProps}
        selectedToolName="alpha"
        callState={{ status: "pending" }}
      />,
    );
    expect(screen.getByRole("button", { name: /Cancel/ })).toBeInTheDocument();
  });

  it("invokes onCancelCall when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onCancelCall = vi.fn();
    renderWithMantine(
      <ToolsScreen
        {...baseProps}
        selectedToolName="alpha"
        onCancelCall={onCancelCall}
        callState={{ status: "pending" }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(onCancelCall).toHaveBeenCalledTimes(1);
  });

  it("does not crash when onClearResult/onCancelCall are undefined", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ToolsScreen
        {...baseProps}
        onCancelCall={undefined}
        onClearResult={undefined}
        callState={{
          status: "ok",
          result: { content: [{ type: "text", text: "ok" }] },
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("Results")).toBeInTheDocument();
  });
});
