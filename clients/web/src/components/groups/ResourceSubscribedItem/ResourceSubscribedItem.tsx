import { Button, Group, Stack, Text } from "@mantine/core";

export interface ResourceSubscribedItemProps {
  name: string;
  lastUpdated?: string;
  onUnsubscribe: () => void;
}

const NameText = Text.withProps({
  size: "sm",
  fw: 500,
});

const TimestampText = Text.withProps({
  size: "xs",
  c: "dimmed",
});

const SubtleButton = Button.withProps({
  variant: "subtle",
  size: "xs",
});

const ItemRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
});

export function ResourceSubscribedItem({
  name,
  lastUpdated,
  onUnsubscribe,
}: ResourceSubscribedItemProps) {
  return (
    <ItemRow>
      <Stack gap={2}>
        <NameText>{name}</NameText>
        {lastUpdated && <TimestampText>{lastUpdated}</TimestampText>}
      </Stack>
      <SubtleButton onClick={onUnsubscribe}>Unsubscribe</SubtleButton>
    </ItemRow>
  );
}
