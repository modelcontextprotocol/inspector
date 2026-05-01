import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { PromptListItem } from "./PromptListItem";

const prompt: Prompt = {
  name: "summarize",
  description: "Summarize a document",
};

describe("PromptListItem", () => {
  it("renders the prompt name", () => {
    renderWithMantine(
      <PromptListItem prompt={prompt} selected={false} onClick={() => {}} />,
    );
    expect(screen.getByText("summarize")).toBeInTheDocument();
    expect(screen.getByText("Summarize a document")).toBeInTheDocument();
  });

  it("prefers title over name when present", () => {
    renderWithMantine(
      <PromptListItem
        prompt={{ ...prompt, title: "Summarize" }}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("Summarize")).toBeInTheDocument();
  });

  it("omits the description when none is set", () => {
    renderWithMantine(
      <PromptListItem
        prompt={{ name: "x" }}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.queryByText("Summarize a document")).not.toBeInTheDocument();
  });

  it("invokes onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithMantine(
      <PromptListItem prompt={prompt} selected={false} onClick={onClick} />,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders selected state", () => {
    renderWithMantine(
      <PromptListItem prompt={prompt} selected onClick={() => {}} />,
    );
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
