import type { ReactNode } from "react";
import { Alert, Stack } from "@mantine/core";

export interface PendingClientRequestsProps {
  count: number;
  children: ReactNode;
}

function formatTitle(count: number): string {
  return `Pending Client Requests (${count})`;
}

export function PendingClientRequests({
  count,
  children,
}: PendingClientRequestsProps) {
  return (
    <Alert color="blue" variant="light" title={formatTitle(count)}>
      <Stack gap="md">{children}</Stack>
    </Alert>
  );
}
