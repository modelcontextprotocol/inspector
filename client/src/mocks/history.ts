export interface HistoryEntry {
  id: string;
  timestamp: string;
  method: string;
  target: string | null;
  params?: Record<string, unknown>;
  response?: Record<string, unknown>;
  duration: number;
  success: boolean;
  pinned: boolean;
  label?: string;
  sseId?: string;
  progressToken?: string;
}

export const initialHistory: HistoryEntry[] = [
  {
    id: 'req-1',
    timestamp: '2025-11-30T14:24:12Z',
    method: 'tools/call',
    target: 'echo',
    params: { message: 'Hello world' },
    response: { content: [{ type: 'text', text: 'Hello world' }] },
    duration: 45,
    success: true,
    pinned: true,
    label: 'Test echo',
    sseId: 'evt-12345',
  },
  {
    id: 'req-2',
    timestamp: '2025-11-30T14:23:05Z',
    method: 'tools/list',
    target: null,
    params: {},
    response: { tools: ['echo', 'add', 'longOp'] },
    duration: 12,
    success: true,
    pinned: false,
    sseId: 'evt-12344',
  },
  {
    id: 'req-3',
    timestamp: '2025-11-30T14:22:00Z',
    method: 'resources/read',
    target: 'file:///config.json',
    params: { uri: 'file:///config.json' },
    response: { name: 'my-app', version: '1.0.0' },
    duration: 8,
    success: true,
    pinned: true,
    label: 'Get config',
    sseId: 'evt-12343',
    progressToken: 'prog-abc123',
  },
  {
    id: 'req-4',
    timestamp: '2025-11-30T14:21:30Z',
    method: 'prompts/get',
    target: 'greeting_prompt',
    params: { name: 'greeting_prompt', arguments: { name: 'John' } },
    response: { error: 'Prompt not found' },
    duration: 0,
    success: false,
    pinned: false,
  },
];
