import { Group, Text } from '@mantine/core';

export interface CapabilityItemProps {
  name: string;
  supported: boolean;
  count?: number;
}

export function CapabilityItem({ name, supported, count }: CapabilityItemProps) {
  const label = count != null ? `${name} (${count})` : name;

  return (
    <Group gap="xs">
      <Text c={supported ? 'green' : 'red'}>{supported ? '\u2713' : '\u2717'}</Text>
      <Text>{label}</Text>
    </Group>
  );
}
