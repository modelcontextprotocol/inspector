import { useState, useEffect } from 'react';
import { Plus, Trash2, Eye, EyeOff } from 'lucide-react';
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

type ConnectionMode = 'direct' | 'proxy';

interface KeyValuePair {
  key: string;
  value: string;
}

export interface ServerSettings {
  connectionMode: ConnectionMode;
  headers: Record<string, string>;
  metadata: Record<string, string>;
  connectionTimeout: number;
  requestTimeout: number;
  oauth?: {
    clientId: string;
    clientSecret: string;
    scopes: string;
  };
}

interface ServerSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverName: string;
  settings?: ServerSettings;
  onSave: (settings: ServerSettings) => void;
}

const defaultSettings: ServerSettings = {
  connectionMode: 'proxy',
  headers: {},
  metadata: {},
  connectionTimeout: 30000,
  requestTimeout: 60000,
};

export function ServerSettingsModal({
  open,
  onOpenChange,
  serverName,
  settings,
  onSave,
}: ServerSettingsModalProps) {
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('proxy');
  const [headers, setHeaders] = useState<KeyValuePair[]>([]);
  const [metadata, setMetadata] = useState<KeyValuePair[]>([]);
  const [connectionTimeout, setConnectionTimeout] = useState(30000);
  const [requestTimeout, setRequestTimeout] = useState(60000);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [scopes, setScopes] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  // Reset form when modal opens or settings change
  useEffect(() => {
    if (open) {
      const s = settings || defaultSettings;
      setConnectionMode(s.connectionMode);
      setHeaders(
        Object.entries(s.headers).map(([key, value]) => ({ key, value }))
      );
      setMetadata(
        Object.entries(s.metadata).map(([key, value]) => ({ key, value }))
      );
      setConnectionTimeout(s.connectionTimeout);
      setRequestTimeout(s.requestTimeout);
      setClientId(s.oauth?.clientId || '');
      setClientSecret(s.oauth?.clientSecret || '');
      setScopes(s.oauth?.scopes || '');
      setShowSecret(false);
    }
  }, [open, settings]);

  const addHeader = () => {
    setHeaders([...headers, { key: '', value: '' }]);
  };

  const removeHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index));
  };

  const updateHeader = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...headers];
    updated[index][field] = value;
    setHeaders(updated);
  };

  const addMetadata = () => {
    setMetadata([...metadata, { key: '', value: '' }]);
  };

  const removeMetadata = (index: number) => {
    setMetadata(metadata.filter((_, i) => i !== index));
  };

  const updateMetadata = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...metadata];
    updated[index][field] = value;
    setMetadata(updated);
  };

  const handleSave = () => {
    const headersObj: Record<string, string> = {};
    headers.forEach(({ key, value }) => {
      if (key.trim()) {
        headersObj[key.trim()] = value;
      }
    });

    const metadataObj: Record<string, string> = {};
    metadata.forEach(({ key, value }) => {
      if (key.trim()) {
        metadataObj[key.trim()] = value;
      }
    });

    const newSettings: ServerSettings = {
      connectionMode,
      headers: headersObj,
      metadata: metadataObj,
      connectionTimeout,
      requestTimeout,
    };

    // Only include OAuth if at least clientId is set
    if (clientId.trim()) {
      newSettings.oauth = {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        scopes: scopes.trim(),
      };
    }

    onSave(newSettings);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Server Settings: {serverName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Connection Mode */}
          <div className="space-y-2">
            <Label htmlFor="connectionMode">Connection Mode</Label>
            <Select
              value={connectionMode}
              onValueChange={(v) => setConnectionMode(v as ConnectionMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">Direct</SelectItem>
                <SelectItem value="proxy">Via Proxy</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {connectionMode === 'direct'
                ? 'Connect directly to server (requires CORS support)'
                : 'Route through inspector proxy (required for STDIO)'}
            </p>
          </div>

          <hr className="border-border" />

          {/* Custom Headers */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Custom Headers</Label>
              <Button variant="ghost" size="sm" onClick={addHeader}>
                <Plus className="h-4 w-4 mr-1" />
                Add Header
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Headers sent with every HTTP request to this server
            </p>
            {headers.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                No custom headers configured
              </p>
            ) : (
              <div className="space-y-2">
                {headers.map((header, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      placeholder="Header-Name"
                      value={header.key}
                      onChange={(e) => updateHeader(index, 'key', e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="value"
                      value={header.value}
                      onChange={(e) => updateHeader(index, 'value', e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeHeader(index)}
                    >
                      <Trash2 className="h-4 w-4 text-red-400" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <hr className="border-border" />

          {/* Request Metadata */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Request Metadata</Label>
              <Button variant="ghost" size="sm" onClick={addMetadata}>
                <Plus className="h-4 w-4 mr-1" />
                Add Metadata
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Metadata sent with every MCP request to this server (included in _meta field)
            </p>
            {metadata.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                No request metadata configured
              </p>
            ) : (
              <div className="space-y-2">
                {metadata.map((meta, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      placeholder="key"
                      value={meta.key}
                      onChange={(e) => updateMetadata(index, 'key', e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="value"
                      value={meta.value}
                      onChange={(e) => updateMetadata(index, 'value', e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeMetadata(index)}
                    >
                      <Trash2 className="h-4 w-4 text-red-400" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <hr className="border-border" />

          {/* Timeouts */}
          <div className="space-y-2">
            <Label>Timeouts</Label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="connectionTimeout" className="text-sm font-normal">
                  Connection Timeout
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="connectionTimeout"
                    type="number"
                    min={1000}
                    step={1000}
                    value={connectionTimeout}
                    onChange={(e) => setConnectionTimeout(parseInt(e.target.value) || 30000)}
                    className="flex-1"
                  />
                  <span className="text-sm text-muted-foreground">ms</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="requestTimeout" className="text-sm font-normal">
                  Request Timeout
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="requestTimeout"
                    type="number"
                    min={1000}
                    step={1000}
                    value={requestTimeout}
                    onChange={(e) => setRequestTimeout(parseInt(e.target.value) || 60000)}
                    className="flex-1"
                  />
                  <span className="text-sm text-muted-foreground">ms</span>
                </div>
              </div>
            </div>
          </div>

          <hr className="border-border" />

          {/* OAuth Settings */}
          <div className="space-y-4">
            <div>
              <Label>OAuth Settings</Label>
              <p className="text-xs text-muted-foreground">
                Pre-configure OAuth credentials for servers requiring authentication
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="clientId" className="text-sm font-normal">
                Client ID
              </Label>
              <Input
                id="clientId"
                placeholder="my-client-id"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="clientSecret" className="text-sm font-normal">
                Client Secret
              </Label>
              <div className="flex gap-2">
                <Input
                  id="clientSecret"
                  type={showSecret ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowSecret(!showSecret)}
                  type="button"
                >
                  {showSecret ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="scopes" className="text-sm font-normal">
                Scopes
              </Label>
              <Input
                id="scopes"
                placeholder="read write profile"
                value={scopes}
                onChange={(e) => setScopes(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Space-separated list of OAuth scopes to request
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Settings</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
