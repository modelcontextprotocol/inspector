import type { ConnectionMode } from '../components/ServerCard';

export interface MockServer {
  id: string;
  name: string;
  version: string;
  transport: 'stdio' | 'http';
  command?: string;
  url?: string;
  status: 'connected' | 'disconnected' | 'failed';
  capabilities: { tools: number; resources: number; prompts: number } | null;
  retryCount?: number;
  error?: string;
  connectionMode?: ConnectionMode;
}

export const mockServers: MockServer[] = [
  {
    id: 'everything-server',
    name: 'everything-server',
    version: '1.0.0',
    transport: 'stdio',
    command: 'npx -y @modelcontextprotocol/server-everything',
    status: 'connected',
    capabilities: { tools: 4, resources: 12, prompts: 2 },
  },
  {
    id: 'filesystem-server',
    name: 'filesystem-server',
    version: '0.6.2',
    transport: 'stdio',
    command: 'npx -y @modelcontextprotocol/server-filesystem /tmp',
    status: 'disconnected',
    capabilities: null,
  },
  {
    id: 'remote-server',
    name: 'remote-server',
    version: '2.1.0',
    transport: 'http',
    url: 'https://api.example.com/mcp',
    status: 'failed',
    retryCount: 3,
    error: 'Connection timeout after 20s',
    capabilities: null,
  },
];
