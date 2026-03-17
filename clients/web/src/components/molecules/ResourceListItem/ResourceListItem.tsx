import { Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { AnnotationBadge } from '../../atoms/AnnotationBadge/AnnotationBadge'

export interface ResourceAnnotations {
  audience?: string
  priority?: number
}

export interface ResourceListItemProps {
  name: string
  uri: string
  annotations?: ResourceAnnotations
  selected: boolean
  onClick: () => void
}

function priorityLabel(priority: number): string {
  if (priority >= 0.7) return 'priority: high'
  if (priority >= 0.4) return 'priority: medium'
  return 'priority: low'
}

export function ResourceListItem({ name, annotations, selected, onClick }: ResourceListItemProps) {
  return (
    <UnstyledButton
      w="100%"
      p="sm"
      bg={selected ? 'var(--mantine-primary-color-light)' : undefined}
      style={{ borderRadius: 'var(--mantine-radius-md)' }}
      onClick={onClick}
    >
      <Stack gap="xs">
        <Text fw={500}>{name}</Text>
        {annotations && (
          <Group gap="xs">
            {annotations.audience && (
              <AnnotationBadge label={annotations.audience} variant="audience" />
            )}
            {annotations.priority !== undefined && (
              <AnnotationBadge label={priorityLabel(annotations.priority)} variant="priority" />
            )}
          </Group>
        )}
      </Stack>
    </UnstyledButton>
  )
}
