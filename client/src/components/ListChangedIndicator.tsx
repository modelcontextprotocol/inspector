import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ListChangedIndicatorProps {
  hasChanges: boolean;
  onRefresh: () => void;
  label?: string;
}

export function ListChangedIndicator({
  hasChanges,
  onRefresh,
  label = 'List updated',
}: ListChangedIndicatorProps) {
  if (!hasChanges) return null;

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
        <span className="text-muted-foreground">{label}</span>
      </span>
      <Button variant="ghost" size="sm" onClick={onRefresh} className="h-7">
        <RefreshCw className="h-3.5 w-3.5 mr-1" />
        Refresh
      </Button>
    </div>
  );
}
