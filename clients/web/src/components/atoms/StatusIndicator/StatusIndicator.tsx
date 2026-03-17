import { Flex, Group, Text } from '@mantine/core';

export interface StatusIndicatorProps {
  status: 'connected' | 'connecting' | 'disconnected' | 'failed';
  latencyMs?: number;
  retryCount?: number;
}

const statusColorVar: Record<StatusIndicatorProps['status'], string> = {
  connected: 'var(--inspector-status-connected)',
  connecting: 'var(--inspector-status-connecting)',
  disconnected: 'var(--inspector-status-disconnected)',
  failed: 'var(--inspector-status-failed)',
};

function getLabel(
  status: StatusIndicatorProps['status'],
  latencyMs?: number,
  retryCount?: number,
): string {
  switch (status) {
    case 'connected':
      return latencyMs != null ? `Connected (${latencyMs}ms)` : 'Connected';
    case 'connecting':
      return 'Connecting...';
    case 'disconnected':
      return 'Disconnected';
    case 'failed':
      return retryCount != null ? `Failed (${retryCount})` : 'Failed';
  }
}

const Dot = Flex.withProps({
  w: 10,
  h: 10,
  style: { borderRadius: '50%' },
});

export function StatusIndicator({ status, latencyMs, retryCount }: StatusIndicatorProps) {
  return (
    <Group gap="xs">
      <Dot
        bg={statusColorVar[status]}
        className={status === 'connecting' ? 'inspector-pulse' : undefined}
      />
      <Text size="sm">{getLabel(status, latencyMs, retryCount)}</Text>
    </Group>
  );
}
