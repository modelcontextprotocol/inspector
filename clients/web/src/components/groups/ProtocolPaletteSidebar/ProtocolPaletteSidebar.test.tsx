import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ProtocolPaletteSidebar } from "./ProtocolPaletteSidebar";

const tools: Tool[] = [
  { name: "search", inputSchema: { type: "object" } },
  { name: "book", inputSchema: { type: "object" } },
];

function makeProps(
  overrides: Partial<React.ComponentProps<typeof ProtocolPaletteSidebar>> = {},
) {
  return {
    tools,
    recVars: [],
    listChanged: false,
    targetTerminated: false,
    targetLabel: null,
    onRefreshTools: vi.fn(),
    onClearTarget: vi.fn(),
    onAddTool: vi.fn(),
    onAddPair: vi.fn(),
    onAddInternalChoice: vi.fn(),
    onAddExternalChoice: vi.fn(),
    onAddRecursion: vi.fn(),
    onAddRecRef: vi.fn(),
    ...overrides,
  };
}

describe("ProtocolPaletteSidebar", () => {
  it("renders the empty state and offers a List Tools button", async () => {
    const onRefreshTools = vi.fn();
    renderWithMantine(
      <ProtocolPaletteSidebar {...makeProps({ tools: [], onRefreshTools })} />,
    );
    expect(screen.getByText("No tools discovered yet")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "List Tools" }));
    expect(onRefreshTools).toHaveBeenCalled();
  });

  it("invokes onAddTool when a tool button is clicked", async () => {
    const onAddTool = vi.fn();
    renderWithMantine(<ProtocolPaletteSidebar {...makeProps({ onAddTool })} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /search/ }));
    expect(onAddTool).toHaveBeenCalledWith(tools[0]);
  });

  it("invokes the construct callbacks", async () => {
    const onAddPair = vi.fn();
    const onAddInternalChoice = vi.fn();
    const onAddExternalChoice = vi.fn();
    const onAddRecursion = vi.fn();
    renderWithMantine(
      <ProtocolPaletteSidebar
        {...makeProps({
          onAddPair,
          onAddInternalChoice,
          onAddExternalChoice,
          onAddRecursion,
        })}
      />,
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /Send \/ Receive Pair/ }),
    );
    await user.click(screen.getByRole("button", { name: /Internal Choice/ }));
    await user.click(screen.getByRole("button", { name: /External Choice/ }));
    await user.click(screen.getByRole("button", { name: /Recursion/ }));
    expect(onAddPair).toHaveBeenCalled();
    expect(onAddInternalChoice).toHaveBeenCalled();
    expect(onAddExternalChoice).toHaveBeenCalled();
    expect(onAddRecursion).toHaveBeenCalled();
  });

  it("renders loop-back buttons for each rec var and fires onAddRecRef", async () => {
    const onAddRecRef = vi.fn();
    renderWithMantine(
      <ProtocolPaletteSidebar
        {...makeProps({ recVars: ["X", "Y"], onAddRecRef })}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Loop back to X/ }));
    await user.click(screen.getByRole("button", { name: /Loop back to Y/ }));
    expect(onAddRecRef).toHaveBeenNthCalledWith(1, "X");
    expect(onAddRecRef).toHaveBeenNthCalledWith(2, "Y");
  });

  it("disables tool and construct buttons when targetTerminated is true", () => {
    renderWithMantine(
      <ProtocolPaletteSidebar {...makeProps({ targetTerminated: true })} />,
    );
    const toolBtn = screen.getByRole("button", { name: /search/ });
    expect(toolBtn).toBeDisabled();
    const pairBtn = screen.getByRole("button", {
      name: /Send \/ Receive Pair/,
    });
    expect(pairBtn).toBeDisabled();
  });

  it("renders the insert-target banner and clears it on click", async () => {
    const onClearTarget = vi.fn();
    renderWithMantine(
      <ProtocolPaletteSidebar
        {...makeProps({ targetLabel: "BranchA", onClearTarget })}
      />,
    );
    expect(screen.getByText("BranchA")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Clear insert target" }),
    );
    expect(onClearTarget).toHaveBeenCalled();
  });

  it("renders the list-changed indicator when listChanged is true", () => {
    renderWithMantine(
      <ProtocolPaletteSidebar {...makeProps({ listChanged: true })} />,
    );
    expect(screen.getByText("List updated")).toBeInTheDocument();
  });
});
