import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { RefreshCw } from 'lucide-react';

// Mock tasks data
const mockActiveTasks = [
  {
    id: 'abc-123',
    method: 'tools/call',
    name: 'longRunningOperation',
    status: 'running',
    progress: 80,
    progressMessage: 'Processing batch 4 of 5...',
    startedAt: '2025-11-30T14:32:05Z',
  },
  {
    id: 'def-456',
    method: 'resources/read',
    name: 'large-dataset',
    status: 'waiting',
    progress: 0,
    progressMessage: null,
    startedAt: '2025-11-30T14:33:00Z',
  },
];

const mockCompletedTasks = [
  {
    id: 'ghi-789',
    method: 'tools/call',
    name: 'processData',
    status: 'completed',
    progress: 100,
    startedAt: '2025-11-30T14:30:00Z',
    completedAt: '2025-11-30T14:31:30Z',
  },
  {
    id: 'jkl-012',
    method: 'resources/read',
    name: 'config-file',
    status: 'failed',
    progress: 45,
    error: 'Resource not found',
    startedAt: '2025-11-30T14:28:00Z',
    completedAt: '2025-11-30T14:28:15Z',
  },
];

const statusVariants: Record<string, 'default' | 'secondary' | 'success' | 'error' | 'warning'> = {
  waiting: 'secondary',
  running: 'default',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
};

function formatElapsed(startedAt: string, endedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatDuration(startedAt: string, completedAt: string): string {
  return formatElapsed(startedAt, completedAt);
}

interface TaskCardProps {
  task: {
    id: string;
    method: string;
    name: string;
    status: string;
    progress: number;
    progressMessage?: string | null;
    startedAt: string;
    completedAt?: string;
    error?: string;
  };
  showActions?: boolean;
}

function TaskCard({ task, showActions = true }: TaskCardProps) {
  const isActive = task.status === 'running' || task.status === 'waiting';
  const isCompleted = task.status === 'completed';
  const isFailed = task.status === 'failed';

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-muted-foreground">
              Task: {task.id}
            </span>
            <Badge variant={statusVariants[task.status]}>
              {task.status}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Progress value={task.progress} className="w-24" />
            <span className="text-sm text-muted-foreground w-12 text-right">
              {task.progress}%
            </span>
          </div>
        </div>

        {/* Details */}
        <div className="text-sm space-y-1">
          <p>
            <span className="text-muted-foreground">Method:</span>{' '}
            {task.method}
          </p>
          <p>
            <span className="text-muted-foreground">
              {task.method === 'tools/call' ? 'Tool:' : 'Resource:'}
            </span>{' '}
            {task.name}
          </p>
          <p>
            <span className="text-muted-foreground">
              {isActive ? 'Started:' : 'Completed:'}
            </span>{' '}
            {new Date(task.completedAt || task.startedAt).toLocaleTimeString()}
            <span className="text-muted-foreground ml-4">
              {isActive ? 'Elapsed:' : 'Duration:'}
            </span>{' '}
            {isActive
              ? formatElapsed(task.startedAt)
              : formatDuration(task.startedAt, task.completedAt!)}
          </p>
          {task.progressMessage && (
            <p className="text-muted-foreground">
              Progress: {task.progressMessage}
            </p>
          )}
          {isFailed && task.error && (
            <p className="text-red-400">Error: {task.error}</p>
          )}
        </div>

        {/* Actions */}
        {showActions && (
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm">
              {isCompleted || isFailed ? 'View Result' : 'View Details'}
            </Button>
            {isActive ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-red-400 hover:text-red-300"
              >
                Cancel
              </Button>
            ) : (
              <Button variant="ghost" size="sm">
                Dismiss
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function Tasks() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Tasks</h2>
        <Button variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Active Tasks */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold">
          Active Tasks ({mockActiveTasks.length})
        </h3>
        {mockActiveTasks.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              No active tasks
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {mockActiveTasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>

      {/* Completed Tasks */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            Completed Tasks ({mockCompletedTasks.length})
          </h3>
          <Button variant="ghost" size="sm">
            Clear History
          </Button>
        </div>
        {mockCompletedTasks.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              No completed tasks
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {mockCompletedTasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
