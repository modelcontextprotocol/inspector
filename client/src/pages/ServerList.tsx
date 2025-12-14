import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ServerCard } from '@/components/ServerCard';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AddServerModal, ServerConfig } from '@/components/AddServerModal';
import { ImportServerJsonModal } from '@/components/ImportServerJsonModal';
import { ChevronDown, Plus, FileJson, Upload } from 'lucide-react';
import { mockServers } from '@/mocks';

export function ServerList() {
  const [addServerOpen, setAddServerOpen] = useState(false);
  const [importJsonOpen, setImportJsonOpen] = useState(false);

  const handleAddServer = (config: ServerConfig) => {
    console.log('Adding server:', config);
    // TODO: Actually add the server via proxy API
  };

  const handleImportServer = (config: {
    name: string;
    transport: string;
    command?: string;
    url?: string;
    env: Record<string, string>;
  }) => {
    console.log('Importing server:', config);
    // TODO: Actually add the server via proxy API
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto py-8 px-4">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">MCP Inspector</h1>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="flex items-center gap-1">
                + Add Server
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setAddServerOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add manually
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <Upload className="h-4 w-4 mr-2" />
                Import config
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setImportJsonOpen(true)}>
                <FileJson className="h-4 w-4 mr-2" />
                Import server.json
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {mockServers.map((server) => (
            <ServerCard key={server.id} server={server} />
          ))}
        </div>
      </div>

      {/* Modals */}
      <AddServerModal
        open={addServerOpen}
        onOpenChange={setAddServerOpen}
        onSave={handleAddServer}
      />
      <ImportServerJsonModal
        open={importJsonOpen}
        onOpenChange={setImportJsonOpen}
        onImport={handleImportServer}
      />
    </div>
  );
}
