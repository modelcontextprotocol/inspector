import { Button, Group, Paper, Text } from "@mantine/core";

export interface ListChangedIndicatorProps {
  visible: boolean;
  onRefresh: () => void;
}

const Dot = Paper.withProps({
  w: 8,
  h: 8,
  radius: "xl",
  bg: "var(--inspector-status-connecting)",
});

const UpdateLabel = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const RefreshButton = Button.withProps({
  size: "xs",
  variant: "light",
});

export function ListChangedIndicator({
  visible,
  onRefresh,
}: ListChangedIndicatorProps) {
  if (!visible) return null;

  return (
    <Group gap="xs">
      <Dot />
      <UpdateLabel>List updated</UpdateLabel>
      <RefreshButton onClick={onRefresh}>Refresh</RefreshButton>
    </Group>
  );
}
