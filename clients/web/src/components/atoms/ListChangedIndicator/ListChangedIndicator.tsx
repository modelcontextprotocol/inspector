import { Button, Flex, Group, Text } from "@mantine/core";

export interface ListChangedIndicatorProps {
  visible: boolean;
  onRefresh: () => void;
}

const Dot = Flex.withProps({
  w: 8,
  h: 8,
  style: { borderRadius: "50%" },
  bg: "var(--inspector-status-connecting)",
});

export function ListChangedIndicator({
  visible,
  onRefresh,
}: ListChangedIndicatorProps) {
  if (!visible) return null;

  return (
    <Group gap="xs">
      <Dot />
      <Text size="sm" c="dimmed">
        List updated
      </Text>
      <Button size="xs" variant="light" onClick={onRefresh}>
        ↻ Refresh
      </Button>
    </Group>
  );
}
