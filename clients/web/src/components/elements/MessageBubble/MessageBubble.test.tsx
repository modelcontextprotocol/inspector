import { describe, it, expect } from "vitest";
import type {
  PromptMessage,
  SamplingMessage,
} from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { MessageBubble } from "./MessageBubble";

describe("MessageBubble", () => {
  it("renders a text sampling message", () => {
    const message: SamplingMessage = {
      role: "user",
      content: { type: "text", text: "hello" },
    };
    renderWithMantine(<MessageBubble index={0} message={message} />);
    expect(screen.getByText("[0] role: user")).toBeInTheDocument();
    expect(screen.getByText('"hello"')).toBeInTheDocument();
  });

  it("renders a copy button when there is text", () => {
    const message: SamplingMessage = {
      role: "user",
      content: { type: "text", text: "hello" },
    };
    renderWithMantine(<MessageBubble index={0} message={message} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("renders an image content block", () => {
    const message: SamplingMessage = {
      role: "user",
      content: { type: "image", mimeType: "image/png", data: "AAA" },
    };
    renderWithMantine(<MessageBubble index={1} message={message} />);
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "data:image/png;base64,AAA",
    );
  });

  it("renders an audio content block", () => {
    const message: SamplingMessage = {
      role: "assistant",
      content: { type: "audio", mimeType: "audio/mp3", data: "BBB" },
    };
    const { container } = renderWithMantine(
      <MessageBubble index={2} message={message} />,
    );
    expect(container.querySelector("source")).toHaveAttribute(
      "src",
      "data:audio/mp3;base64,BBB",
    );
  });

  it("renders embedded resource text from a prompt message array", () => {
    const message: PromptMessage = {
      role: "user",
      content: {
        type: "resource",
        resource: { uri: "file:///x", text: "embedded" },
      },
    };
    renderWithMantine(<MessageBubble index={3} message={message} />);
    expect(screen.getByText('"embedded"')).toBeInTheDocument();
  });

  it("renders blob resource placeholder", () => {
    const message: PromptMessage = {
      role: "user",
      content: {
        type: "resource",
        resource: {
          uri: "file:///b",
          blob: "abc",
          mimeType: "application/octet-stream",
        },
      },
    };
    renderWithMantine(<MessageBubble index={4} message={message} />);
    expect(screen.getByText('"[resource: file:///b]"')).toBeInTheDocument();
  });

  it("renders resource_link content", () => {
    const message = {
      role: "user",
      content: { type: "resource_link", uri: "ui://app" },
    } as unknown as PromptMessage;
    renderWithMantine(<MessageBubble index={5} message={message} />);
    expect(screen.getByText('"[resource: ui://app]"')).toBeInTheDocument();
  });

  it("renders fallback for unknown content types", () => {
    const message = {
      role: "user",
      content: { type: "weird" },
    } as unknown as SamplingMessage;
    renderWithMantine(<MessageBubble index={6} message={message} />);
    expect(screen.getByText('"[weird]"')).toBeInTheDocument();
  });
});
