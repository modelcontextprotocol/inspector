import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type {
  CreateMessageRequestParams,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { SamplingRequestPanel } from "./SamplingRequestPanel";

const simpleRequest: CreateMessageRequestParams = {
  messages: [
    {
      role: "user",
      content: { type: "text", text: "What is the capital of France?" },
    },
  ],
  maxTokens: 1024,
};

const fullRequest: CreateMessageRequestParams = {
  messages: [
    {
      role: "user",
      content: { type: "text", text: "Write a haiku about programming." },
    },
  ],
  maxTokens: 2048,
  modelPreferences: {
    hints: [{ name: "claude-sonnet-4" }, { name: "gpt-4" }],
    costPriority: 0.2,
    speedPriority: 0.5,
    intelligencePriority: 0.9,
  },
  stopSequences: ["END"],
  temperature: 0.7,
  includeContext: "thisServer",
};

const blankDraft: CreateMessageResult = {
  role: "assistant",
  model: "claude-sonnet-4-20250514",
  content: { type: "text", text: "" },
};

const imageDraft: CreateMessageResult = {
  role: "assistant",
  model: "claude-sonnet-4-20250514",
  content: { type: "image", data: "abc", mimeType: "image/png" },
};

const baseProps = {
  onResultChange: vi.fn(),
  onAutoRespond: vi.fn(),
  onSend: vi.fn(),
  onReject: vi.fn(),
};

describe("SamplingRequestPanel", () => {
  it("renders the helper text and message section", () => {
    renderWithMantine(
      <SamplingRequestPanel
        {...baseProps}
        request={simpleRequest}
        draftResult={blankDraft}
      />,
    );
    expect(
      screen.getByText("The server is requesting an LLM completion."),
    ).toBeInTheDocument();
    expect(screen.getByText("Messages:")).toBeInTheDocument();
    expect(
      screen.getByText('"What is the capital of France?"'),
    ).toBeInTheDocument();
  });

  it("renders 'not specified' for missing optional params", () => {
    renderWithMantine(
      <SamplingRequestPanel
        {...baseProps}
        request={{ messages: [] } as never}
        draftResult={blankDraft}
      />,
    );
    expect(screen.getByText("Max Tokens: not specified")).toBeInTheDocument();
    expect(
      screen.getByText("Stop Sequences: not specified"),
    ).toBeInTheDocument();
    expect(screen.getByText("Temperature: not specified")).toBeInTheDocument();
  });

  it("renders model preferences with hints, priorities, and includeContext", () => {
    renderWithMantine(
      <SamplingRequestPanel
        {...baseProps}
        request={fullRequest}
        draftResult={blankDraft}
      />,
    );
    expect(screen.getByText("Model Preferences:")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4")).toBeInTheDocument();
    expect(screen.getByText("gpt-4")).toBeInTheDocument();
    expect(screen.getByText("Cost Priority: low (0.2)")).toBeInTheDocument();
    expect(
      screen.getByText("Speed Priority: medium (0.5)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Intelligence Priority: high (0.9)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Max Tokens: 2048")).toBeInTheDocument();
    expect(screen.getByText('Stop Sequences: ["END"]')).toBeInTheDocument();
    expect(screen.getByText("Temperature: 0.7")).toBeInTheDocument();
    expect(screen.getByText("Include Context:")).toBeInTheDocument();
    expect(screen.getByText("thisServer")).toBeInTheDocument();
  });

  it("does not render preferences container when modelPreferences is absent", () => {
    renderWithMantine(
      <SamplingRequestPanel
        {...baseProps}
        request={simpleRequest}
        draftResult={blankDraft}
      />,
    );
    expect(screen.queryByText("Model Preferences:")).not.toBeInTheDocument();
  });

  it("does not render Hints row when hints are absent", () => {
    renderWithMantine(
      <SamplingRequestPanel
        {...baseProps}
        request={{
          ...simpleRequest,
          modelPreferences: { costPriority: 0.5 },
        }}
        draftResult={blankDraft}
      />,
    );
    expect(screen.getByText("Model Preferences:")).toBeInTheDocument();
    expect(screen.queryByText("Hints:")).not.toBeInTheDocument();
  });

  it("renders the response textarea pre-populated for text drafts", () => {
    const filledDraft: CreateMessageResult = {
      ...blankDraft,
      content: { type: "text", text: "filled draft" },
    };
    renderWithMantine(
      <SamplingRequestPanel
        {...baseProps}
        request={simpleRequest}
        draftResult={filledDraft}
      />,
    );
    expect(screen.getByDisplayValue("filled draft")).toBeInTheDocument();
  });

  it("renders an empty textarea for non-text draft content", () => {
    renderWithMantine(
      <SamplingRequestPanel
        {...baseProps}
        request={simpleRequest}
        draftResult={imageDraft}
      />,
    );
    const textarea = screen.getByRole("textbox", {
      name: "",
    }) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
  });

  it("invokes onResultChange when typing into the response textarea", async () => {
    const user = userEvent.setup();
    const onResultChange = vi.fn();
    renderWithMantine(
      <SamplingRequestPanel
        {...baseProps}
        request={simpleRequest}
        draftResult={blankDraft}
        onResultChange={onResultChange}
      />,
    );
    const textareas = screen.getAllByRole("textbox");
    await user.type(textareas[0], "x");
    expect(onResultChange).toHaveBeenCalled();
    const last = onResultChange.mock.calls.at(-1)?.[0];
    expect(last.content).toEqual({ type: "text", text: "x" });
  });

  it("invokes onResultChange when typing into the model input", async () => {
    const user = userEvent.setup();
    const onResultChange = vi.fn();
    renderWithMantine(
      <SamplingRequestPanel
        {...baseProps}
        request={simpleRequest}
        draftResult={blankDraft}
        onResultChange={onResultChange}
      />,
    );
    await user.type(screen.getByLabelText("Model Used"), "x");
    expect(onResultChange).toHaveBeenCalled();
  });

  it("invokes onAutoRespond, onSend, and onReject when their buttons are clicked", async () => {
    const user = userEvent.setup();
    const onAutoRespond = vi.fn();
    const onSend = vi.fn();
    const onReject = vi.fn();
    renderWithMantine(
      <SamplingRequestPanel
        {...baseProps}
        request={simpleRequest}
        draftResult={blankDraft}
        onAutoRespond={onAutoRespond}
        onSend={onSend}
        onReject={onReject}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Auto-respond" }));
    await user.click(screen.getByRole("button", { name: "Send Response" }));
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(onAutoRespond).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("displays the existing stopReason in the Select", () => {
    renderWithMantine(
      <SamplingRequestPanel
        {...baseProps}
        request={simpleRequest}
        draftResult={{ ...blankDraft, stopReason: "endTurn" }}
      />,
    );
    const inputs = screen.getAllByDisplayValue("endTurn");
    expect(inputs.length).toBeGreaterThan(0);
  });
});
