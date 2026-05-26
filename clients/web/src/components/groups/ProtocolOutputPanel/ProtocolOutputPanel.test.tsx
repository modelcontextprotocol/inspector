import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ProtocolOutputPanel } from "./ProtocolOutputPanel";

function makeProps(
  overrides: Partial<React.ComponentProps<typeof ProtocolOutputPanel>> = {},
) {
  return {
    protocol: "!Search.?SearchResult.end",
    pythonSnippet: "from llmsessioncontract import Monitor",
    copied: null as "dsl" | "python" | null,
    onCopyDsl: vi.fn(),
    onCopyPython: vi.fn(),
    onDownload: vi.fn(),
    ...overrides,
  };
}

describe("ProtocolOutputPanel", () => {
  it("renders the DSL, FSM preview, and Python snippet", () => {
    renderWithMantine(<ProtocolOutputPanel {...makeProps()} />);
    expect(screen.getByText("Session Type DSL")).toBeInTheDocument();
    expect(screen.getByText("State Machine Preview")).toBeInTheDocument();
    expect(screen.getByText("Python Integration")).toBeInTheDocument();
    expect(
      screen.getByText("from llmsessioncontract import Monitor"),
    ).toBeInTheDocument();
  });

  it("invokes the copy callbacks when Copy buttons are clicked", async () => {
    const onCopyDsl = vi.fn();
    const onCopyPython = vi.fn();
    renderWithMantine(
      <ProtocolOutputPanel {...makeProps({ onCopyDsl, onCopyPython })} />,
    );
    const user = userEvent.setup();
    const copyButtons = screen.getAllByRole("button", { name: /^Copy$/ });
    await user.click(copyButtons[0]);
    await user.click(copyButtons[1]);
    expect(onCopyDsl).toHaveBeenCalled();
    expect(onCopyPython).toHaveBeenCalled();
  });

  it("shows 'Copied!' on the DSL button when copied is 'dsl'", () => {
    renderWithMantine(
      <ProtocolOutputPanel {...makeProps({ copied: "dsl" })} />,
    );
    const buttons = screen.getAllByRole("button");
    const labels = buttons.map((b) => b.textContent ?? "");
    expect(labels).toContain("Copied!");
  });

  it("shows 'Copied!' on the Python button when copied is 'python'", () => {
    renderWithMantine(
      <ProtocolOutputPanel {...makeProps({ copied: "python" })} />,
    );
    const buttons = screen.getAllByRole("button");
    const labels = buttons.map((b) => b.textContent ?? "");
    expect(labels).toContain("Copied!");
  });

  it("invokes onDownload when the download button is clicked", async () => {
    const onDownload = vi.fn();
    renderWithMantine(<ProtocolOutputPanel {...makeProps({ onDownload })} />);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /Download Python File/ }),
    );
    expect(onDownload).toHaveBeenCalled();
  });

  it("renders the empty FSM hint for an empty protocol", () => {
    renderWithMantine(
      <ProtocolOutputPanel {...makeProps({ protocol: "end" })} />,
    );
    expect(
      screen.getByText("Add steps to see the state machine"),
    ).toBeInTheDocument();
  });

  it("renders FSM transitions for a non-trivial protocol", () => {
    renderWithMantine(
      <ProtocolOutputPanel
        {...makeProps({ protocol: "!{Yes.!Done.end, No.end}" })}
      />,
    );
    // The choice fans out into two outgoing edges, both rendered as pills
    expect(screen.getAllByText(/!Yes|!No/).length).toBeGreaterThan(0);
  });

  it("renders a loop transition for recursion", () => {
    renderWithMantine(
      <ProtocolOutputPanel
        {...makeProps({ protocol: "rec X.!Ping.?Pong.X" })}
      />,
    );
    expect(screen.getByText(/↻X/)).toBeInTheDocument();
  });

  it("highlights protocol tokens by category", () => {
    renderWithMantine(
      <ProtocolOutputPanel {...makeProps({ protocol: "rec X.!A.?B.X.end" })} />,
    );
    expect(screen.getAllByText("rec").length).toBeGreaterThan(0);
    expect(screen.getByText("end")).toBeInTheDocument();
    expect(screen.getAllByText("!").length).toBeGreaterThan(0);
    expect(screen.getAllByText("?").length).toBeGreaterThan(0);
  });

  it("highlights spaces and other characters without crashing", () => {
    renderWithMantine(
      <ProtocolOutputPanel {...makeProps({ protocol: "!{Yes, No}.end" })} />,
    );
    expect(screen.getByText("end")).toBeInTheDocument();
  });
});
