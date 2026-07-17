import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { MessageEntry } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { MrtrConversation } from "./MrtrConversation";

function round(
  id: string,
  jsonRpcId: number,
  params: Record<string, unknown>,
  result: Record<string, unknown> | undefined,
  at: number,
): MessageEntry {
  return {
    id,
    timestamp: new Date(at),
    direction: "request",
    origin: "client",
    message: { jsonrpc: "2.0", id: jsonRpcId, method: "tools/call", params },
    response: result ? { jsonrpc: "2.0", id: jsonRpcId, result } : undefined,
  };
}

const original = round(
  "orig",
  1,
  { name: "book_flight" },
  { resultType: "input_required", requestState: "tok" },
  1000,
);
const retry = round(
  "retry",
  2,
  { name: "book_flight", requestState: "tok", inputResponses: {} },
  { resultType: "complete", content: [{ type: "text", text: "booked" }] },
  2000,
);

const baseProps = {
  requestState: "tok",
  pinnedIds: new Set<string>(),
  isListExpanded: true,
  onReplay: vi.fn(),
  onTogglePin: vi.fn(),
};

describe("MrtrConversation", () => {
  it("renders the method, an MRTR label, and the round count", () => {
    renderWithMantine(
      <MrtrConversation {...baseProps} rounds={[original, retry]} />,
    );
    // The header carries a method badge; each round also carries one, so the
    // method appears more than once — the MRTR label and count are unique.
    expect(screen.getAllByText("tools/call").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("MRTR")).toBeInTheDocument();
    expect(screen.getByText("2 rounds")).toBeInTheDocument();
  });

  it("singularizes a one-round conversation", () => {
    renderWithMantine(<MrtrConversation {...baseProps} rounds={[original]} />);
    expect(screen.getByText("1 round")).toBeInTheDocument();
  });

  it("derives Complete status from the final round", () => {
    renderWithMantine(
      <MrtrConversation {...baseProps} rounds={[original, retry]} />,
    );
    expect(screen.getByTestId("mrtr-status")).toHaveTextContent("Complete");
  });

  it("shows Awaiting input when the final round is still input_required", () => {
    renderWithMantine(<MrtrConversation {...baseProps} rounds={[original]} />);
    expect(screen.getByTestId("mrtr-status")).toHaveTextContent(
      "Awaiting input",
    );
  });

  it("shows Error when the final round failed", () => {
    const failed: MessageEntry = {
      id: "err",
      timestamp: new Date(3000),
      direction: "request",
      origin: "client",
      message: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { requestState: "tok" },
      },
      response: {
        jsonrpc: "2.0",
        id: 3,
        error: { code: -32602, message: "bad" },
      },
    };
    renderWithMantine(
      <MrtrConversation {...baseProps} rounds={[original, failed]} />,
    );
    expect(screen.getByTestId("mrtr-status")).toHaveTextContent("Error");
  });

  it("shows Pending when the final round has no response yet", () => {
    const pending = round("p", 4, { requestState: "tok" }, undefined, 4000);
    renderWithMantine(
      <MrtrConversation {...baseProps} rounds={[original, pending]} />,
    );
    expect(screen.getByTestId("mrtr-status")).toHaveTextContent("Pending");
  });

  it("labels each round in chronological order regardless of input order", () => {
    // Pass the rounds newest-first (as a newest-first list sort would); the
    // conversation still reads original (Round 1) → retry (Round 2).
    renderWithMantine(
      <MrtrConversation {...baseProps} rounds={[retry, original]} />,
    );
    const round1 = screen.getByText("Round 1");
    const round2 = screen.getByText("Round 2");
    expect(round1).toBeInTheDocument();
    expect(round2).toBeInTheDocument();
    // Round 1 appears before Round 2 in the DOM.
    expect(
      round1.compareDocumentPosition(round2) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("collapses and expands the rounds", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <MrtrConversation
        {...baseProps}
        rounds={[original, retry]}
        isListExpanded={false}
      />,
    );
    const toggle = screen.getByRole("button", {
      name: "Expand MRTR conversation",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(
      screen.getByRole("button", { name: "Collapse MRTR conversation" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("forwards per-round pin toggles by entry id", async () => {
    const user = userEvent.setup();
    const onTogglePin = vi.fn();
    renderWithMantine(
      <MrtrConversation
        {...baseProps}
        rounds={[original, retry]}
        onTogglePin={onTogglePin}
      />,
    );
    // Each round has its own Pin control; clicking the first pins "orig".
    const pinButtons = screen.getAllByRole("button", { name: "Pin" });
    await user.click(pinButtons[0]);
    expect(onTogglePin).toHaveBeenCalledWith("orig");
  });
});
