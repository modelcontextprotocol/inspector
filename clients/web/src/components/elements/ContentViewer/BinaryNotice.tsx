import { Code, Flex, Stack } from "@mantine/core";

const ContentWrapper = Flex.withProps({
  pos: "relative",
  direction: "column",
});

/**
 * Fallback shown when content can't be previewed — an unsupported binary MIME
 * type, or a blob whose base64 fails to decode. Kept in its own module so blob
 * renderers (e.g. {@link PdfFrame}) can degrade to it without importing back
 * into {@link ContentViewer} (which would form an import cycle).
 */
export function BinaryNotice({ mimeType }: { mimeType: string }) {
  return (
    <Stack gap="xs">
      <ContentWrapper>
        <Code block p={36}>
          {`[Binary content (${mimeType}) — preview not supported]`}
        </Code>
      </ContentWrapper>
    </Stack>
  );
}
