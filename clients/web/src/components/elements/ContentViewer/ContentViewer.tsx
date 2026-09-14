import { Code, Flex, Image, Stack } from "@mantine/core";
import type { ReactNode } from "react";
import type {
  BlobResourceContents,
  ContentBlock,
  TextResourceContents,
} from "@modelcontextprotocol/client";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeHighlight } from "../CodeHighlight/CodeHighlight";
import { CopyButton } from "../CopyButton/CopyButton";
import { JsonEditor } from "../JsonEditor/JsonEditor";
import { ResourceLinkInfo } from "../ResourceLinkInfo/ResourceLinkInfo";
import {
  formatJson,
  formatXml,
  formatJsonDocument,
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
  /**
   * Accessible name for the read-only JSON editor a JSON payload renders in.
   *
   * Say what the payload *is* whenever a screen can hold more than one: an
   * expanded Protocol entry carries both its parameters and its response, and
   * a list of them carries many such pairs — so the default leaves a screen
   * reader tabbing through textboxes that all announce the same thing, with
   * only the visible section headings to tell them apart.
   *
   * Reaches the JSON branch only; every other renderer here is not a control
   * and takes no name.
   */
  jsonLabel?: string;
}

/**
 * Rows a read-only JSON payload renders before the editor scrolls internally
 * instead of growing. See the note at the `JsonEditor` that uses it.
 */
const JSON_DISPLAY_MAX_LINES = 200;

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

