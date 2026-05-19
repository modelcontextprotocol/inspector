import { Code, Flex, Image, Stack, Text } from "@mantine/core";
import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "../CopyButton/CopyButton";

export interface ContentViewerProps {
  block: ContentBlock;
  copyable?: boolean;
  /**
   * Optional MIME type for the block. When `text/markdown` (or
   * `text/x-markdown`), text content is rendered via react-markdown
   * instead of as preformatted code.
   */
  mimeType?: string;
}

function formatJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function isJsonText(block: ContentBlock): boolean {
  if (block.type !== "text") return false;
  const trimmed = block.text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function isMarkdownMime(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return base === "text/markdown" || base === "text/x-markdown";
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

export function ContentViewer({
  block,
  copyable = false,
  mimeType,
}: ContentViewerProps) {
  switch (block.type) {
    case "text": {
      const renderAsMarkdown = isMarkdownMime(mimeType);
      if (renderAsMarkdown) {
        return (
          <Stack gap="xs">
            <ContentWrapper>
              <MarkdownWrapper>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {block.text}
                </ReactMarkdown>
              </MarkdownWrapper>
              {copyable && (
                <CopyOverlay>
                  <CopyButton value={block.text} />
                </CopyOverlay>
              )}
            </ContentWrapper>
          </Stack>
        );
      }
      const isJson = isJsonText(block);
      const displayText = isJson ? formatJson(block.text) : block.text;
      return (
        <Stack gap="xs">
          <ContentWrapper>
            <Code block p={36} variant="wrapping">
              {displayText}
            </Code>
            {copyable && (
              <CopyOverlay>
                <CopyButton value={block.text} />
              </CopyOverlay>
            )}
          </ContentWrapper>
        </Stack>
      );
    }
    case "image":
      return (
        <Stack gap="xs">
          <PreviewImage src={buildDataUri(block.mimeType, block.data)} />
        </Stack>
      );
    case "audio":
      return (
        <Stack gap="xs">
          <audio controls>
            <source src={buildDataUri(block.mimeType, block.data)} />
          </audio>
        </Stack>
      );
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
      return (
        <Stack gap="xs">
          <Text size="sm" c="blue">
            {block.name ?? block.uri}
          </Text>
        </Stack>
      );
    default:
      return null;
  }
}
