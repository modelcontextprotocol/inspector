import { Stack, Text } from "@mantine/core";
import { ToastLinkButton } from "./ToastPrimitives";

// Body of the output-schema-mismatch warning toast: a one-line summary plus a
// link that opens the full validation details in a modal (the raw error is far
// too long for a toast).
export const OutputValidationToastMessage = ({
  onViewDetails,
}: {
  onViewDetails: () => void;
}) => (
  <Stack gap={4}>
    <Text size="sm">
      The tool result&apos;s structuredContent doesn&apos;t match the
      tool&apos;s outputSchema. The inspector renders it anyway, but strict MCP
      clients may not.
    </Text>
    <ToastLinkButton onClick={onViewDetails}>
      View validation details
    </ToastLinkButton>
  </Stack>
);
