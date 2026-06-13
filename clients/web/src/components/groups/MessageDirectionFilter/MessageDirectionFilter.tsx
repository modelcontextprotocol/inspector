import { Button, Group, Stack, Title } from "@mantine/core";
import type { MessageOrigin } from "@inspector/core/mcp/types.js";
import { FilterToggleButton } from "../../elements/FilterToggleButton/FilterToggleButton";

const SubtleButton = Button.withProps({
  variant: "subtle",
  size: "xs",
});

// The two message directions, in display order. Label + color mirror the
// MessageDirectionBadge: outgoing (client → server) is green, incoming
// (client ← server) is violet.
const MESSAGE_DIRECTIONS: {
  origin: MessageOrigin;
  label: string;
  color: string;
}[] = [
  { origin: "client", label: "client → server", color: "green" },
  { origin: "server", label: "client ← server", color: "violet" },
];

export interface MessageDirectionFilterProps {
  visibleDirections: Record<MessageOrigin, boolean>;
  onToggleDirection: (direction: MessageOrigin, visible: boolean) => void;
  onToggleAllDirections: () => void;
}

/**
 * "Filter by Message Direction" section — a Select/Deselect All control plus a
 * FilterToggleButton per direction (client → server / client ← server). Used by
 * the History controls. (Kept as its own component so the section is testable in
 * isolation and reusable if another screen ever needs a direction filter.)
 */
export function MessageDirectionFilter({
  visibleDirections,
  onToggleDirection,
  onToggleAllDirections,
}: MessageDirectionFilterProps) {
  return (
    <>
      <Group justify="space-between">
        <Title order={6}>Filter by Message Direction</Title>
        <SubtleButton onClick={onToggleAllDirections}>
          {Object.values(visibleDirections).every(Boolean)
            ? "Deselect All"
            : "Select All"}
        </SubtleButton>
      </Group>
      <Stack gap="xs">
        {MESSAGE_DIRECTIONS.map(({ origin, label, color }) => (
          <FilterToggleButton
            key={origin}
            label={label}
            color={color}
            active={visibleDirections[origin]}
            onToggle={(visible) => onToggleDirection(origin, visible)}
          />
        ))}
      </Stack>
    </>
  );
}
