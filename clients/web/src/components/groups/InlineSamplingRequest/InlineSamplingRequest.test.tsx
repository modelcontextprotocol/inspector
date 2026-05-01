import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type {
  CreateMessageRequestParams,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { InlineSamplingRequest } from "./InlineSamplingRequest";

const textRequest: CreateMessageRequestParams = {
  messages: [
    {
      role: "user",
      content: { type: "text", text: "Please analyze this code." },
    },
  ],
  maxTokens: 1024,
};

const arrayContentRequest: CreateMessageRequestParams = {
  messages: [
    {
      role: "user",
      content: [
        // Note: SamplingMessage content is a single block, but the component
        // also handles arrays defensively. Cast to satisfy types in tests.
        { type: "text", text: "from array" },
      ] as unknown as CreateMessageRequestParams["messages"][number]["content"],
    },
  ],
  maxTokens: 1024,
};

const nonTextSingleRequest: CreateMessageRequestParams = {
  messages: [
    {
      role: "user",
      content: {
        type: "image",
        data: "abc",
        mimeType: "image/png",
      },
    },
  ],
  maxTokens: 1024,
};

const emptyRequest: CreateMessageRequestParams = {
  messages: [],
  maxTokens: 1024,
};

const textDraft: CreateMessageResult = {
  role: "assistant",
  model: "claude-sonnet-4-20250514",
  content: { type: "text", text: "draft response" },
};

const imageDraft: CreateMessageResult = {
  role: "assistant",
  model: "claude-sonnet-4-20250514",
  content: { type: "image", data: "abc", mimeType: "image/png" },
};

const audioDraft: CreateMessageResult = {
  role: "assistant",
  model: "claude-sonnet-4-20250514",
  content: { type: "audio", data: "abc", mimeType: "audio/wav" },
};

const baseProps = {
  queuePosition: "1 of 1",
  onAutoRespond: vi.fn(),
  onEditAndSend: vi.fn(),
  onReject: vi.fn(),
  onViewDetails: vi.fn(),
};

describe("InlineSamplingRequest", () => {
  it("renders the badge, queue position, and message preview", () => {
    renderWithMantine(
      <InlineSamplingRequest {...baseProps} request={textRequest} />,
    );
    expect(screen.getByText("sampling/createMessage")).toBeInTheDocument();
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
    expect(screen.getByText("Please analyze this code.")).toBeInTheDocument();
  });

  it("renders model hints when provided", () => {
    renderWithMantine(
      <InlineSamplingRequest
        {...baseProps}
        request={{
          ...textRequest,
          modelPreferences: {
            hints: [{ name: "claude-opus" }, { name: "claude-sonnet" }],
          },
        }}
      />,
    );
    expect(
      screen.getByText("Model hints: claude-opus, claude-sonnet"),
    ).toBeInTheDocument();
  });

  it("does not render hints when none are present", () => {
    renderWithMantine(
      <InlineSamplingRequest {...baseProps} request={textRequest} />,
    );
    expect(screen.queryByText(/^Model hints:/)).not.toBeInTheDocument();
  });

  it("does not render hints when hints array is empty", () => {
    renderWithMantine(
      <InlineSamplingRequest
        {...baseProps}
        request={{
          ...textRequest,
          modelPreferences: { hints: [] },
        }}
      />,
    );
    expect(screen.queryByText(/^Model hints:/)).not.toBeInTheDocument();
  });

  it("renders the text draft preview when a text draft result is provided", () => {
    renderWithMantine(
      <InlineSamplingRequest
        {...baseProps}
        request={textRequest}
        draftResult={textDraft}
      />,
    );
    expect(screen.getByText("draft response")).toBeInTheDocument();
  });

  it("renders the image draft preview when an image draft result is provided", () => {
    renderWithMantine(
      <InlineSamplingRequest
        {...baseProps}
        request={textRequest}
        draftResult={imageDraft}
      />,
    );
    expect(screen.getByText("[Image content]")).toBeInTheDocument();
  });

  it("renders the audio draft preview when an audio draft result is provided", () => {
    renderWithMantine(
      <InlineSamplingRequest
        {...baseProps}
        request={textRequest}
        draftResult={audioDraft}
      />,
    );
    expect(screen.getByText("[Audio content]")).toBeInTheDocument();
  });

  it("handles requests with array-shaped content", () => {
    renderWithMantine(
      <InlineSamplingRequest {...baseProps} request={arrayContentRequest} />,
    );
    expect(screen.getByText("from array")).toBeInTheDocument();
  });

  it("renders a non-text content type label for non-text single-content messages", () => {
    renderWithMantine(
      <InlineSamplingRequest {...baseProps} request={nonTextSingleRequest} />,
    );
    expect(screen.getByText("[image]")).toBeInTheDocument();
  });

  it("handles requests with no messages", () => {
    renderWithMantine(
      <InlineSamplingRequest {...baseProps} request={emptyRequest} />,
    );
    expect(screen.getByText("sampling/createMessage")).toBeInTheDocument();
  });

  it("invokes onViewDetails when View Details is clicked", async () => {
    const user = userEvent.setup();
    const onViewDetails = vi.fn();
    renderWithMantine(
      <InlineSamplingRequest
        {...baseProps}
        request={textRequest}
        onViewDetails={onViewDetails}
      />,
    );
    await user.click(screen.getByRole("button", { name: "View Details" }));
    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });

  it("invokes onAutoRespond, onEditAndSend, and onReject when their buttons are clicked", async () => {
    const user = userEvent.setup();
    const onAutoRespond = vi.fn();
    const onEditAndSend = vi.fn();
    const onReject = vi.fn();
    renderWithMantine(
      <InlineSamplingRequest
        {...baseProps}
        request={textRequest}
        onAutoRespond={onAutoRespond}
        onEditAndSend={onEditAndSend}
        onReject={onReject}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Auto-respond" }));
    await user.click(screen.getByRole("button", { name: /Edit.*Send/ }));
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(onAutoRespond).toHaveBeenCalledTimes(1);
    expect(onEditAndSend).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
  });
});
