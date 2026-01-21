import { Group, Text, Button } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';

interface ListChangedIndicatorProps {
  hasChanges: boolean;
  onRefresh: () => void;
  label?: string;
}

export function ListChangedIndicator({
  hasChanges,
  onRefresh,
  label = 'List updated',
}: ListChangedIndicatorProps) {
  if (!hasChanges) return null;

  return (
    <Group gap="xs">
      <Group gap={6}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: 'var(--mantine-color-yellow-5)',
            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          }}
        />
        <Text size="sm" c="dimmed">
          {label}
        </Text>
      </Group>
      <Button variant="subtle" size="xs" onClick={onRefresh} leftSection={<IconRefresh size={14} />}>
        Refresh
      </Button>
    </Group>
  );
}
