import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  BlobResourceContents,
  ContentBlock,
  TextResourceContents,
} from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ContentViewer } from "./ContentViewer";

// Stub the lazy highlighter so JSON/XML/CSS branches are assertable
// synchronously (its real dynamic-import behavior is covered in
// CodeHighlight.test.tsx).
vi.mock("../CodeHighlight/CodeHighlight", () => ({
  CodeHighlight: ({ language, code }: { language: string; code: string }) => (
    <pre data-testid="code-highlight" data-language={language}>
      {code}
    </pre>
  ),
}));

const toBase64 = (text: string): string =>
  Buffer.from(text, "utf-8").toString("base64");

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

  it("renders a resource_link statically (no expand control)", () => {
    const block: ContentBlock = {
      type: "resource_link",
      uri: "ui://app",
      name: "Cool App",
      description: "An app",
      mimeType: "text/html",
    };
    renderWithMantine(<ContentViewer block={block} />);
    expect(screen.getByText("Cool App")).toBeInTheDocument();
    expect(screen.getByText("An app")).toBeInTheDocument();
    expect(screen.getByText("text/html")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing for unknown block types", () => {
    renderWithMantine(<ContentViewer block={{ type: "unknown" } as never} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders plain text in a wrapping code block by default", () => {
    const block: ContentBlock = { type: "text", text: "some long command" };
    const { container } = renderWithMantine(<ContentViewer block={block} />);
    expect(container.querySelector(".mantine-Code-root")).toHaveAttribute(
      "data-variant",
      "wrapping",
    );
  });

  it("renders plain text in a non-wrapping code block when wrap is false", () => {
    const block: ContentBlock = { type: "text", text: "some long command" };
    const { container } = renderWithMantine(
      <ContentViewer block={block} wrap={false} />,
    );
    const code = container.querySelector(".mantine-Code-root");
    expect(code).toHaveAttribute("data-variant", "nowrap");
    // Full value exposed on hover since it may be clipped with an ellipsis.
    expect(code).toHaveAttribute("title", "some long command");
  });

  it("does not set a title tooltip when wrapping (default)", () => {
    const block: ContentBlock = { type: "text", text: "some long command" };
    const { container } = renderWithMantine(<ContentViewer block={block} />);
    expect(container.querySelector(".mantine-Code-root")).not.toHaveAttribute(
      "title",
    );
  });

  it("renders text as markdown when mimeType is text/markdown", () => {
    const block: ContentBlock = {
      type: "text",
      text: "# Title\n\nSome **bold** text.",
    };
    renderWithMantine(<ContentViewer block={block} mimeType="text/markdown" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Title" }),
    ).toBeInTheDocument();
    expect(screen.getByText("bold")).toBeInTheDocument();
  });

  it("accepts mimeType with parameters (e.g. text/markdown; charset=utf-8)", () => {
    const block: ContentBlock = { type: "text", text: "# Heading" };
    renderWithMantine(
      <ContentViewer block={block} mimeType="text/markdown; charset=utf-8" />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Heading" }),
    ).toBeInTheDocument();
  });

  it("falls back to code rendering for non-markdown mime types", () => {
    const block: ContentBlock = { type: "text", text: "# not markdown" };
    renderWithMantine(<ContentViewer block={block} mimeType="text/plain" />);
    expect(screen.getByText("# not markdown")).toBeInTheDocument();
    // No <h1> generated by react-markdown
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("renders a copy overlay for markdown content when copyable", () => {
    const block: ContentBlock = { type: "text", text: "# hi" };
    renderWithMantine(
      <ContentViewer block={block} mimeType="text/markdown" copyable />,
    );
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("highlights a JSON text block when mimeType is application/json", () => {
    const block: ContentBlock = { type: "text", text: '{"a":1}' };
    renderWithMantine(
      <ContentViewer block={block} mimeType="application/json" />,
    );
    const probe = screen.getByTestId("code-highlight");
    expect(probe).toHaveAttribute("data-language", "json");
    expect(probe.textContent).toContain('"a": 1');
  });

  it("renders nothing when neither block nor contents is provided", () => {
    const { container } = renderWithMantine(<ContentViewer />);
    // MantineProvider injects a <style> node; assert no actual content renders.
    expect(
      container.querySelector("pre, img, table, iframe, audio, code"),
    ).toBeNull();
  });

  describe("markdown anchor allowlist", () => {
    it("keeps safe-scheme anchors as links", () => {
      const block: ContentBlock = {
        type: "text",
        text: "[ok](https://example.com)",
      };
      renderWithMantine(
        <ContentViewer block={block} mimeType="text/markdown" />,
      );
      expect(screen.getByRole("link", { name: "ok" })).toHaveAttribute(
        "href",
        "https://example.com",
      );
    });

    it("downgrades protocol-relative anchors to inert text", () => {
      const block: ContentBlock = {
        type: "text",
        text: "[bad](//evil.com)",
      };
      renderWithMantine(
        <ContentViewer block={block} mimeType="text/markdown" />,
      );
      expect(
        screen.queryByRole("link", { name: "bad" }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("bad")).toBeInTheDocument();
    });
  });
});

describe("ContentViewer (resource contents)", () => {
  const text = (
    over: Partial<TextResourceContents> & { text: string },
  ): TextResourceContents => ({ uri: "file:///r", ...over });
  const blob = (
    over: Partial<BlobResourceContents> & { blob: string },
  ): BlobResourceContents => ({ uri: "file:///r", ...over });

  it("renders markdown from text contents", () => {
    renderWithMantine(
      <ContentViewer
        contents={text({ text: "# Title", mimeType: "text/markdown" })}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Title" }),
    ).toBeInTheDocument();
  });

  it("highlights JSON contents", () => {
    renderWithMantine(
      <ContentViewer
        contents={text({ text: '{"a":1}', mimeType: "application/json" })}
      />,
    );
    const probe = screen.getByTestId("code-highlight");
    expect(probe).toHaveAttribute("data-language", "json");
    expect(probe.textContent).toContain('"a": 1');
  });

  it("indents and highlights XML contents", () => {
    renderWithMantine(
      <ContentViewer
        contents={text({
          text: "<a><b>x</b></a>",
          mimeType: "application/xml",
        })}
      />,
    );
    const probe = screen.getByTestId("code-highlight");
    expect(probe).toHaveAttribute("data-language", "xml");
    expect(probe.textContent).toBe("<a>\n  <b>x</b>\n</a>");
  });

  it("highlights CSS contents", () => {
    renderWithMantine(
      <ContentViewer contents={text({ text: ".a{}", mimeType: "text/css" })} />,
    );
    expect(screen.getByTestId("code-highlight")).toHaveAttribute(
      "data-language",
      "css",
    );
  });

  it("renders CSV contents as a table", () => {
    renderWithMantine(
      <ContentViewer
        contents={text({ text: "name,age\nAlice,30", mimeType: "text/csv" })}
      />,
    );
    expect(
      screen.getByRole("columnheader", { name: "name" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Alice" })).toBeInTheDocument();
  });

  it("renders plain text contents in a code block", () => {
    renderWithMantine(
      <ContentViewer
        contents={text({ text: "just text", mimeType: "text/plain" })}
      />,
    );
    expect(screen.getByText("just text")).toBeInTheDocument();
  });

  it("decodes a blob delivered for a textual MIME", () => {
    renderWithMantine(
      <ContentViewer
        contents={blob({
          blob: toBase64("name,age\nBob,25"),
          mimeType: "text/csv",
        })}
      />,
    );
    expect(screen.getByRole("cell", { name: "Bob" })).toBeInTheDocument();
  });

  it("shows the binary fallback when a textual blob fails to decode", () => {
    // Malformed base64 for a textual MIME would throw in `atob` during render;
    // the panel must degrade to the binary notice instead of crashing.
    renderWithMantine(
      <ContentViewer
        contents={blob({ blob: "not%%base64", mimeType: "text/csv" })}
      />,
    );
    expect(
      screen.getByText("[Binary content (text/csv) — preview not supported]"),
    ).toBeInTheDocument();
  });

  it("renders an image blob as a data URI", () => {
    renderWithMantine(
      <ContentViewer
        contents={blob({ blob: "AAAA", mimeType: "image/png" })}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "data:image/png;base64,AAAA",
    );
  });

  it("renders an audio blob as a data URI", () => {
    const { container } = renderWithMantine(
      <ContentViewer
        contents={blob({ blob: "BBBB", mimeType: "audio/mp3" })}
      />,
    );
    expect(container.querySelector("source")).toHaveAttribute(
      "src",
      "data:audio/mp3;base64,BBBB",
    );
  });

  it("shows the binary fallback for unsupported MIME types", () => {
    renderWithMantine(
      <ContentViewer
        contents={blob({ blob: "AAAA", mimeType: "application/zip" })}
      />,
    );
    expect(
      screen.getByText(
        "[Binary content (application/zip) — preview not supported]",
      ),
    ).toBeInTheDocument();
  });

  it("falls back to application/octet-stream when no MIME is known", () => {
    renderWithMantine(<ContentViewer contents={blob({ blob: "AAAA" })} />);
    expect(
      screen.getByText(
        "[Binary content (application/octet-stream) — preview not supported]",
      ),
    ).toBeInTheDocument();
  });

  it("prefers an explicit mimeType prop over the contents mimeType", () => {
    renderWithMantine(
      <ContentViewer
        contents={text({ text: "# Heading", mimeType: "text/plain" })}
        mimeType="text/markdown"
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Heading" }),
    ).toBeInTheDocument();
  });

  describe("blob-URL renderers", () => {
    beforeEach(() => {
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:url");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("renders a PDF blob in an iframe", () => {
      const { container } = renderWithMantine(
        <ContentViewer
          contents={blob({
            blob: toBase64("%PDF"),
            mimeType: "application/pdf",
          })}
        />,
      );
      const iframe = container.querySelector("iframe");
      expect(iframe).toHaveAttribute("src", "blob:url#view=FitH");
      expect(iframe).toHaveAttribute("title", "PDF preview");
    });

    it("renders an HTML resource in a sandboxed iframe", () => {
      const { container } = renderWithMantine(
        <ContentViewer
          contents={text({ text: "<p>hi</p>", mimeType: "text/html" })}
        />,
      );
      const iframe = container.querySelector("iframe");
      expect(iframe).toHaveAttribute("sandbox", "");
      expect(iframe).toHaveAttribute("src", "blob:url");
    });
  });
});
