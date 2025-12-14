import { Badge } from '@/components/ui/badge';

export interface Annotations {
  audience?: string;
  readOnly?: boolean;
  destructive?: boolean;
  longRunning?: boolean;
  priority?: number;
}

interface AnnotationBadgesProps {
  annotations?: Annotations;
  className?: string;
}

export function getPriorityLabel(priority: number): { label: string; variant: 'default' | 'secondary' | 'warning' } {
  if (priority > 0.7) return { label: 'high', variant: 'warning' };
  if (priority > 0.3) return { label: 'medium', variant: 'secondary' };
  return { label: 'low', variant: 'default' };
}

export function AnnotationBadges({ annotations, className }: AnnotationBadgesProps) {
  if (!annotations || Object.keys(annotations).length === 0) {
    return null;
  }

  return (
    <div className={className ?? 'flex flex-wrap gap-1'}>
      {annotations.audience && (
        <Badge variant="secondary" className="text-xs">
          {annotations.audience}
        </Badge>
      )}
      {annotations.readOnly && (
        <Badge variant="default" className="text-xs">
          read-only
        </Badge>
      )}
      {annotations.destructive && (
        <Badge variant="error" className="text-xs">
          destructive
        </Badge>
      )}
      {annotations.longRunning && (
        <Badge variant="warning" className="text-xs">
          long-run
        </Badge>
      )}
      {annotations.priority !== undefined && (
        <Badge
          variant={getPriorityLabel(annotations.priority).variant}
          className="text-xs"
        >
          priority: {getPriorityLabel(annotations.priority).label}
        </Badge>
      )}
    </div>
  );
}
