import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

export type ServerStatus = 'connected' | 'connecting' | 'disconnected' | 'failed';

interface StatusIndicatorProps {
  status: ServerStatus;
  retryCount?: number;
}

const statusConfig: Record<ServerStatus, { variant: 'success' | 'warning' | 'default' | 'error'; label: string }> = {
  connected: { variant: 'success', label: 'Connected' },
  connecting: { variant: 'warning', label: 'Connecting...' },
  disconnected: { variant: 'default', label: 'Disconnected' },
  failed: { variant: 'error', label: 'Failed' },
};

export function StatusIndicator({ status, retryCount }: StatusIndicatorProps) {
  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-2">
      {status === 'connecting' ? (
        <Loader2 className="h-4 w-4 animate-spin text-yellow-400" />
      ) : null}
      <Badge variant={config.variant}>
        {config.label}
        {status === 'failed' && retryCount !== undefined && ` (${retryCount})`}
      </Badge>
    </div>
  );
}
