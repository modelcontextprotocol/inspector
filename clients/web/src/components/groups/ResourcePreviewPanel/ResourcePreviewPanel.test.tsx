import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import type {
  BlobResourceContents,
  Resource,
  TextResourceContents,
} from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ResourcePreviewPanel } from "./ResourcePreviewPanel";

// Stub the lazy highlighter so JSON/XML/CSS branches render synchronously
// (its dynamic-import behavior is covered in CodeHighlight.test.tsx).
vi.mock("../../elements/CodeHighlight/CodeHighlight", () => ({
  CodeHighlight: ({ language, code }: { language: string; code: string }) => (
    <pre data-testid="code-highlight" data-language={language}>
      {code}
    </pre>
  ),
}));

const textResource: Resource = {
  name: "config.json",
  uri: "file:///config.json",
};

const textContents: TextResourceContents[] = [
  {
    uri: "file:///config.json",
    mimeType: "application/json",
    text: '{"a":1}',
  },
];

const imageBlob: BlobResourceContents = {
  uri: "file:///x.png",
  mimeType: "image/png",
  blob: "abc",
};

const audioBlob: BlobResourceContents = {
  uri: "file:///x.wav",
  mimeType: "audio/wav",
  blob: "abc",
};

const otherBlob: BlobResourceContents = {
  uri: "file:///x.bin",
  mimeType: "application/octet-stream",
  blob: "abc",
};

const blobNoMime: BlobResourceContents = {
  uri: "file:///x",
  blob: "abc",
};

const baseProps = {
  resource: textResource,
  contents: textContents,
  isSubscribed: false,
  onRefresh: vi.fn(),
  onSubscribe: vi.fn(),
  onUnsubscribe: vi.fn(),
};

