import { Code, Flex, Image, Stack } from "@mantine/core";
import type { ReactNode } from "react";
import type {
  BlobResourceContents,
  ContentBlock,
  TextResourceContents,
} from "@modelcontextprotocol/sdk/types.js";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeHighlight } from "../CodeHighlight/CodeHighlight";
import { CopyButton } from "../CopyButton/CopyButton";
import { ResourceLinkInfo } from "../ResourceLinkInfo/ResourceLinkInfo";
import {
  formatJson,
  formatXml,
  getMimeKind,
  isSafeHref,
  isTextualKind,
  looksLikeJson,
  tryDecodeBase64ToUtf8,
} from "./contentViewerUtils";
import { BinaryNotice } from "./BinaryNotice";
import { CsvTable } from "./CsvTable";
import { HtmlFrame } from "./HtmlFrame";
import { PdfFrame } from "./PdfFrame";

export interface ContentViewerProps {
  /**
   * A content block to render (tool results, prompt messages, server cards, …).
   * Provide either `block` or `contents`.
   */
  block?: ContentBlock;
  /**
   * Raw resource contents (Resources screen). When provided, the per-MIME
   * dispatch keys off `mimeType` and the base64 `blob` / `text`, covering
   * PDF / CSV / HTML / XML / CSS in addition to the content-block cases.
   * Provide either `block` or `contents`.
   */
  contents?: TextResourceContents | BlobResourceContents;
  copyable?: boolean;
  /**
   * Effective MIME type for the content. Drives the per-MIME renderer dispatch
   * (markdown, JSON, XML, CSS, CSV, HTML, PDF). When absent, text falls back to
   * a JSON-shape heuristic then plain preformatted code.
   */
  mimeType?: string;
  /**
   * Whether long plain-text content wraps onto multiple lines. When `false`,
   * text is kept to a single line (overflow clipped with an ellipsis) so the
   * viewer keeps a fixed height — used by hosts like the server card where the
   * box height must stay constant regardless of command/URL length. The full
   * value remains available via the copy button (and a native `title`
   * tooltip). Defaults to `true`.
   *
   * Intended for single-line values only: `false` applies `white-space:
   * nowrap`, which collapses embedded newlines (e.g. pretty-printed JSON) onto
   * one line — don't pass it for multi-line content.
   */
  wrap?: boolean;
}

