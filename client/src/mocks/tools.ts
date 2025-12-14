export interface Tool {
  name: string;
  description: string;
  annotations?: {
    audience?: 'user' | 'assistant';
    readOnly?: boolean;
    destructive?: boolean;
    longRunning?: boolean;
    hints?: string;
  };
}

export const mockTools: Tool[] = [
  {
    name: 'query_db',
    description: 'Queries the database and returns results',
    annotations: { audience: 'user', readOnly: true },
  },
  {
    name: 'echo',
    description: 'Echoes the input message',
    annotations: {},
  },
  {
    name: 'add',
    description: 'Adds two numbers together',
    annotations: {},
  },
  {
    name: 'longOp',
    description: 'A long-running operation for testing',
    annotations: { longRunning: true, hints: 'May take several minutes to complete' },
  },
  {
    name: 'dangerOp',
    description: 'Performs a destructive operation',
    annotations: { destructive: true },
  },
];
