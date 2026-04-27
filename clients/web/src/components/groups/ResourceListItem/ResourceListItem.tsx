import { Group, Text, UnstyledButton } from "@mantine/core";
import type {
  Resource,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/types.js";
import { AnnotationBadge } from "../../elements/AnnotationBadge/AnnotationBadge";

export interface ResourceListItemProps {
  resource: Resource | ResourceTemplate;
  selected: boolean;
  onClick: () => void;
}

const RowGroup = Group.withProps({
  gap: "xs",
  wrap: "wrap",
  justify: "space-between",
});

const BadgeGroup = Group.withProps({
  gap: "xs",
  wrap: "wrap",
});

export function ResourceListItem({
  resource,
  selected,
  onClick,
}: ResourceListItemProps) {
  const annotations = resource.annotations;
  const audience = annotations?.audience;
  const priority = annotations?.priority;
  const hasAudience = audience !== undefined && audience.length > 0;
  const hasPriority = priority !== undefined;
  const label = <Text fw={500}>{resource.title ?? resource.name}</Text>;

  return (
    <UnstyledButton
      w="100%"
      p="sm"
      variant="listItem"
      bg={selected ? "var(--mantine-primary-color-light)" : undefined}
      onClick={onClick}
    >
      {hasAudience || hasPriority ? (
        <RowGroup>
          {label}
          <BadgeGroup>
            {hasAudience && (
              <AnnotationBadge facet="audience" value={audience} />
            )}
            {hasPriority && (
              <AnnotationBadge facet="priority" value={priority} />
            )}
          </BadgeGroup>
        </RowGroup>
      ) : (
        label
      )}
    </UnstyledButton>
  );
}
