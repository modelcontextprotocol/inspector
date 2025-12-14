export interface ActiveTask {
  id: string;
  method: string;
  name: string;
  status: 'running' | 'waiting';
  progress: number;
  progressMessage: string | null;
  startedAt: string;
}

export interface CompletedTask {
  id: string;
  method: string;
  name: string;
  status: 'completed' | 'failed';
  progress: number;
  startedAt: string;
  completedAt: string;
  error?: string;
}

export const mockActiveTasks: ActiveTask[] = [
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

export const mockCompletedTasks: CompletedTask[] = [
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

export const taskStatusColors: Record<string, string> = {
  waiting: 'gray',
  running: 'blue',
  completed: 'green',
  failed: 'red',
  cancelled: 'orange',
};
