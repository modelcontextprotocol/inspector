import { Badge } from '@mantine/core'

export type AnnotationVariant = 'audience' | 'readOnly' | 'destructive' | 'longRun' | 'priority' | 'default'

export interface AnnotationBadgeProps {
  label: string
  variant?: AnnotationVariant
}

const variantMap: Record<AnnotationVariant, { color: string; variant: string }> = {
  audience: { color: 'gray', variant: 'outline' },
  readOnly: { color: 'dark', variant: 'filled' },
  destructive: { color: 'red', variant: 'outline' },
  longRun: { color: 'yellow', variant: 'outline' },
  priority: { color: 'orange', variant: 'light' },
  default: { color: 'gray', variant: 'light' },
}

export function AnnotationBadge({ label, variant = 'default' }: AnnotationBadgeProps) {
  const { color, variant: badgeVariant } = variantMap[variant]

  return (
    <Badge color={color} variant={badgeVariant}>
      {label}
    </Badge>
  )
}
