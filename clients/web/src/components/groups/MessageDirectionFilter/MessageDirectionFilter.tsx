import {
  Button,
  Group,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import type { MessageOrigin } from "@inspector/core/mcp/types.js";

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
 * listItem toggle per direction (client → server / client ← server). Shared by
 * the History and Network controls so the two stay identical.
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
        {MESSAGE_DIRECTIONS.map(({ origin, label, color }) => {
          const active = visibleDirections[origin];
          return (
            <UnstyledButton
              key={origin}
              w="100%"
              p="sm"
              variant="listItem"
              aria-pressed={active}
              bg={active ? "var(--mantine-primary-color-light)" : undefined}
              onClick={() => onToggleDirection(origin, !active)}
            >
              <Text c={color} ta="center" fw={500}>
                {label}
              </Text>
            </UnstyledButton>
          );
        })}
      </Stack>
    </>
  );
}
