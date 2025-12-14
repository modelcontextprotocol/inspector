import { Badge, Group } from '@mantine/core';

export interface Annotations {
  audience?: string;
  readOnly?: boolean;
  destructive?: boolean;
  longRunning?: boolean;
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
      {annotations.audience && (
        <Badge size="xs" variant="light">
          {annotations.audience}
        </Badge>
      )}
      {annotations.readOnly && (
        <Badge size="xs" color="blue">
          read-only
        </Badge>
      )}
      {annotations.destructive && (
        <Badge size="xs" color="red">
          destructive
        </Badge>
      )}
      {annotations.longRunning && (
        <Badge size="xs" color="yellow">
          long-run
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
