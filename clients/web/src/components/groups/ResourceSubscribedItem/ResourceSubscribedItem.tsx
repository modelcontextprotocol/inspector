import { Button, Group, Stack, Text, Tooltip } from "@mantine/core";
import type { InspectorResourceSubscription } from "../../../../../../core/mcp/types.js";

export interface ResourceSubscribedItemProps {
  subscription: InspectorResourceSubscription;
  onUnsubscribe: () => void;
}

const NameText = Text.withProps({
  size: "sm",
  fw: 500,
  truncate: "end",
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
  gap: "xs",
});

const NameStack = Stack.withProps({
  gap: 2,
  flex: 1,
  miw: 0,
});

function formatLastUpdated(date: Date): string {
  return date.toLocaleString();
}

// Strip the URI down to its last non-empty path segment so the tile shows
// a compact label (e.g. `file:///foo/bar/config.json` → `config.json`).
// The full URI is restored via a tooltip on hover.
function lastUriSegment(uri: string): string {
  const segments = uri.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? uri;
}

export function ResourceSubscribedItem({
  subscription,
  onUnsubscribe,
}: ResourceSubscribedItemProps) {
  const { resource, lastUpdated } = subscription;
  return (
    <ItemRow>
      <NameStack>
        <Tooltip label={resource.uri} withinPortal>
          <NameText>{lastUriSegment(resource.uri)}</NameText>
        </Tooltip>
        {lastUpdated && (
          <TimestampText>{formatLastUpdated(lastUpdated)}</TimestampText>
        )}
      </NameStack>
      <SubtleButton onClick={onUnsubscribe}>Unsubscribe</SubtleButton>
    </ItemRow>
  );
}
