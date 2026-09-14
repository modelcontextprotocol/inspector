import { List, Stack, Text } from "@mantine/core";
import { ToastCauseList, ToastLinkButton } from "./ToastPrimitives";

// Body of the "response body dropped" warning toast: a one-line summary of what
// happened, the likely causes, and a link that opens this server's settings
// (on the Options section) so the user can raise the Network Log Size if it's
// just a high-traffic server. Surfaces the otherwise-invisible rotation drop
// described in #1390.
export const FetchBodyDroppedToastMessage = ({
  maxFetchRequests,
  onAdjust,
}: {
  maxFetchRequests: number;
  onAdjust: () => void;
}) => (
  <Stack gap={4}>
    <Text size="sm">
      A response body arrived after its Network log entry had already rotated
      out (the log hit its {maxFetchRequests}-request limit), so the body
      couldn&apos;t be shown. This usually indicates:
    </Text>
    <ToastCauseList>
      <List.Item>
        a chatty or misbehaving server (notification storms, rapid polling)
      </List.Item>
      <List.Item>an SSE/transport reconnect or retry storm</List.Item>
      <List.Item>
        a slow streaming call racing against high request volume
      </List.Item>
      <List.Item>
        the Network Log Size set too low for this server&apos;s traffic
      </List.Item>
    </ToastCauseList>
    <ToastLinkButton onClick={onAdjust}>
      Adjust Network Log Size for this server
    </ToastLinkButton>
  </Stack>
);
