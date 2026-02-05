/**
 * Task tracking types for long-running operations
 */

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

export const taskStatusColors: Record<string, string> = {
  waiting: 'gray',
  running: 'blue',
  completed: 'green',
  failed: 'red',
  cancelled: 'orange',
};
