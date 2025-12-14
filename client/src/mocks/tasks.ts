// Mock tasks data
export interface Task {
  id: string;
  method: string;
  name: string;
  status: string;
  progress: number;
  progressMessage?: string | null;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export const mockActiveTasks: Task[] = [
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

export const mockCompletedTasks: Task[] = [
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

export const taskStatusVariants: Record<string, 'default' | 'secondary' | 'success' | 'error' | 'warning'> = {
  waiting: 'secondary',
  running: 'default',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
};
