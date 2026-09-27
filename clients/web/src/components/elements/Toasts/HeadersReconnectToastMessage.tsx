import { Stack, Text } from "@mantine/core";
import { ToastLinkButton } from "./ToastPrimitives";

// Body of the "custom headers changed" notice (#2460). Headers are fixed into
// the transport when a connection opens, so an edit made while connected is
// saved but not sent — the open connection keeps the headers it started with.
// Without this notice the first sign of that is a server rejecting a request
// for a header the user can see sitting in the settings form.
export const HeadersReconnectToastMessage = ({
  onReconnect,
}: {
  onReconnect: () => void;
}) => (
  <Stack gap={4}>
    <Text size="sm">
      Your header changes are saved, but this connection is still sending the
      headers it connected with. Reconnect to send the new ones.
    </Text>
    <ToastLinkButton onClick={onReconnect}>Reconnect now</ToastLinkButton>
  </Stack>
);
