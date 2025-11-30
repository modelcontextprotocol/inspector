import { Button } from '@/components/ui/button';
import { ServerCard } from '@/components/ServerCard';
import { ChevronDown } from 'lucide-react';

// Mock server data
const mockServers = [
  {
    id: 'everything-server',
    name: 'everything-server',
    version: '1.0.0',
    transport: 'stdio' as const,
    command: 'npx -y @modelcontextprotocol/server-everything',
    status: 'connected' as const,
    capabilities: { tools: 4, resources: 12, prompts: 2 },
  },
  {
    id: 'filesystem-server',
    name: 'filesystem-server',
    version: '0.6.2',
    transport: 'stdio' as const,
    command: 'npx -y @modelcontextprotocol/server-filesystem /tmp',
    status: 'disconnected' as const,
    capabilities: null,
  },
  {
    id: 'remote-server',
    name: 'remote-server',
    version: '2.1.0',
    transport: 'http' as const,
    url: 'https://api.example.com/mcp',
    status: 'failed' as const,
    retryCount: 3,
    error: 'Connection timeout after 20s',
    capabilities: null,
  },
];

export function ServerList() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto py-8 px-4">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">MCP Inspector</h1>
          <Button className="flex items-center gap-1">
            + Add Server
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {mockServers.map((server) => (
            <ServerCard key={server.id} server={server} />
          ))}
        </div>
      </div>
    </div>
  );
}
