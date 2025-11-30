import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// Mock tasks data
const mockTasks = [
  {
    id: 'task-1',
    name: 'longRunningOperation',
    status: 'running',
    progress: 45,
    startedAt: '2025-11-30T14:24:00Z',
  },
  {
    id: 'task-2',
    name: 'dataSync',
    status: 'completed',
    progress: 100,
    startedAt: '2025-11-30T14:20:00Z',
    completedAt: '2025-11-30T14:22:30Z',
  },
];

const statusVariants: Record<string, 'default' | 'secondary' | 'success' | 'error' | 'warning'> = {
  pending: 'secondary',
  running: 'default',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
};

export function Tasks() {
  return (
    <Card className="h-[calc(100vh-120px)]">
      <CardHeader>
        <CardTitle>Background Tasks</CardTitle>
      </CardHeader>
      <CardContent>
        {mockTasks.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No active tasks</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-muted-foreground border-b">
                <th className="pb-2 font-medium">Task</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Progress</th>
                <th className="pb-2 font-medium">Started</th>
              </tr>
            </thead>
            <tbody>
              {mockTasks.map((task) => (
                <tr key={task.id} className="border-b last:border-0">
                  <td className="py-3">{task.name}</td>
                  <td className="py-3">
                    <Badge variant={statusVariants[task.status]}>
                      {task.status}
                    </Badge>
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {task.progress}%
                      </span>
                    </div>
                  </td>
                  <td className="py-3 text-sm">
                    {new Date(task.startedAt).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
