import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Mock history data
const mockHistory = [
  {
    id: 'req-1',
    timestamp: '2025-11-30T14:24:12Z',
    method: 'tools/call',
    target: 'echo',
    duration: 45,
    success: true,
  },
  {
    id: 'req-2',
    timestamp: '2025-11-30T14:23:05Z',
    method: 'tools/list',
    target: null,
    duration: 12,
    success: true,
  },
  {
    id: 'req-3',
    timestamp: '2025-11-30T14:22:00Z',
    method: 'resources/read',
    target: 'file:///config.json',
    duration: 8,
    success: true,
  },
  {
    id: 'req-4',
    timestamp: '2025-11-30T14:21:30Z',
    method: 'prompts/get',
    target: 'greeting_prompt',
    duration: 0,
    success: false,
  },
];

export function History() {
  return (
    <Card className="h-[calc(100vh-120px)]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Request History</CardTitle>
          <div className="flex gap-2">
            <Input placeholder="Search..." className="w-48" />
            <Select>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Filter by method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tools/call">tools/call</SelectItem>
                <SelectItem value="tools/list">tools/list</SelectItem>
                <SelectItem value="resources/read">resources/read</SelectItem>
                <SelectItem value="prompts/get">prompts/get</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <table className="w-full">
          <thead>
            <tr className="text-left text-sm text-muted-foreground border-b">
              <th className="pb-2 font-medium">Time</th>
              <th className="pb-2 font-medium">Method</th>
              <th className="pb-2 font-medium">Target</th>
              <th className="pb-2 font-medium">Duration</th>
              <th className="pb-2 font-medium">Status</th>
              <th className="pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {mockHistory.map((entry) => (
              <tr key={entry.id} className="border-b last:border-0">
                <td className="py-3 font-mono text-sm">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </td>
                <td className="py-3">
                  <Badge variant="secondary">{entry.method}</Badge>
                </td>
                <td className="py-3 text-sm">
                  {entry.target || (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
                <td className="py-3 text-sm">{entry.duration}ms</td>
                <td className="py-3">
                  <Badge variant={entry.success ? 'success' : 'error'}>
                    {entry.success ? 'OK' : 'Error'}
                  </Badge>
                </td>
                <td className="py-3">
                  <Button variant="ghost" size="sm">
                    Replay
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
