import { ActionIcon, Box } from "@mantine/core";
import { RiDraggable } from "react-icons/ri";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ServerCard, type ServerCardProps } from "../ServerCard/ServerCard";

export type SortableServerCardProps = ServerCardProps;

/**
 * Sortable wrapper around the dumb `ServerCard`. Owns all drag-and-drop
 * concerns (the `@dnd-kit` sortable node, the per-frame transform, and the
 * grip activator) so `ServerCard` itself stays a pure display component that
 * only renders the `dragHandle` slot it's handed.
 *
 * The grip is the sole drag activator (pointer + keyboard) — bound via
 * `listeners`/`attributes` and `setActivatorNodeRef` — so the card's own
 * buttons (Clone / Edit / Remove / Settings) keep working without starting a
 * drag. It's passed into `ServerCard.dragHandle`, which renders it at the start
 * of the header row, before the server name.
 */
export function SortableServerCard(props: SortableServerCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.id });

  const grip = (
    <ActionIcon
      ref={setActivatorNodeRef}
      variant="subtle"
      color="gray"
      size="md"
      className="server-drag-handle"
      aria-label={`Reorder ${props.name}`}
      {...attributes}
      {...listeners}
    >
      <RiDraggable size={16} />
    </ActionIcon>
  );

  return (
    <Box
      ref={setNodeRef}
      // dnd-kit positions the item with a transform that changes every
      // animation frame during a drag — the one place an inline style is
      // unavoidable, since the value can't be a static theme variant or prop.
      // While dragging we lift the item above its siblings and fade it
      // slightly so the drop target underneath stays legible.
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 2 : undefined,
        opacity: isDragging ? 0.85 : undefined,
      }}
    >
      <ServerCard {...props} dragHandle={grip} />
    </Box>
  );
}
