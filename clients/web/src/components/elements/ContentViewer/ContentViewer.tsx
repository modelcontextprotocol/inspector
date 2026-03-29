import { Code, Flex, Image, Stack } from "@mantine/core";
import { CopyButton } from "../CopyButton/CopyButton";

export interface ContentViewerProps {
  type: "text" | "json" | "image" | "audio";
  content: string;
  mimeType?: string;
  copyable?: boolean;
}

function formatJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function buildDataUri(mimeType: string, content: string): string {
  return `data:${mimeType};base64,${content}`;
}

function formatContent(type: "text" | "json", content: string): string {
  return type === "json" ? formatJson(content) : content;
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

const PreviewImage = Image.withProps({
  alt: "Content preview",
  maw: 400,
  radius: "md",
});

export function ContentViewer({
  type,
  content,
  mimeType,
  copyable = false,
}: ContentViewerProps) {
  const showCopy = copyable && (type === "text" || type === "json");

  return (
    <Stack gap="xs">
      {(type === "json" || type === "text") && (
        <ContentWrapper>
          <Code block p={36}>
            {formatContent(type, content)}
          </Code>
          {showCopy && (
            <CopyOverlay>
              <CopyButton value={content} />
            </CopyOverlay>
          )}
        </ContentWrapper>
      )}
      {type === "image" && (
        <PreviewImage src={buildDataUri(mimeType || "image/png", content)} />
      )}
      {type === "audio" && (
        <audio controls>
          <source src={buildDataUri(mimeType || "audio/wav", content)} />
        </audio>
      )}
    </Stack>
  );
}
