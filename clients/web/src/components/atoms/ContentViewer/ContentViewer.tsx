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

const ContentWrapper = Flex.withProps({
  pos: "relative",
  direction: "column",
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
            {type === "json" ? formatJson(content) : content}
          </Code>
          {showCopy && (
            <Flex pos="absolute" top={4} right={4}>
              <CopyButton value={content} />
            </Flex>
          )}
        </ContentWrapper>
      )}
      {type === "image" && (
        <Image
          src={`data:${mimeType || "image/png"};base64,${content}`}
          alt="Content preview"
          maw={400}
          radius="md"
        />
      )}
      {type === "audio" && (
        <audio controls>
          <source src={`data:${mimeType || "audio/wav"};base64,${content}`} />
        </audio>
      )}
    </Stack>
  );
}
