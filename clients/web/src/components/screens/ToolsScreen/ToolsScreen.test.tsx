import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Tool } from "@modelcontextprotocol/client";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import {
  ToolsScreen,
  type ToolsScreenProps,
  type ToolsUiState,
} from "./ToolsScreen";
import { EMPTY_TOOLS_UI } from "../screenUiState";

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
  {
    name: "delta",
    inputSchema: { type: "object" },
    execution: { taskSupport: "optional" },
  },
];

const baseProps = {
  tools,
  listChanged: false,
  serverSupportsTaskToolCalls: false,
  ui: EMPTY_TOOLS_UI,
  onUiChange: vi.fn(),
  onRefreshList: vi.fn(),
  onCallTool: vi.fn(),
};

// ToolsScreen is controlled: selection + form values live in the parent (App)
// as one `ui` object so they persist across tab navigation (#1414). This host
// holds that state so clicking a tool drives the detail panel, mirroring how
// App owns it. Props passed in override defaults; the stateful `ui` wiring is
// applied last so callers can still observe selections via the rendered state.
function ControlledToolsScreen(props: Partial<ToolsScreenProps>) {
  const [ui, setUi] = useState<ToolsUiState>({
    ...EMPTY_TOOLS_UI,
    ...props.ui,
  });
  return (
    <ToolsScreen
      {...baseProps}
      {...props}
      ui={ui}
      onUiChange={(next) => {
        setUi(next);
        props.onUiChange?.(next);
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
    // There is no separate results placeholder pane anymore (#1661) — results
    // replace the input form in the single content pane when they exist.
    expect(screen.queryByText("Results will appear here")).toBeNull();
  });

  it("shows the detail panel when a tool is selected", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledToolsScreen />);
    await user.click(screen.getByText("alpha"));
    expect(
      screen.queryByText("Select a tool to view details"),
    ).not.toBeInTheDocument();
  });

  it("filters the sidebar list as the search text changes", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledToolsScreen />);
    expect(screen.getByText("beta")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Search tools..."), "alpha");
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
  });

  it("carries edited form values through to Execute", async () => {
    const user = userEvent.setup();
    const onCallTool = vi.fn();
    renderWithMantine(<ControlledToolsScreen onCallTool={onCallTool} />);
    await user.click(screen.getByText("gamma"));
    // gamma seeds { mode: "fast" }; editing the field flows through onUiChange.
    const field = screen.getByLabelText(/mode/i);
    await user.clear(field);
    await user.type(field, "slow");
    await user.click(screen.getByRole("button", { name: /Execute/ }));
    expect(onCallTool).toHaveBeenCalledWith("gamma", { mode: "slow" }, false);
  });

  it("shows the result in place of the form when a selected tool has a result", () => {
    // App owns selection + result, so a remount after a tab switch re-renders
    // with both still set. The result replaces the input form in the single
    // content pane (#1661): the Execute button is gone while the result shows.
    renderWithMantine(
      <ToolsScreen
        {...baseProps}
        ui={{ ...EMPTY_TOOLS_UI, selectedToolName: "alpha" }}
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
    // The input form is hidden while the result is shown.
    expect(screen.queryByRole("button", { name: /Execute/ })).toBeNull();
  });

  it("returns to the input form when the result is dismissed", async () => {
    // App owns both `ui` and `callState`; this host mirrors that so dismissing
    // the result (onClearResult → callState cleared) flips the single content
    // pane back to the input form, with the selection (and thus the form)
    // preserved for a re-run (#1661).
    function Host() {
      const [ui, setUi] = useState<ToolsUiState>({
        ...EMPTY_TOOLS_UI,
        selectedToolName: "alpha",
      });
      const [callState, setCallState] = useState<ToolsScreenProps["callState"]>(
        {
          status: "ok",
          result: { content: [{ type: "text", text: "ok" }] },
        },
      );
      return (
        <ToolsScreen
          {...baseProps}
          ui={ui}
          onUiChange={setUi}
          callState={callState}
          onClearResult={() => setCallState(undefined)}
        />
      );
    }
    const user = userEvent.setup();
    renderWithMantine(<Host />);
    // A result is present, so the result pane shows and the form is hidden.
    expect(screen.getByText("Results")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Execute/ })).toBeNull();
    // Dismissing the result flips back to the input form (Execute reappears).
    await user.click(screen.getByRole("button", { name: "Close results" }));
    expect(
      await screen.findByRole("button", { name: /Execute/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Results")).toBeNull();
  });

  it("renders a content-sized result card for a plain text result", () => {
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
    // No links → the result card is NOT flex-filled (sizes to content).
    const card = screen.getByText("Results").closest(".mantine-Card-root");
    expect(card).not.toHaveStyle({ flex: "1" });
  });

  it("fills the result card with a Resource Links box when the result has links", () => {
    // A resource_link result takes the full-height (`flex={1}`) card branch so
    // the Resource Links box can grow and scroll within.
    renderWithMantine(
      <ToolsScreen
        {...baseProps}
        callState={{
          status: "ok",
          result: {
            content: [
              { type: "resource_link", uri: "demo://r/1", name: "Linked" },
            ],
          },
        }}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Resource Links" }),
    ).toBeInTheDocument();
    // Links → the result card fills the pane (`flex: 1`), distinguishing this
    // branch from the content-sized text-result card above.
    const card = screen.getByText("Results").closest(".mantine-Card-root");
    expect(card).toHaveStyle({ flex: "1" });
  });

  it("invokes onCallTool with form values on Execute", async () => {
    const user = userEvent.setup();
    const onCallTool = vi.fn();
    renderWithMantine(<ControlledToolsScreen onCallTool={onCallTool} />);
    await user.click(screen.getByText("alpha"));
    await user.click(screen.getByRole("button", { name: /Execute/ }));
    expect(onCallTool).toHaveBeenCalledWith("alpha", {}, false);
  });

  it("seeds schema defaults so untouched fields are sent on Execute", async () => {
    const user = userEvent.setup();
    const onCallTool = vi.fn();
    renderWithMantine(<ControlledToolsScreen onCallTool={onCallTool} />);
    await user.click(screen.getByText("gamma"));
    // Execute without editing the form: the default must still be sent.
    await user.click(screen.getByRole("button", { name: /Execute/ }));
    expect(onCallTool).toHaveBeenCalledWith("gamma", { mode: "fast" }, false);
  });

  it("invokes onClearResult when the result close button is clicked", async () => {
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
    await user.click(screen.getByRole("button", { name: "Close results" }));
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
        ui={{ ...EMPTY_TOOLS_UI, selectedToolName: "alpha" }}
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
        ui={{ ...EMPTY_TOOLS_UI, selectedToolName: "alpha" }}
        onCancelCall={onCancelCall}
        callState={{ status: "pending" }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(onCancelCall).toHaveBeenCalledTimes(1);
  });

  it("threads the Run-as-task toggle through onUiChange", async () => {
    const user = userEvent.setup();
    const onUiChange = vi.fn();
    renderWithMantine(
      <ControlledToolsScreen
        serverSupportsTaskToolCalls
        onUiChange={onUiChange}
      />,
    );
    // delta advertises optional task support, so the switch renders.
    await user.click(screen.getByText("delta"));
    await user.click(screen.getByLabelText("Run as task"));
    expect(onUiChange).toHaveBeenCalled();
    const last = onUiChange.mock.calls.at(-1)?.[0] as ToolsUiState;
    expect(last.runAsTask).toBe(true);
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
    await user.click(screen.getByRole("button", { name: "Close results" }));
    expect(screen.getByText("Results")).toBeInTheDocument();
  });
});
