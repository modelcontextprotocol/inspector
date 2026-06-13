import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import type {
  CreateMessageRequestParams,
  ElicitRequestFormParams,
} from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import {
  PendingClientRequestModal,
  type PendingClientRequestContent,
} from "./PendingClientRequestModal";

const samplingRequest: CreateMessageRequestParams = {
  messages: [
    {
      role: "user",
      content: { type: "text", text: "What is the capital of France?" },
    },
  ],
  maxTokens: 1024,
};

const formRequest: ElicitRequestFormParams = {
  message: "Please provide your name.",
  requestedSchema: {
    type: "object",
    properties: { name: { type: "string", title: "Name" } },
  },
};

const samplingContent: PendingClientRequestContent = {
  kind: "sampling",
  id: "sampling-1",
  request: samplingRequest,
};

const formContent: PendingClientRequestContent = {
  kind: "elicitation-form",
  id: "elicitation-1",
  request: formRequest,
};

const urlContent: PendingClientRequestContent = {
  kind: "elicitation-url",
  id: "elicitation-2",
  message: "Authorize access in your browser.",
  url: "https://example.com/authorize",
};

const baseProps = {
  serverName: "Everything Server",
  queuePosition: "1 of 1",
  onSamplingRespond: vi.fn(),
  onSamplingReject: vi.fn(),
  onElicitationRespond: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PendingClientRequestModal", () => {
  it("renders nothing when there is no active request", () => {
    renderWithMantine(
      <PendingClientRequestModal {...baseProps} request={null} />,
    );
    expect(screen.queryByText("Sampling Request")).not.toBeInTheDocument();
    expect(screen.queryByText("Elicitation Request")).not.toBeInTheDocument();
  });

  it("renders the sampling title, queue position, and panel", () => {
    renderWithMantine(
      <PendingClientRequestModal {...baseProps} request={samplingContent} />,
    );
    expect(screen.getByText("Sampling Request")).toBeInTheDocument();
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
    expect(
      screen.getByText("The server is requesting an LLM completion."),
    ).toBeInTheDocument();
  });

  it("sends the default stub sampling result when the draft is untouched", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <PendingClientRequestModal {...baseProps} request={samplingContent} />,
    );
    await user.click(screen.getByRole("button", { name: "Send Response" }));
    expect(baseProps.onSamplingRespond).toHaveBeenCalledWith({
      model: "stub-model",
      stopReason: "endTurn",
      role: "assistant",
      content: { type: "text", text: "" },
    });
  });

  it("sends the edited sampling draft", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <PendingClientRequestModal {...baseProps} request={samplingContent} />,
    );
    const textarea = screen
      .getAllByRole("textbox")
      .find((el) => el.tagName === "TEXTAREA") as HTMLTextAreaElement;
    await user.type(textarea, "Paris");
    await user.click(screen.getByRole("button", { name: "Send Response" }));
    expect(baseProps.onSamplingRespond).toHaveBeenCalledWith(
      expect.objectContaining({
        content: { type: "text", text: "Paris" },
      }),
    );
  });

  it("rejects the sampling request", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <PendingClientRequestModal {...baseProps} request={samplingContent} />,
    );
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(baseProps.onSamplingReject).toHaveBeenCalledTimes(1);
  });

  it("resolves a request only once when the action is double-clicked", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <PendingClientRequestModal {...baseProps} request={samplingContent} />,
    );
    const sendResponse = screen.getByRole("button", { name: "Send Response" });
    await user.click(sendResponse);
    // After the first dispatch the actions lock (busy); a second click no-ops.
    await user.click(sendResponse);
    expect(baseProps.onSamplingRespond).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Send Response" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
  });

  it("renders the elicitation form with the server name warning", () => {
    renderWithMantine(
      <PendingClientRequestModal {...baseProps} request={formContent} />,
    );
    expect(screen.getByText("Elicitation Request")).toBeInTheDocument();
    expect(screen.getByText(/Please provide your name/)).toBeInTheDocument();
    expect(screen.getByText(/Everything Server/)).toBeInTheDocument();
  });

  it("accepts a form elicitation on submit", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <PendingClientRequestModal {...baseProps} request={formContent} />,
    );
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(baseProps.onElicitationRespond).toHaveBeenCalledWith({
      action: "accept",
      content: {},
    });
  });

  it("includes untouched schema defaults in the submitted content", async () => {
    const user = userEvent.setup();
    const formWithDefaults: PendingClientRequestContent = {
      kind: "elicitation-form",
      id: "elicitation-defaults",
      request: {
        message: "Confirm your preferences.",
        requestedSchema: {
          type: "object",
          properties: {
            firstLine: {
              type: "string",
              title: "First line",
              default: "It was a dark and stormy night.",
            },
            integer: { type: "integer", title: "Integer", default: 42 },
            name: { type: "string", title: "Name" },
          },
        },
      },
    };
    renderWithMantine(
      <PendingClientRequestModal {...baseProps} request={formWithDefaults} />,
    );
    // Submit without touching any field: the default-only fields must still be
    // sent (the v1-parity bug this guards against dropped them).
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(baseProps.onElicitationRespond).toHaveBeenCalledWith({
      action: "accept",
      content: {
        firstLine: "It was a dark and stormy night.",
        integer: 42,
      },
    });
  });

  it("declines a form elicitation", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <PendingClientRequestModal {...baseProps} request={formContent} />,
    );
    await user.click(screen.getByRole("button", { name: "Decline" }));
    expect(baseProps.onElicitationRespond).toHaveBeenCalledWith({
      action: "decline",
    });
  });

  it("cancels a form elicitation", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <PendingClientRequestModal {...baseProps} request={formContent} />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(baseProps.onElicitationRespond).toHaveBeenCalledWith({
      action: "cancel",
    });
  });

  it("opens the URL into a waiting state without resolving the elicitation", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    renderWithMantine(
      <PendingClientRequestModal {...baseProps} request={urlContent} />,
    );
    // Before opening there is no completion action.
    expect(
      screen.queryByRole("button", { name: "I've completed it" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open in Browser" }));
    expect(openSpy).toHaveBeenCalledWith(
      "https://example.com/authorize",
      "_blank",
      "noopener,noreferrer",
    );
    // Opening alone must not resolve the elicitation; it only reveals the
    // explicit completion step.
    expect(baseProps.onElicitationRespond).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "I've completed it" }),
    ).toBeInTheDocument();
    openSpy.mockRestore();
  });

  it("accepts a URL elicitation only after the user confirms completion", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    renderWithMantine(
      <PendingClientRequestModal {...baseProps} request={urlContent} />,
    );
    await user.click(screen.getByRole("button", { name: "Open in Browser" }));
    await user.click(screen.getByRole("button", { name: "I've completed it" }));
    expect(baseProps.onElicitationRespond).toHaveBeenCalledWith({
      action: "accept",
    });
    openSpy.mockRestore();
  });

  it("copies the URL to the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderWithMantine(
      <PendingClientRequestModal {...baseProps} request={urlContent} />,
    );
    await user.click(screen.getByRole("button", { name: "Copy URL" }));
    expect(writeText).toHaveBeenCalledWith("https://example.com/authorize");
  });

  it("reveals the completion step after Copy URL so a copy-paste flow can accept", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    renderWithMantine(
      <PendingClientRequestModal {...baseProps} request={urlContent} />,
    );
    // Before copying there is no completion action.
    expect(
      screen.queryByRole("button", { name: "I've completed it" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy URL" }));
    await user.click(screen.getByRole("button", { name: "I've completed it" }));
    expect(baseProps.onElicitationRespond).toHaveBeenCalledWith({
      action: "accept",
    });
  });

  it("cancels a URL elicitation after opening without sending accept", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    renderWithMantine(
      <PendingClientRequestModal {...baseProps} request={urlContent} />,
    );
    await user.click(screen.getByRole("button", { name: "Open in Browser" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(baseProps.onElicitationRespond).toHaveBeenCalledTimes(1);
    expect(baseProps.onElicitationRespond).toHaveBeenCalledWith({
      action: "cancel",
    });
    openSpy.mockRestore();
  });
});
