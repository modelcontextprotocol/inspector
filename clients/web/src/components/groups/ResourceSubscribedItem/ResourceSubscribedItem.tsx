import { Button, Group, Stack, Text } from "@mantine/core";
import type { InspectorResourceSubscription } from "../../../../../../core/mcp/types.js";

export interface ResourceSubscribedItemProps {
  subscription: InspectorResourceSubscription;
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

function formatLastUpdated(date: Date): string {
  return date.toLocaleString();
}

export function ResourceSubscribedItem({
  subscription,
  onUnsubscribe,
}: ResourceSubscribedItemProps) {
  const { resource, lastUpdated } = subscription;
  return (
    <ItemRow>
      <Stack gap={2}>
        <NameText>{resource.title ?? resource.name}</NameText>
        {lastUpdated && (
          <TimestampText>{formatLastUpdated(lastUpdated)}</TimestampText>
        )}
      </Stack>
      <SubtleButton onClick={onUnsubscribe}>Unsubscribe</SubtleButton>
    </ItemRow>
  );
}