const CodeBlock = Code.withProps({
  block: true,
  p: 36,
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

/**
 * A read-only JSON payload, rendered in the same Ace editor the JSON *input*
 * surfaces use (#2151).
 *
 * Highlighting is not what this buys — JSON already highlighted here, through
 * the lazily-imported Prism grammar `CodeHighlight` loads. What Ace adds is
 * **folding**, line numbers and a gutter, which is the difference between
 * reading a large `tools/call` result and scrolling past it. Prism's `json`
 * grammar was dropped in the same change rather than kept beside this: two
 * highlighters for one language drift, and nothing else asks for `json`.
 *
 * The copy affordance is unchanged — `CopyableWrapper` overlays it above
 * whichever renderer was picked, so `copyable` keeps working across the swap.
 * It copies the *original* text, not the pretty-printed form, matching every
 * other branch here.
 */
function JsonContent({
  text,
  formatted,
  copyable,
  label,
}: {
  /** The original payload — what the copy button copies. */
  text: string;
  /** Its pretty-printed form, already parsed once by whoever decided to use it. */
  formatted: string;
  copyable: boolean;
  label: string;
}) {
  return (
    <CopyableWrapper copyable={copyable} copyValue={text}>
      <JsonEditor
        ariaLabel={label}
        value={formatted}
        readOnly
        // Sized to the payload, and capped.
        //
        // `minLines={1}` so a two-line result does not open six rows of blank
        // editor. The cap is the more interesting number, and it is a trade:
        //
        // - Below it the editor grows to fit, so the *host's* scroll container
        //   is the only one — every consumer already provides the one it wants
        //   (the structured-output section caps at `mah` and scrolls; a result
        //   panel scrolls whole), and nesting a second scrollbar inside it is
        //   worse to use.
        // - Above it Ace scrolls internally and renders only the rows its own
        //   viewport covers. That is the point of having a cap at all: the
        //   Protocol and Network lists are not virtualized and keep every
        //   entry's payload mounted inside its `Collapse`, so an uncapped
        //   editor would put a whole 10k-line response in the DOM per entry.
        //
        // 200 is chosen so essentially no real payload nests a scrollbar while
        // the pathological one stays bounded.
        minLines={1}
        maxLines={JSON_DISPLAY_MAX_LINES}
      />
    </CopyableWrapper>
  );
}

function PlainTextContent({
  text,
  copyable,
  wrap,
  jsonLabel,
}: {
  text: string;
  copyable: boolean;
  wrap: boolean;
  jsonLabel: string;
}) {
  // Untyped text that really parses as JSON gets the JSON renderer too — the
  // heuristic is how a server that sent no MIME type still reads well. Not when
  // `wrap` is false, though: that caller wants one clipped line at a fixed
  // height, which a multi-line editor is not.
  //
  // The formatted text comes back from the same call that decided, so the
  // payload is parsed once rather than once to test and again to render.
  const asJson = wrap ? formatJsonDocument(text) : null;
  if (asJson !== null) {
    return (
      <JsonContent
        text={text}
        formatted={asJson}
        copyable={copyable}
        label={jsonLabel}
      />
    );
  }
  const displayText = looksLikeJson(text) ? formatJson(text) : text;
  return (
    <CopyableWrapper copyable={copyable} copyValue={text}>
      <CodeBlock
        // A `block` Code has `overflow: auto`, so make it keyboard-scrollable
        // (WCAG SC 2.1.1) — it holds only text, with no focusable child.
        tabIndex={0}
        variant={wrap ? "wrapping" : "nowrap"}
        // When not wrapping, the value may be clipped with an ellipsis; expose
        // the full text on hover so it's readable without copying.
        title={wrap ? undefined : displayText}
      >
        {displayText}
      </CodeBlock>
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
  jsonLabel,
}: {
  text: string;
  mimeType: string | undefined;
  copyable: boolean;
  wrap: boolean;
  jsonLabel: string;
}) {
  const kind = mimeType ? getMimeKind(mimeType) : "text";
  switch (kind) {
    case "markdown":
      return <MarkdownContent text={text} copyable={copyable} />;
    case "json":
      // `wrap={false}` is a fixed-height, single-line, ellipsis-clipped box
      // (the server card's command/URL). Pretty-printed JSON collapsed onto one
      // line is exactly what that prop is documented not to be used for, so
      // that caller keeps the plain renderer.
      return wrap ? (
        <JsonContent
          text={text}
          // A *declared* `application/json` renders as JSON even when it does
          // not parse — the server said what it sent — so this cannot go
          // through `formatJsonDocument`, which reports unparseable text as
          // not-JSON. `formatJson` returns the original on failure.
          formatted={formatJson(text)}
          copyable={copyable}
          label={jsonLabel}
        />
      ) : (
        <PlainTextContent
          text={text}
          copyable={copyable}
          wrap={wrap}
          jsonLabel={jsonLabel}
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
      return (
        <PlainTextContent
          text={text}
          copyable={copyable}
          wrap={wrap}
          jsonLabel={jsonLabel}
        />
      );
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
  jsonLabel,
}: {
  contents: TextResourceContents | BlobResourceContents;
  mimeType: string;
  copyable: boolean;
  wrap: boolean;
  jsonLabel: string;
}) {
  if ("text" in contents) {
    return (
      <TextualContent
        text={contents.text}
        mimeType={mimeType}
        copyable={copyable}
        wrap={wrap}
        jsonLabel={jsonLabel}
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
        jsonLabel={jsonLabel}
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
  jsonLabel,
}: {
  block: ContentBlock;
  mimeType: string | undefined;
  copyable: boolean;
  wrap: boolean;
  jsonLabel: string;
}) {
  switch (block.type) {
    case "text":
      return (
        <TextualContent
          text={block.text}
          mimeType={mimeType}
          copyable={copyable}
          wrap={wrap}
          jsonLabel={jsonLabel}
        />
      );
    case "image":
      return <ImageContent data={block.data} mimeType={block.mimeType} />;
    case "audio":
      return <AudioContent data={block.data} mimeType={block.mimeType} />;
    case "resource": {
      // An embedded *text* resource that declares JSON goes through the same
      // dispatch a text block does, so this branch inherits the JSON renderer
      // rather than staying on a plain code block (#2151).
      //
      // Narrowed to JSON on purpose, the same way the Network tab's bodies are:
      // routing every declared type through would also put an embedded
      // `text/html` resource into the sandboxed frame and a `text/csv` one into
      // a table. The Resources screen already renders resource contents that
      // way, so doing it here too is defensible — but it is a change to what a
      // tool result *is*, and belongs to whoever decides that rather than to
      // this swap.
      const embedded = "text" in block.resource ? block.resource : null;
      if (embedded && getMimeKind(embedded.mimeType ?? "") === "json") {
        return (
          <TextualContent
            text={embedded.text}
            mimeType={embedded.mimeType}
            copyable={copyable}
            wrap={wrap}
            jsonLabel={jsonLabel}
          />
        );
      }
      return (
        <Stack gap="xs">
          <ContentWrapper>
            <CodeBlock>
              {embedded ? embedded.text : `[blob: ${block.resource.uri}]`}
            </CodeBlock>
          </ContentWrapper>
        </Stack>
      );
    }
    case "resource_link":
      // Static metadata only. The interactive, read-on-demand presentation
      // lives in the `groups/ResourceLink` group, rendered by content-block
      // hosts (e.g. ToolResultPanel) that can supply a read handler.
      return (
        <ResourceLinkInfo
          uri={block.uri}
          name={block.name}
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
  jsonLabel = "JSON content",
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
        jsonLabel={jsonLabel}
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
      jsonLabel={jsonLabel}
    />
  );
}
