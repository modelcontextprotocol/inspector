import { Stack, Text } from "@mantine/core";
import { ToastLinkButton } from "./ToastPrimitives";

// Body of the non-spec URLElicitationRequired toast: the server returned a
// -32042 error with no `elicitations` list, so there's no URL to open. We keep
// the toast short and link to a modal with the raw error body.
export const UrlElicitationErrorToastMessage = ({
  onViewDetails,
}: {
  onViewDetails: () => void;
}) => (
  <Stack gap={4}>
    <Text size="sm">
      The server reported a URLElicitationRequired error but listed no required
      elicitations, so there&apos;s nothing to open.
    </Text>
    <ToastLinkButton onClick={onViewDetails}>
      View error details
    </ToastLinkButton>
  </Stack>
);