function buildDataUri(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`;
}

const ContentWrapper = Flex.withProps({
  pos: "relative",
  direction: "column",
});

const CopyOverlay = Flex.withProps({
  pos: "absolute",
  top: 4,
  right: 4,
});

const MarkdownWrapper = Flex.withProps({
  className: "markdown-content",
  direction: "column",
});

const PreviewImage = Image.withProps({
  alt: "Content preview",
  maw: 400,
  radius: "md",
});

// Markdown anchors are constrained to a safe-scheme allowlist: a non-matching
// href (e.g. `javascript:`, protocol-relative `//evil.com`) renders as inert
// text so user-supplied markdown can't smuggle a script-bearing link.
const SafeAnchor: Components["a"] = ({ href, children }) =>
  isSafeHref(href) ? <a href={href}>{children}</a> : <span>{children}</span>;

const markdownComponents: Components = { a: SafeAnchor };

function CopyableWrapper({
  copyable,
  copyValue,
  children,
}: {
  copyable: boolean;
  copyValue: string;
  children: ReactNode;
}) {
  return (
    <Stack gap="xs">
      <ContentWrapper>
        {children}
        {copyable && (
          <CopyOverlay>
            <CopyButton value={copyValue} />
          </CopyOverlay>
        )}
      </ContentWrapper>
    </Stack>
  );
}

function MarkdownContent({
  text,
  copyable,
}: {
  text: string;
  copyable: boolean;
}) {
  return (
    <CopyableWrapper copyable={copyable} copyValue={text}>
      <MarkdownWrapper>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
        >
          {text}
        </ReactMarkdown>
      </MarkdownWrapper>
    </CopyableWrapper>
  );
}

function HighlightedContent({
  code,
  language,
  copyValue,
  copyable,
}: {
  code: string;
  language: string;
  copyValue: string;
  copyable: boolean;
}) {
  return (
    <CopyableWrapper copyable={copyable} copyValue={copyValue}>
      <CodeHighlight language={language} code={code} />
    </CopyableWrapper>
  );
}

function PlainTextContent({
  text,
  copyable,
  wrap,
}: {
  text: string;
  copyable: boolean;
  wrap: boolean;
}) {
  const displayText = looksLikeJson(text) ? formatJson(text) : text;
  return (
    <CopyableWrapper copyable={copyable} copyValue={text}>
      <Code
        block
        p={36}
        variant={wrap ? "wrapping" : "nowrap"}
        // When not wrapping, the value may be clipped with an ellipsis; expose
        // the full text on hover so it's readable without copying.
        title={wrap ? undefined : displayText}
      >
        {displayText}
      </Code>
    </CopyableWrapper>
  );
}

/**
 * Render decoded text according to its MIME type: markdown, syntax-highlighted
 * JSON / XML / CSS, a CSV table, a sandboxed HTML iframe, or — for plain or
 * unrecognized text — a preformatted code block (with a JSON-shape heuristic so
 * mimeless JSON still pretty-prints).
 */
function TextualContent({
  text,
  mimeType,
  copyable,
  wrap,
}: {
  text: string;
  mimeType: string | undefined;
  copyable: boolean;
  wrap: boolean;
}) {
  const kind = mimeType ? getMimeKind(mimeType) : "text";
  switch (kind) {
    case "markdown":
      return <MarkdownContent text={text} copyable={copyable} />;
    case "json":
      return (
        <HighlightedContent
          code={formatJson(text)}
          language="json"
          copyValue={text}
          copyable={copyable}
        />
      );
    case "xml":
      return (
        <HighlightedContent
          code={formatXml(text)}
          language="xml"
          copyValue={text}
          copyable={copyable}
        />
      );
    case "css":
      return (
        <HighlightedContent
          code={text}
          language="css"
          copyValue={text}
          copyable={copyable}
        />
      );
    case "csv":
      return (
        <Stack gap="xs">
          <CsvTable text={text} />
        </Stack>
      );
    case "html":
      return (
        <Stack gap="xs">
          <HtmlFrame html={text} />
        </Stack>
      );
    default:
      return <PlainTextContent text={text} copyable={copyable} wrap={wrap} />;
  }
}

function ImageContent({ data, mimeType }: { data: string; mimeType: string }) {
  return (
    <Stack gap="xs">
      <PreviewImage src={buildDataUri(mimeType, data)} />
    </Stack>
  );
}

function AudioContent({ data, mimeType }: { data: string; mimeType: string }) {
  return (
    <Stack gap="xs">
      <audio controls>
        <source src={buildDataUri(mimeType, data)} />
      </audio>
    </Stack>
  );
}

/** Dispatch raw resource contents (Resources screen) on their effective MIME. */
function ResourceContent({
  contents,
  mimeType,
  copyable,
  wrap,
}: {
  contents: TextResourceContents | BlobResourceContents;
  mimeType: string;
  copyable: boolean;
  wrap: boolean;
}) {
  if ("text" in contents) {
    return (
      <TextualContent
        text={contents.text}
        mimeType={mimeType}
        copyable={copyable}
        wrap={wrap}
      />
    );
  }
  const kind = getMimeKind(mimeType);
  if (kind === "image") {
    return <ImageContent data={contents.blob} mimeType={mimeType} />;
  }
  if (kind === "audio") {
    return <AudioContent data={contents.blob} mimeType={mimeType} />;
  }
  if (kind === "pdf") {
    return (
      <Stack gap="xs">
        <PdfFrame data={contents.blob} />
      </Stack>
    );
  }
  if (isTextualKind(kind)) {
    const decoded = tryDecodeBase64ToUtf8(contents.blob);
    if (decoded === null) {
      return <BinaryNotice mimeType={mimeType} />;
    }
    return (
      <TextualContent
        text={decoded}
        mimeType={mimeType}
        copyable={copyable}
        wrap={wrap}
      />
    );
  }
  return <BinaryNotice mimeType={mimeType} />;
}

/** Dispatch a content block (tool results, prompt messages, …) on its type. */
function BlockContent({
  block,
  mimeType,
  copyable,
  wrap,
}: {
  block: ContentBlock;
  mimeType: string | undefined;
  copyable: boolean;
  wrap: boolean;
}) {
  switch (block.type) {
    case "text":
      return (
        <TextualContent
          text={block.text}
          mimeType={mimeType}
          copyable={copyable}
          wrap={wrap}
        />
      );
    case "image":
      return <ImageContent data={block.data} mimeType={block.mimeType} />;
    case "audio":
      return <AudioContent data={block.data} mimeType={block.mimeType} />;
    case "resource":
      return (
        <Stack gap="xs">
          <ContentWrapper>
            <Code block p={36}>
              {"text" in block.resource
                ? block.resource.text
                : `[blob: ${block.resource.uri}]`}
            </Code>
          </ContentWrapper>
        </Stack>
      );
    case "resource_link":
      // Static metadata only. The interactive, read-on-demand presentation
      // lives in the `groups/ResourceLink` group, rendered by content-block
      // hosts (e.g. ToolResultPanel) that can supply a read handler.
      return (
        <ResourceLinkInfo
          uri={block.uri}
          name={block.name}
          description={block.description}
          mimeType={block.mimeType}
        />
      );
    default:
      return null;
  }
}

export function ContentViewer({
  block,
  contents,
  copyable = false,
  mimeType,
  wrap = true,
}: ContentViewerProps) {
  if (contents) {
    const effective =
      mimeType ?? contents.mimeType ?? "application/octet-stream";
    return (
      <ResourceContent
        contents={contents}
        mimeType={effective}
        copyable={copyable}
        wrap={wrap}
      />
    );
  }
  if (!block) return null;
  return (
    <BlockContent
      block={block}
      mimeType={mimeType}
      copyable={copyable}
      wrap={wrap}
    />
  );
}
