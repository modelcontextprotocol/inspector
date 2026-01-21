import { Badge, Loader, Group } from '@mantine/core';

export type ServerStatus = 'connected' | 'connecting' | 'disconnected' | 'failed';

interface StatusIndicatorProps {
  status: ServerStatus;
  retryCount?: number;
}

const statusConfig: Record<
  ServerStatus,
  { color: string; label: string }
> = {
  connected: { color: 'green', label: 'Connected' },
  connecting: { color: 'yellow', label: 'Connecting...' },
  disconnected: { color: 'gray', label: 'Disconnected' },
  failed: { color: 'red', label: 'Failed' },
};

export function StatusIndicator({ status, retryCount }: StatusIndicatorProps) {
  const config = statusConfig[status];

  return (
    <Group gap="xs">
      {status === 'connecting' ? (
        <Loader size="xs" color="yellow" />
      ) : (
        <Badge size="sm" color={config.color} variant="dot">
          {config.label}
          {status === 'failed' && retryCount !== undefined && ` (${retryCount})`}
        </Badge>
      )}
    </Group>
  );
}
