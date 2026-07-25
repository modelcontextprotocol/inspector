import type { ReactNode } from "react";
import { Alert, Stack } from "@mantine/core";

export interface PendingClientRequestsProps {
  count: number;
  children: ReactNode;
}

function formatTitle(count: number): string {
  return `Pending Client Requests (${count})`;
}

const PendingAlert = Alert.withProps({
  color: "blue",
  variant: "light",
});

export function PendingClientRequests({
  count,
  children,
}: PendingClientRequestsProps) {
  return (
    <PendingAlert title={formatTitle(count)}>
      <Stack gap="md">{children}</Stack>
    </PendingAlert>
  );
}
