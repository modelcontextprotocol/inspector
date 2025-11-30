import { Copy, Check, X } from 'lucide-react';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface ServerCapabilities {
  tools?: number;
  resources?: number;
  prompts?: number;
  logging?: boolean;
  completions?: boolean;
  tasks?: boolean;
  experimental?: boolean;
}

interface ClientCapabilities {
  sampling?: boolean;
  elicitation?: boolean;
  roots?: number;
  tasks?: boolean;
  experimental?: boolean;
}

interface OAuthDetails {
  authUrl?: string;
  scopes?: string[];
  accessToken?: string;
}

interface ServerInfo {
  name: string;
  version: string;
  protocolVersion: string;
  transport: 'stdio' | 'http' | 'sse';
  serverCapabilities?: ServerCapabilities;
  clientCapabilities?: ClientCapabilities;
  instructions?: string;
  oauthDetails?: OAuthDetails;
}

interface ServerInfoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: ServerInfo;
}

function CapabilityItem({
  label,
  enabled,
  count,
}: {
  label: string;
  enabled?: boolean;
  count?: number;
}) {
  const isEnabled = enabled === true || (count !== undefined && count > 0);

  return (
    <div className="flex items-center gap-2 text-sm">
      {isEnabled ? (
        <Check className="h-4 w-4 text-green-500" />
      ) : (
        <X className="h-4 w-4 text-muted-foreground" />
      )}
      <span className={!isEnabled ? 'text-muted-foreground' : ''}>
        {label}
        {count !== undefined && count > 0 && ` (${count})`}
      </span>
    </div>
  );
}

export function ServerInfoModal({
  open,
  onOpenChange,
  server,
}: ServerInfoModalProps) {
  const [copied, setCopied] = useState(false);

  const copyToken = async () => {
    if (server.oauthDetails?.accessToken) {
      await navigator.clipboard.writeText(server.oauthDetails.accessToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Server Information</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Name:</span>
              <span className="ml-2 font-medium">{server.name}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Version:</span>
              <span className="ml-2 font-medium">{server.version}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Protocol:</span>
              <span className="ml-2 font-medium">{server.protocolVersion}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Transport:</span>
              <Badge variant="outline" className="ml-2">
                {server.transport.toUpperCase()}
              </Badge>
            </div>
          </div>

          {/* Capabilities */}
          <div className="grid grid-cols-2 gap-8">
            {/* Server Capabilities */}
            <div>
              <h4 className="font-medium mb-3 border-b pb-2">
                Server Capabilities
              </h4>
              <div className="space-y-2">
                <CapabilityItem
                  label="Tools"
                  count={server.serverCapabilities?.tools}
                />
                <CapabilityItem
                  label="Resources"
                  count={server.serverCapabilities?.resources}
                />
                <CapabilityItem
                  label="Prompts"
                  count={server.serverCapabilities?.prompts}
                />
                <CapabilityItem
                  label="Logging"
                  enabled={server.serverCapabilities?.logging}
                />
                <CapabilityItem
                  label="Completions"
                  enabled={server.serverCapabilities?.completions}
                />
                <CapabilityItem
                  label="Tasks"
                  enabled={server.serverCapabilities?.tasks}
                />
                <CapabilityItem
                  label="Experimental"
                  enabled={server.serverCapabilities?.experimental}
                />
              </div>
            </div>

            {/* Client Capabilities */}
            <div>
              <h4 className="font-medium mb-3 border-b pb-2">
                Client Capabilities
              </h4>
              <div className="space-y-2">
                <CapabilityItem
                  label="Sampling"
                  enabled={server.clientCapabilities?.sampling}
                />
                <CapabilityItem
                  label="Elicitation"
                  enabled={server.clientCapabilities?.elicitation}
                />
                <CapabilityItem
                  label="Roots"
                  count={server.clientCapabilities?.roots}
                />
                <CapabilityItem
                  label="Tasks"
                  enabled={server.clientCapabilities?.tasks}
                />
                <CapabilityItem
                  label="Experimental"
                  enabled={server.clientCapabilities?.experimental}
                />
              </div>
            </div>
          </div>

          {/* Server Instructions */}
          {server.instructions && (
            <div>
              <h4 className="font-medium mb-2 border-b pb-2">
                Server Instructions
              </h4>
              <p className="text-sm text-muted-foreground italic">
                "{server.instructions}"
              </p>
            </div>
          )}

          {/* OAuth Details */}
          {server.oauthDetails && (
            <div>
              <h4 className="font-medium mb-3 border-b pb-2">OAuth Details</h4>
              <div className="space-y-2 text-sm">
                {server.oauthDetails.authUrl && (
                  <div>
                    <span className="text-muted-foreground">Auth URL:</span>
                    <span className="ml-2">{server.oauthDetails.authUrl}</span>
                  </div>
                )}
                {server.oauthDetails.scopes &&
                  server.oauthDetails.scopes.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Scopes:</span>
                      <div className="flex gap-1">
                        {server.oauthDetails.scopes.map((scope) => (
                          <Badge key={scope} variant="secondary">
                            {scope}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                {server.oauthDetails.accessToken && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Access Token:</span>
                    <code className="flex-1 px-2 py-1 bg-muted rounded text-xs font-mono truncate max-w-xs">
                      {server.oauthDetails.accessToken.slice(0, 20)}...
                    </code>
                    <Button variant="ghost" size="sm" onClick={copyToken}>
                      {copied ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
