import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusIndicator, ServerStatus } from './StatusIndicator';
import { ServerInfoModal } from './ServerInfoModal';
import { AddServerModal, ServerConfig } from './AddServerModal';
import { SamplingModal } from './SamplingModal';
import { ElicitationModal } from './ElicitationModal';
import { RootsConfigurationModal } from './RootsConfigurationModal';
import { ServerSettingsModal, ServerSettings } from './ServerSettingsModal';
import { OAuthDebuggerModal } from './OAuthDebuggerModal';
import {
  Copy,
  ChevronDown,
  MessageSquare,
  FormInput,
  Link,
  FolderTree,
  Files,
  ExternalLink,
  AlertTriangle,
  Settings,
  KeyRound,
} from 'lucide-react';

interface ServerCardProps {
  server: {
    id: string;
    name: string;
    version: string;
    transport: 'stdio' | 'http' | 'sse';
    command?: string;
    url?: string;
    status: ServerStatus;
    retryCount?: number;
    error?: string;
    capabilities: {
      tools: number;
      resources: number;
      prompts: number;
    } | null;
    oauth?: boolean; // Whether server uses OAuth authentication
  };
}

export function ServerCard({ server }: ServerCardProps) {
  const navigate = useNavigate();
  const [showError, setShowError] = useState(false);
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  // Client feature modal states
  const [samplingModalOpen, setSamplingModalOpen] = useState(false);
  const [elicitationModalOpen, setElicitationModalOpen] = useState(false);
  const [elicitationMode, setElicitationMode] = useState<'form' | 'url'>('form');
  const [rootsModalOpen, setRootsModalOpen] = useState(false);
  const [cloneModalOpen, setCloneModalOpen] = useState(false);
  const [clonedConfig, setClonedConfig] = useState<ServerConfig | null>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [oauthDebugModalOpen, setOauthDebugModalOpen] = useState(false);

  const connectionString = server.command || server.url || '';

  const handleToggle = () => {
    if (server.status === 'connected') {
      // Would disconnect
    } else {
      // Would connect, then navigate
      navigate('/tools', { state: { server } });
    }
  };

  const handleEdit = (config: ServerConfig) => {
    console.log('Editing server:', config);
    // TODO: Actually update the server via proxy API
  };

  const handleRemove = () => {
    if (confirm(`Remove server "${server.name}"?`)) {
      console.log('Removing server:', server.id);
      // TODO: Actually remove the server via proxy API
    }
  };

  const handleClone = () => {
    const cloned: ServerConfig = {
      id: `${server.id}-copy-${Date.now()}`,
      name: `${server.name} (Copy)`,
      transport: server.transport,
      command: server.command,
      url: server.url,
      env: {},
    };
    setClonedConfig(cloned);
    setCloneModalOpen(true);
  };

  const handleCloneSave = (config: ServerConfig) => {
    console.log('Creating cloned server:', config);
    // TODO: Actually create the server via proxy API
    setCloneModalOpen(false);
    setClonedConfig(null);
  };

  const handleSettingsSave = (settings: ServerSettings) => {
    console.log('Saving server settings:', settings);
    // TODO: Actually save settings via proxy API
  };

  // Build server info for the modal
  const serverInfo = {
    name: server.name,
    version: server.version,
    protocolVersion: '2025-11-25',
    transport: server.transport,
    serverCapabilities: server.capabilities
      ? {
          tools: server.capabilities.tools,
          resources: server.capabilities.resources,
          prompts: server.capabilities.prompts,
          logging: true,
          completions: false,
          tasks: false,
          experimental: false,
        }
      : undefined,
    clientCapabilities: server.capabilities
      ? {
          sampling: true,
          elicitation: true,
          roots: 3,
          tasks: true,
          experimental: false,
        }
      : undefined,
    instructions:
      server.status === 'connected'
        ? 'This server provides testing tools for MCP development.'
        : undefined,
  };

  // Build server config for edit modal
  const serverConfig: ServerConfig = {
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command,
    url: server.url,
    env: {},
  };

  return (
    <>
      <Card>
        <CardContent className="p-6 space-y-4">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`text-lg font-semibold ${server.status === 'connected' ? 'cursor-pointer hover:underline' : ''}`}
                onClick={() => {
                  if (server.status === 'connected') {
                    navigate('/tools', { state: { server } });
                  }
                }}
              >
                {server.name}
              </span>
              <Badge variant="secondary">v{server.version}</Badge>
            </div>
            <div className="flex items-center gap-3">
              <StatusIndicator
                status={server.status}
                retryCount={server.retryCount}
              />
              <Switch
                checked={server.status === 'connected'}
                onCheckedChange={handleToggle}
              />
            </div>
          </div>

          {/* Transport badge */}
          <Badge variant="outline">{server.transport.toUpperCase()}</Badge>

          {/* Connection string */}
          <div className="flex items-center gap-2">
            <code className="flex-1 px-2 py-1 bg-muted rounded text-sm font-mono truncate">
              {connectionString}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigator.clipboard.writeText(connectionString)}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>

          {/* Error display (if failed) */}
          {server.status === 'failed' && server.error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-red-400">
                    {server.error.slice(0, 100)}
                    {server.error.length > 100 && '...'}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto py-1 px-2 text-xs"
                  onClick={() => setShowError(!showError)}
                >
                  {showError ? 'Hide details' : 'Show more'}
                </Button>
                <a
                  href="https://modelcontextprotocol.io/docs/troubleshooting"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  View Troubleshooting Guide
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              {showError && (
                <code className="block p-2 bg-muted rounded text-xs font-mono overflow-auto max-h-32">
                  {server.error}
                </code>
              )}
            </div>
          )}

          {/* Actions row */}
          <div className="flex items-center justify-between pt-2">
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setInfoModalOpen(true)}
              >
                Server Info
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSettingsModalOpen(true)}
              >
                <Settings className="h-4 w-4 mr-1" />
                Settings
              </Button>
              {/* OAuth Debug button - only for OAuth-enabled servers */}
              {server.oauth && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setOauthDebugModalOpen(true)}
                >
                  <KeyRound className="h-4 w-4 mr-1" />
                  OAuth Debug
                </Button>
              )}
              {/* Test Client Features dropdown - only for connected servers */}
              {server.status === 'connected' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      Test Client Features
                      <ChevronDown className="h-4 w-4 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onClick={() => setSamplingModalOpen(true)}
                    >
                      <MessageSquare className="h-4 w-4 mr-2" />
                      Simulate Sampling Request
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setElicitationMode('form');
                        setElicitationModalOpen(true);
                      }}
                    >
                      <FormInput className="h-4 w-4 mr-2" />
                      Simulate Elicitation (Form)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setElicitationMode('url');
                        setElicitationModalOpen(true);
                      }}
                    >
                      <Link className="h-4 w-4 mr-2" />
                      Simulate Elicitation (URL)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setRootsModalOpen(true)}>
                      <FolderTree className="h-4 w-4 mr-2" />
                      Configure Roots
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={handleClone}>
                <Files className="h-4 w-4 mr-1" />
                Clone
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditModalOpen(true)}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-400 hover:text-red-300"
                onClick={handleRemove}
              >
                Remove
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Modals */}
      <ServerInfoModal
        open={infoModalOpen}
        onOpenChange={setInfoModalOpen}
        server={serverInfo}
      />
      <AddServerModal
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
        server={serverConfig}
        onSave={handleEdit}
      />
      {clonedConfig && (
        <AddServerModal
          open={cloneModalOpen}
          onOpenChange={(open) => {
            setCloneModalOpen(open);
            if (!open) setClonedConfig(null);
          }}
          server={clonedConfig}
          onSave={handleCloneSave}
        />
      )}
      <ServerSettingsModal
        open={settingsModalOpen}
        onOpenChange={setSettingsModalOpen}
        serverName={server.name}
        onSave={handleSettingsSave}
      />
      <OAuthDebuggerModal
        open={oauthDebugModalOpen}
        onOpenChange={setOauthDebugModalOpen}
        serverName={server.name}
      />

      {/* Client Feature Modals */}
      <SamplingModal
        open={samplingModalOpen}
        onOpenChange={setSamplingModalOpen}
      />
      <ElicitationModal
        open={elicitationModalOpen}
        onOpenChange={setElicitationModalOpen}
        mode={elicitationMode}
      />
      <RootsConfigurationModal
        open={rootsModalOpen}
        onOpenChange={setRootsModalOpen}
      />
    </>
  );
}
