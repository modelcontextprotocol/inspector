import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Mock log entries
const mockLogs = [
  { timestamp: '2025-11-30T14:23:01Z', level: 'info', message: 'Server connected' },
  { timestamp: '2025-11-30T14:23:05Z', level: 'debug', message: 'Sending tools/list request' },
  { timestamp: '2025-11-30T14:23:05Z', level: 'debug', message: 'Received tools/list response: 4 tools' },
  { timestamp: '2025-11-30T14:24:12Z', level: 'info', message: 'Tool echo executed successfully' },
  { timestamp: '2025-11-30T14:25:30Z', level: 'warning', message: 'Request timeout approaching' },
];

const levelVariants: Record<string, 'default' | 'secondary' | 'warning' | 'error'> = {
  debug: 'secondary',
  info: 'default',
  warning: 'warning',
  error: 'error',
};

export function Logs() {
  return (
    <Card className="h-[calc(100vh-120px)]">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle>Server Logs</CardTitle>
          <Select defaultValue="debug">
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="debug">Debug</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {mockLogs.map((log, index) => (
            <div key={index} className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground font-mono">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <Badge variant={levelVariants[log.level]} className="uppercase text-xs">
                {log.level}
              </Badge>
              <span className="text-sm">{log.message}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
