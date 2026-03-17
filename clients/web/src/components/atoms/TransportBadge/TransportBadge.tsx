import { Badge } from '@mantine/core'

export interface TransportBadgeProps {
  transport: 'stdio' | 'http'
}

export function TransportBadge({ transport }: TransportBadgeProps) {
  return (
    <Badge variant="outline" color="gray">
      {transport.toUpperCase()}
    </Badge>
  )
}
