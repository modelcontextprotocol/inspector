import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { PromptMessage } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { PromptMessagesDisplay } from "./PromptMessagesDisplay";

const messages: PromptMessage[] = [
  { role: "user", content: { type: "text", text: "hello" } },
  { role: "assistant", content: { type: "text", text: "hi there" } },
];

describe("PromptMessagesDisplay", () => {
  it("renders the empty state when there are no messages", () => {
    renderWithMantine(<PromptMessagesDisplay messages={[]} />);
    expect(screen.getByText("No messages to display")).toBeInTheDocument();
  });

  it("renders all messages with role labels", () => {
    renderWithMantine(<PromptMessagesDisplay messages={messages} />);
    expect(screen.getByText("[0] role: user")).toBeInTheDocument();
    expect(screen.getByText("[1] role: assistant")).toBeInTheDocument();
  });

  it("hides Copy All when no callback is provided", () => {
    renderWithMantine(<PromptMessagesDisplay messages={messages} />);
    expect(
      screen.queryByRole("button", { name: "Copy All" }),
    ).not.toBeInTheDocument();
  });

  it("hides Copy All when there are no messages even with the callback", () => {
    renderWithMantine(
      <PromptMessagesDisplay messages={[]} onCopyAll={() => {}} />,
    );
    expect(
      screen.queryByRole("button", { name: "Copy All" }),
    ).not.toBeInTheDocument();
  });

  it("invokes onCopyAll when Copy All is clicked", async () => {
    const user = userEvent.setup();
    const onCopyAll = vi.fn();
    renderWithMantine(
      <PromptMessagesDisplay messages={messages} onCopyAll={onCopyAll} />,
    );
    await user.click(screen.getByRole("button", { name: "Copy All" }));
    expect(onCopyAll).toHaveBeenCalledTimes(1);
  });
});
