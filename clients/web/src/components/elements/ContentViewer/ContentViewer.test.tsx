import { describe, it, expect } from "vitest";
import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ContentViewer } from "./ContentViewer";

describe("ContentViewer", () => {
  it("renders text content as-is when not JSON", () => {
    const block: ContentBlock = { type: "text", text: "hello world" };
    renderWithMantine(<ContentViewer block={block} />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("pretty-prints JSON text", () => {
    const block: ContentBlock = { type: "text", text: '{"a":1}' };
    renderWithMantine(<ContentViewer block={block} />);
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument();
  });

  it("falls back to raw text when JSON is malformed", () => {
    const block: ContentBlock = { type: "text", text: "{ broken" };
    renderWithMantine(<ContentViewer block={block} />);
    expect(screen.getByText("{ broken")).toBeInTheDocument();
  });

  it("renders a copy overlay when copyable", () => {
    const block: ContentBlock = { type: "text", text: "hello" };
    renderWithMantine(<ContentViewer block={block} copyable />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("does not render a copy overlay by default", () => {
    const block: ContentBlock = { type: "text", text: "hello" };
    renderWithMantine(<ContentViewer block={block} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders an image block", () => {
    const block: ContentBlock = {
      type: "image",
      mimeType: "image/png",
      data: "AAAA",
    };
    renderWithMantine(<ContentViewer block={block} />);
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "data:image/png;base64,AAAA",
    );
  });

  it("renders an audio block", () => {
    const block: ContentBlock = {
      type: "audio",
      mimeType: "audio/mp3",
      data: "BBBB",
    };
    const { container } = renderWithMantine(<ContentViewer block={block} />);
    const source = container.querySelector("source");
    expect(source).toHaveAttribute("src", "data:audio/mp3;base64,BBBB");
  });

  it("renders a text resource block", () => {
    const block: ContentBlock = {
      type: "resource",
      resource: { uri: "file:///foo", text: "embedded text" },
    };
    renderWithMantine(<ContentViewer block={block} />);
    expect(screen.getByText("embedded text")).toBeInTheDocument();
  });

  it("renders a blob resource block with placeholder", () => {
    const block: ContentBlock = {
      type: "resource",
      resource: {
        uri: "file:///bar",
        blob: "abc",
        mimeType: "application/octet-stream",
      },
    };
    renderWithMantine(<ContentViewer block={block} />);
    expect(screen.getByText("[blob: file:///bar]")).toBeInTheDocument();
  });

  it("renders a resource_link with name", () => {
    const block: ContentBlock = {
      type: "resource_link",
      uri: "ui://app",
      name: "Cool App",
    };
    renderWithMantine(<ContentViewer block={block} />);
    expect(screen.getByText("Cool App")).toBeInTheDocument();
  });

  it("falls back to URI when resource_link has no name", () => {
    const block = {
      type: "resource_link",
      uri: "ui://app",
    } as unknown as ContentBlock;
    renderWithMantine(<ContentViewer block={block} />);
    expect(screen.getByText("ui://app")).toBeInTheDocument();
  });

  it("renders nothing for unknown block types", () => {
    renderWithMantine(<ContentViewer block={{ type: "unknown" } as never} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
