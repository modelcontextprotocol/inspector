import { Group, Stack, Text, UnstyledButton } from "@mantine/core";
import type { EventType } from "@inspector/core/extension/events/schemas.js";
import { DeliveryModeBadge } from "../../elements/DeliveryModeBadge/DeliveryModeBadge";

export interface EventTypeListItemProps {
  eventType: EventType;
  selected: boolean;
  onClick: () => void;
}

const ListItemButton = UnstyledButton.withProps({
  w: "100%",
  p: "sm",
  variant: "listItem",
});

const ItemBody = Stack.withProps({
  gap: 4,
  miw: 0,
});

const ItemLabel = Text.withProps({
  fw: 500,
  truncate: true,
});

const ItemDescription = Text.withProps({
  size: "xs",
  c: "dimmed",
  lineClamp: 2,
});

const ModeRow = Group.withProps({
  gap: 4,
});

/**
 * One row of the Events sidebar (SEP-3415, #3030): the event type's name, its
 * description, and a badge per advertised delivery mode — including any this
 * client cannot subscribe with yet, so the server's whole offer is visible.
 */
export function EventTypeListItem({
  eventType,
  selected,
  onClick,
}: EventTypeListItemProps) {
  const { name, description, delivery } = eventType;
  return (
    <ListItemButton
      bg={selected ? "var(--mantine-primary-color-light)" : undefined}
      onClick={onClick}
      aria-label={name}
    >
      <ItemBody>
        <ItemLabel>{name}</ItemLabel>
        {description && <ItemDescription>{description}</ItemDescription>}
        <ModeRow>
          {delivery.map((mode) => (
            <DeliveryModeBadge key={mode} mode={mode} />
          ))}
        </ModeRow>
      </ItemBody>
    </ListItemButton>
  );
}
