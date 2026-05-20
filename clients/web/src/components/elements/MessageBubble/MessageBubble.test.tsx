import { describe, it, expect } from "vitest";
import type {
  PromptMessage,
  SamplingMessage,
} from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { MessageBubble } from "./MessageBubble";

describe("MessageBubble", () => {
  it("renders a text sampling message as markdown", () => {
    const message: SamplingMessage = {
      role: "user",
      content: { type: "text", text: "hello" },
    };
    renderWithMantine(<MessageBubble index={0} message={message} />);
    expect(screen.getByText("[0] role: user")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("renders markdown formatting in prompt text", () => {
    const message: PromptMessage = {
      role: "assistant",
      content: { type: "text", text: "# Heading\n\nSome **bold** text" },
    };
    renderWithMantine(<MessageBubble index={0} message={message} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Heading" }),
    ).toBeInTheDocument();
    expect(screen.getByText("bold")).toBeInTheDocument();
  });

  it("renders a copy button for text content via ContentViewer copyable", () => {
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

  it("renders embedded resource text from a prompt message", () => {
    const message: PromptMessage = {
      role: "user",
      content: {
        type: "resource",
        resource: { uri: "file:///x", text: "embedded" },
      },
    };
    renderWithMantine(<MessageBubble index={3} message={message} />);
    expect(screen.getByText("embedded")).toBeInTheDocument();
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
    expect(screen.getByText("[blob: file:///b]")).toBeInTheDocument();
  });

  it("renders resource_link content", () => {
    const message = {
      role: "user",
      content: { type: "resource_link", uri: "ui://app", name: "Cool App" },
    } as unknown as PromptMessage;
    renderWithMantine(<MessageBubble index={5} message={message} />);
    expect(screen.getByText("Cool App")).toBeInTheDocument();
  });

  it("still renders the role label for unknown content types", () => {
    const message = {
      role: "user",
      content: { type: "weird" },
    } as unknown as SamplingMessage;
    renderWithMantine(<MessageBubble index={6} message={message} />);
    // ContentViewer returns null for unknown block types; the bubble's
    // role-label header still renders so the message isn't invisible.
    expect(screen.getByText("[6] role: user")).toBeInTheDocument();
  });

  it("renders multiple content blocks from an array", () => {
    const message: PromptMessage = {
      role: "user",
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ] as unknown as PromptMessage["content"],
    };
    renderWithMantine(<MessageBubble index={7} message={message} />);
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
  });
});
