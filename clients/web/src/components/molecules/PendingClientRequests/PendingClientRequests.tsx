import type { ReactNode } from "react";
import { Alert, Stack } from "@mantine/core";

export interface PendingClientRequestsProps {
  count: number;
  children: ReactNode;
}

export function PendingClientRequests({
  count,
  children,
}: PendingClientRequestsProps) {
  return (
    <Alert
      color="blue"
      variant="light"
      title={`Pending Client Requests (${count})`}
    >
      <Stack gap="md">{children}</Stack>
    </Alert>
  );
}