describe("ResourcePreviewPanel", () => {
  it("renders the resource title and URI", () => {
    renderWithMantine(<ResourcePreviewPanel {...baseProps} />);
    expect(screen.getByText("Resource")).toBeInTheDocument();
    expect(screen.getByText("file:///config.json")).toBeInTheDocument();
  });

  it("renders the mimeType when contents has at most one item", () => {
    renderWithMantine(<ResourcePreviewPanel {...baseProps} />);
    expect(screen.getByText("application/json")).toBeInTheDocument();
  });

  it("does not render mimeType when there are multiple content items", () => {
    renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        contents={[textContents[0], textContents[0]]}
      />,
    );
    expect(screen.queryByText("application/json")).not.toBeInTheDocument();
  });

  it("renders the lastUpdated timestamp when provided", () => {
    renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        lastUpdated={new Date("2026-03-17T10:30:00Z")}
      />,
    );
    expect(screen.getByText(/^Last updated:/)).toBeInTheDocument();
  });

  it("renders Subscribe button when not subscribed and triggers onSubscribe", async () => {
    const user = userEvent.setup();
    const onSubscribe = vi.fn();
    renderWithMantine(
      <ResourcePreviewPanel {...baseProps} onSubscribe={onSubscribe} />,
    );
    await user.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(onSubscribe).toHaveBeenCalledTimes(1);
  });

  it("renders Unsubscribe button when subscribed and triggers onUnsubscribe", async () => {
    const user = userEvent.setup();
    const onUnsubscribe = vi.fn();
    renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        isSubscribed
        onUnsubscribe={onUnsubscribe}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect(onUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("hides the Subscribe button when subscriptionsSupported is false", () => {
    renderWithMantine(
      <ResourcePreviewPanel {...baseProps} subscriptionsSupported={false} />,
    );
    expect(
      screen.queryByRole("button", { name: "Subscribe" }),
    ).not.toBeInTheDocument();
    // Refresh stays available regardless of subscription support.
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("hides the Unsubscribe button when subscriptionsSupported is false even if subscribed", () => {
    renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        isSubscribed
        subscriptionsSupported={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Unsubscribe" }),
    ).not.toBeInTheDocument();
  });

  it("invokes onRefresh when Refresh is clicked", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    renderWithMantine(
      <ResourcePreviewPanel {...baseProps} onRefresh={onRefresh} />,
    );
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("renders annotation badges when present", () => {
    renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        resource={{
          ...textResource,
          annotations: { audience: ["user"], priority: 0.8 },
        }}
      />,
    );
    expect(screen.getByText("audience: user")).toBeInTheDocument();
    expect(screen.getByText("priority: high")).toBeInTheDocument();
  });

  it("renders an image content viewer for image blobs", () => {
    renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        resource={{ name: "img", uri: "file:///x.png" }}
        contents={[imageBlob]}
      />,
    );
    const img = screen
      .getAllByRole("img")
      .find((el) => el.getAttribute("src")?.startsWith("data:image/png"));
    expect(img).toBeDefined();
  });

  it("renders an audio element for audio blobs", () => {
    const { container } = renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        resource={{ name: "snd", uri: "file:///x.wav" }}
        contents={[audioBlob]}
      />,
    );
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
  });

  it("renders a textual unsupported message for non-image, non-audio blobs", () => {
    renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        resource={{ name: "bin", uri: "file:///x.bin" }}
        contents={[otherBlob]}
      />,
    );
    expect(
      screen.getByText(
        "[Binary content (application/octet-stream) — preview not supported]",
      ),
    ).toBeInTheDocument();
  });

  it("falls back to application/octet-stream when blob has no mimeType", () => {
    renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        resource={{ name: "bin", uri: "file:///x" }}
        contents={[blobNoMime]}
      />,
    );
    expect(screen.getByText("application/octet-stream")).toBeInTheDocument();
  });

  it("falls back to resource.mimeType when contents is empty", () => {
    renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        resource={{
          name: "x",
          uri: "file:///x",
          mimeType: "text/markdown",
        }}
        contents={[]}
      />,
    );
    expect(screen.getByText("text/markdown")).toBeInTheDocument();
  });

  it("renders text/markdown content as markdown", () => {
    renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        resource={{ name: "readme", uri: "file:///readme.md" }}
        contents={[
          {
            uri: "file:///readme.md",
            mimeType: "text/markdown",
            text: "# Hello",
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Hello" }),
    ).toBeInTheDocument();
  });

  it("infers markdown from a .md URI when mimeType is missing", () => {
    renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        resource={{ name: "notes", uri: "demo://resource/notes.md" }}
        contents={[
          {
            uri: "demo://resource/notes.md",
            text: "## From URI",
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "From URI" }),
    ).toBeInTheDocument();
  });

  it("renders a close button when onClose is provided and invokes it on click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithMantine(
      <ResourcePreviewPanel {...baseProps} onClose={onClose} />,
    );
    await user.click(screen.getByRole("button", { name: "Close preview" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render a close button when onClose is omitted", () => {
    renderWithMantine(<ResourcePreviewPanel {...baseProps} />);
    expect(
      screen.queryByRole("button", { name: "Close preview" }),
    ).not.toBeInTheDocument();
  });

  it("does not render plain-text content as markdown even with markdown-looking text", () => {
    renderWithMantine(
      <ResourcePreviewPanel
        {...baseProps}
        resource={{ name: "notes", uri: "file:///notes.txt" }}
        contents={[
          {
            uri: "file:///notes.txt",
            mimeType: "text/plain",
            text: "# not a heading",
          },
        ]}
      />,
    );
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText("# not a heading")).toBeInTheDocument();
  });

  describe("View Source toggle", () => {
    const markdownProps = {
      ...baseProps,
      resource: { name: "readme", uri: "file:///readme.md" },
      contents: [
        {
          uri: "file:///readme.md",
          mimeType: "text/markdown",
          text: "# Hello",
        },
      ],
    };

    it("toggles a markdown preview between rendered and raw source", async () => {
      const user = userEvent.setup();
      renderWithMantine(<ResourcePreviewPanel {...markdownProps} />);

      // Rendered by default: heading shown, no raw "# Hello" text.
      expect(
        screen.getByRole("heading", { level: 1, name: "Hello" }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "View Source" }));

      // Source mode: raw markdown text shown, heading gone, label flipped.
      expect(screen.getByText("# Hello")).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { level: 1 }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "View Rendered" }));

      // Back to rendered.
      expect(
        screen.getByRole("heading", { level: 1, name: "Hello" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "View Source" }),
      ).toBeInTheDocument();
    });

    it("reflects toggle state via aria-pressed", async () => {
      const user = userEvent.setup();
      renderWithMantine(<ResourcePreviewPanel {...markdownProps} />);
      expect(
        screen.getByRole("button", { name: "View Source" }),
      ).toHaveAttribute("aria-pressed", "false");
      await user.click(screen.getByRole("button", { name: "View Source" }));
      expect(
        screen.getByRole("button", { name: "View Rendered" }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    it("only switches source-toggleable items in a mixed multi-part resource", async () => {
      const user = userEvent.setup();
      renderWithMantine(
        <ResourcePreviewPanel
          {...baseProps}
          resource={{ name: "mix", uri: "file:///mix.md" }}
          contents={[
            { uri: "file:///mix.md", mimeType: "text/markdown", text: "# Hi" },
            { uri: "file:///mix.png", mimeType: "image/png", blob: "abc" },
          ]}
        />,
      );
      // Toggle gated on the first (markdown) item.
      await user.click(screen.getByRole("button", { name: "View Source" }));
      // Markdown switches to raw text...
      expect(screen.getByText("# Hi")).toBeInTheDocument();
      // ...but the image is not forced through the text decoder — it still
      // renders as an image rather than garbled bytes or a binary notice.
      const img = screen
        .getAllByRole("img")
        .find((el) => el.getAttribute("src")?.startsWith("data:image/png"));
      expect(img).toBeDefined();
    });

    it("offers the toggle for CSV resources", () => {
      renderWithMantine(
        <ResourcePreviewPanel
          {...baseProps}
          resource={{ name: "data", uri: "file:///data.csv" }}
          contents={[{ uri: "file:///data.csv", text: "a,b\n1,2" }]}
        />,
      );
      expect(
        screen.getByRole("button", { name: "View Source" }),
      ).toBeInTheDocument();
    });

    it("offers the toggle for HTML resources", () => {
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:url");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      renderWithMantine(
        <ResourcePreviewPanel
          {...baseProps}
          resource={{ name: "page", uri: "file:///page.html" }}
          contents={[{ uri: "file:///page.html", text: "<p>hi</p>" }]}
        />,
      );
      expect(
        screen.getByRole("button", { name: "View Source" }),
      ).toBeInTheDocument();
      vi.restoreAllMocks();
    });

    it("hides the toggle for non-toggleable kinds (JSON, plain text, image)", () => {
      const { rerender } = renderWithMantine(
        <ResourcePreviewPanel {...baseProps} />,
      );
      // JSON
      expect(
        screen.queryByRole("button", { name: "View Source" }),
      ).not.toBeInTheDocument();
      // Plain text
      rerender(
        <ResourcePreviewPanel
          {...baseProps}
          resource={{ name: "notes", uri: "file:///notes.txt" }}
          contents={[
            { uri: "file:///notes.txt", mimeType: "text/plain", text: "hi" },
          ]}
        />,
      );
      expect(
        screen.queryByRole("button", { name: "View Source" }),
      ).not.toBeInTheDocument();
    });

    it("resets to the rendered view when the resource changes", async () => {
      const user = userEvent.setup();
      const { rerender } = renderWithMantine(
        <ResourcePreviewPanel {...markdownProps} />,
      );
      await user.click(screen.getByRole("button", { name: "View Source" }));
      expect(
        screen.getByRole("button", { name: "View Rendered" }),
      ).toBeInTheDocument();

      // Switch to a different markdown resource — the toggle should reset.
      rerender(
        <ResourcePreviewPanel
          {...baseProps}
          resource={{ name: "other", uri: "file:///other.md" }}
          contents={[
            {
              uri: "file:///other.md",
              mimeType: "text/markdown",
              text: "# Two",
            },
          ]}
        />,
      );
      expect(
        screen.getByRole("button", { name: "View Source" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { level: 1, name: "Two" }),
      ).toBeInTheDocument();
    });
  });

  describe("URI-suffix MIME inference", () => {
    it("infers text/csv from a .csv URI and renders a table", () => {
      renderWithMantine(
        <ResourcePreviewPanel
          {...baseProps}
          resource={{ name: "data", uri: "file:///data.csv" }}
          contents={[{ uri: "file:///data.csv", text: "a,b\n1,2" }]}
        />,
      );
      expect(
        screen.getByRole("columnheader", { name: "a" }),
      ).toBeInTheDocument();
      expect(screen.getByText("text/csv")).toBeInTheDocument();
    });

    it("infers application/json from a .json URI and highlights", () => {
      renderWithMantine(
        <ResourcePreviewPanel
          {...baseProps}
          resource={{ name: "cfg", uri: "file:///cfg.json" }}
          contents={[{ uri: "file:///cfg.json", text: '{"a":1}' }]}
        />,
      );
      expect(screen.getByTestId("code-highlight")).toHaveAttribute(
        "data-language",
        "json",
      );
    });

    it("infers application/xml from a .xml URI and highlights", () => {
      renderWithMantine(
        <ResourcePreviewPanel
          {...baseProps}
          resource={{ name: "feed", uri: "file:///feed.xml" }}
          contents={[{ uri: "file:///feed.xml", text: "<a><b/></a>" }]}
        />,
      );
      expect(screen.getByTestId("code-highlight")).toHaveAttribute(
        "data-language",
        "xml",
      );
    });

    it("infers text/css from a .css URI and highlights", () => {
      renderWithMantine(
        <ResourcePreviewPanel
          {...baseProps}
          resource={{ name: "style", uri: "file:///style.css" }}
          contents={[{ uri: "file:///style.css", text: ".a{}" }]}
        />,
      );
      expect(screen.getByTestId("code-highlight")).toHaveAttribute(
        "data-language",
        "css",
      );
    });

    describe("blob-URL renderers", () => {
      beforeEach(() => {
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:url");
        vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      });

      afterEach(() => {
        vi.restoreAllMocks();
      });

      it("infers text/html from a .html URI and sandboxes it", () => {
        const { container } = renderWithMantine(
          <ResourcePreviewPanel
            {...baseProps}
            resource={{ name: "report", uri: "file:///report.html" }}
            contents={[{ uri: "file:///report.html", text: "<p>hi</p>" }]}
          />,
        );
        const iframe = container.querySelector("iframe");
        expect(iframe).toHaveAttribute("sandbox", "");
      });

      it("infers application/pdf from a .pdf URI and renders a viewer", () => {
        const { container } = renderWithMantine(
          <ResourcePreviewPanel
            {...baseProps}
            resource={{ name: "doc", uri: "file:///doc.pdf" }}
            contents={[
              {
                uri: "file:///doc.pdf",
                blob: Buffer.from("%PDF", "utf-8").toString("base64"),
              },
            ]}
          />,
        );
        const iframe = container.querySelector("iframe");
        expect(iframe).toHaveAttribute("src", "blob:url#view=FitH");
      });
    });
  });
});
