/**
 * Mock server data for testing
 */

import type { ServerDisplayModel } from '@modelcontextprotocol/inspector-core';

// Mock servers for demo/testing
export const mockServers: ServerDisplayModel[] = [
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
