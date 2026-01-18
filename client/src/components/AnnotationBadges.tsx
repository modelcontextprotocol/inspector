import { Badge, Group } from '@mantine/core';

// Generic annotations type that handles both Tool and Resource annotations
// Tool: title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint
// Resource: audience, priority
export interface Annotations {
  // Tool annotations
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  // Resource annotations
  audience?: string[] | string;
  priority?: number;
}

export interface AnnotationBadgesProps {
  annotations?: Annotations;
  className?: string;
}

export function getPriorityLabel(priority: number): { label: string; color: string } {
  if (priority > 0.7) return { label: 'high', color: 'yellow' };
  if (priority > 0.3) return { label: 'medium', color: 'gray' };
  return { label: 'low', color: 'blue' };
}

export function AnnotationBadges({ annotations, className }: AnnotationBadgesProps) {
  if (!annotations || Object.keys(annotations).length === 0) {
    return null;
  }

  return (
    <Group gap={4} className={className}>
      {annotations.readOnlyHint && (
        <Badge size="xs" color="blue">
          read-only
        </Badge>
      )}
      {annotations.destructiveHint && (
        <Badge size="xs" color="red">
          destructive
        </Badge>
      )}
      {annotations.idempotentHint && (
        <Badge size="xs" color="green">
          idempotent
        </Badge>
      )}
      {annotations.openWorldHint && (
        <Badge size="xs" color="grape">
          open-world
        </Badge>
      )}
      {annotations.title && (
        <Badge size="xs" variant="outline">
          {annotations.title}
        </Badge>
      )}
      {/* Resource annotations */}
      {annotations.audience && (
        <Badge size="xs" variant="light">
          {Array.isArray(annotations.audience)
            ? annotations.audience.join(', ')
            : annotations.audience}
        </Badge>
      )}
      {annotations.priority !== undefined && (
        <Badge size="xs" color={getPriorityLabel(annotations.priority).color}>
          priority: {getPriorityLabel(annotations.priority).label}
        </Badge>
      )}
    </Group>
  );
}
