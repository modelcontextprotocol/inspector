import { useState, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type TransportType = 'stdio' | 'http' | 'sse';

interface EnvVar {
  key: string;
  value: string;
}

export interface ServerConfig {
  id?: string;
  name: string;
  transport: TransportType;
  command?: string;
  url?: string;
  env: Record<string, string>;
}

interface AddServerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server?: ServerConfig;
  onSave: (config: ServerConfig) => void;
}

export function AddServerModal({
  open,
  onOpenChange,
  server,
  onSave,
}: AddServerModalProps) {
  const isEditMode = !!server;

  const [name, setName] = useState('');
  const [transport, setTransport] = useState<TransportType>('stdio');
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);

  // Reset form when modal opens/closes or server changes
  useEffect(() => {
    if (open && server) {
      setName(server.name);
      setTransport(server.transport);
      setCommand(server.command || '');
      setUrl(server.url || '');
      setEnvVars(
        Object.entries(server.env || {}).map(([key, value]) => ({
          key,
          value,
        }))
      );
    } else if (open && !server) {
      setName('');
      setTransport('stdio');
      setCommand('');
      setUrl('');
      setEnvVars([]);
    }
  }, [open, server]);

  const addEnvVar = () => {
    setEnvVars([...envVars, { key: '', value: '' }]);
  };

  const removeEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  const updateEnvVar = (
    index: number,
    field: 'key' | 'value',
    value: string
  ) => {
    const updated = [...envVars];
    updated[index][field] = value;
    setEnvVars(updated);
  };

  const handleSave = () => {
    const env: Record<string, string> = {};
    envVars.forEach(({ key, value }) => {
      if (key.trim()) {
        env[key.trim()] = value;
      }
    });

    const config: ServerConfig = {
      id: server?.id,
      name: name.trim(),
      transport,
      env,
    };

    if (transport === 'stdio') {
      config.command = command.trim();
    } else {
      config.url = url.trim();
    }

    onSave(config);
    onOpenChange(false);
  };

  const isValid = () => {
    if (!name.trim()) return false;
    if (transport === 'stdio' && !command.trim()) return false;
    if ((transport === 'http' || transport === 'sse') && !url.trim())
      return false;
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? 'Edit Server' : 'Add Server'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Server Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Server Name *</Label>
            <Input
              id="name"
              placeholder="my-mcp-server"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Transport Type */}
          <div className="space-y-2">
            <Label htmlFor="transport">Transport Type *</Label>
            <Select
              value={transport}
              onValueChange={(v) => setTransport(v as TransportType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">STDIO</SelectItem>
                <SelectItem value="http">HTTP</SelectItem>
                <SelectItem value="sse">SSE</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Command (for STDIO) */}
          {transport === 'stdio' && (
            <div className="space-y-2">
              <Label htmlFor="command">Command *</Label>
              <Input
                id="command"
                placeholder="npx -y @modelcontextprotocol/server-everything"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The command to run the MCP server
              </p>
            </div>
          )}

          {/* URL (for HTTP/SSE) */}
          {(transport === 'http' || transport === 'sse') && (
            <div className="space-y-2">
              <Label htmlFor="url">Server URL *</Label>
              <Input
                id="url"
                placeholder="https://api.example.com/mcp"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
          )}

          {/* Environment Variables */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Environment Variables</Label>
              <Button variant="ghost" size="sm" onClick={addEnvVar}>
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
            {envVars.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No environment variables configured
              </p>
            ) : (
              <div className="space-y-2">
                {envVars.map((env, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      placeholder="KEY"
                      value={env.key}
                      onChange={(e) => updateEnvVar(index, 'key', e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="value"
                      value={env.value}
                      onChange={(e) =>
                        updateEnvVar(index, 'value', e.target.value)
                      }
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeEnvVar(index)}
                    >
                      <Trash2 className="h-4 w-4 text-red-400" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isValid()}>
            {isEditMode ? 'Save Changes' : 'Add Server'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
