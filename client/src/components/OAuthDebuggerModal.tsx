import { useState } from 'react';
import { Copy, Check, ChevronDown, ChevronRight, RefreshCw, XCircle, ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type StepStatus = 'pending' | 'completed' | 'active' | 'error';

interface OAuthStep {
  title: string;
  status: StepStatus;
  content?: string;
  details?: Record<string, string>;
}

export interface OAuthState {
  authorizationUrl?: string;
  authorizationCode?: string;
  state?: string;
  stateVerified?: boolean;
  tokenEndpoint?: string;
  accessToken?: string;
  tokenType?: string;
  expiresIn?: number;
  expiresAt?: Date;
  refreshToken?: string;
  scopes?: string[];
  decodedToken?: {
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
  };
}

interface OAuthDebuggerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverName: string;
  oauthState?: OAuthState;
  onRefreshToken?: () => void;
  onRevokeToken?: () => void;
  onStartNewFlow?: () => void;
}

// Mock OAuth state for UI prototyping
const mockOAuthState: OAuthState = {
  authorizationUrl: 'https://auth.example.com/authorize?client_id=my-client-id&redirect_uri=http://localhost:5173/callback&response_type=code&scope=read%20write&state=abc123xyz',
  authorizationCode: 'xyz789def456abc123',
  state: 'abc123xyz',
  stateVerified: true,
  tokenEndpoint: 'https://auth.example.com/token',
  accessToken: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzIiwiYXVkIjoibXktY2xpZW50LWlkIiwic2NvcGUiOiJyZWFkIHdyaXRlIiwiZXhwIjoxNzM1MzAwMDAwLCJpYXQiOjE3MzUyOTY0MDB9.signature',
  tokenType: 'Bearer',
  expiresIn: 3600,
  expiresAt: new Date(Date.now() + 3600 * 1000),
  refreshToken: 'def456ghi789jkl012mno345',
  scopes: ['read', 'write'],
  decodedToken: {
    header: { alg: 'RS256', typ: 'JWT' },
    payload: {
      sub: 'user123',
      aud: 'my-client-id',
      scope: 'read write',
      exp: 1735300000,
      iat: 1735296400,
    },
  },
};

function StepCard({
  step,
  index,
  expanded,
  onToggle,
  children,
}: {
  step: OAuthStep;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const statusColors: Record<StepStatus, string> = {
    pending: 'bg-muted text-muted-foreground',
    completed: 'bg-green-500/20 text-green-400',
    active: 'bg-blue-500/20 text-blue-400',
    error: 'bg-red-500/20 text-red-400',
  };

  const statusLabels: Record<StepStatus, string> = {
    pending: 'Pending',
    completed: 'Completed',
    active: 'Active',
    error: 'Error',
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <span className="font-medium">Step {index + 1}: {step.title}</span>
        </div>
        <Badge className={statusColors[step.status]}>{statusLabels[step.status]}</Badge>
      </button>
      {expanded && (
        <div className="p-3 pt-0 border-t border-border bg-muted/30">
          {children}
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="ghost" size="sm" onClick={handleCopy}>
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

function CodeBlock({ children, copyable }: { children: string; copyable?: boolean }) {
  return (
    <div className="relative">
      <pre className="p-3 bg-muted rounded text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
        {children}
      </pre>
      {copyable && (
        <div className="absolute top-1 right-1">
          <CopyButton text={children} />
        </div>
      )}
    </div>
  );
}

export function OAuthDebuggerModal({
  open,
  onOpenChange,
  serverName,
  oauthState = mockOAuthState,
  onRefreshToken,
  onRevokeToken,
  onStartNewFlow,
}: OAuthDebuggerModalProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set([0, 1, 2, 3]));

  const toggleStep = (index: number) => {
    const newExpanded = new Set(expandedSteps);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedSteps(newExpanded);
  };

  const steps: OAuthStep[] = [
    {
      title: 'Authorization Request',
      status: oauthState.authorizationUrl ? 'completed' : 'pending',
    },
    {
      title: 'Authorization Code',
      status: oauthState.authorizationCode ? 'completed' : 'pending',
    },
    {
      title: 'Token Exchange',
      status: oauthState.accessToken ? 'completed' : 'pending',
    },
    {
      title: 'Access Token',
      status: oauthState.accessToken ? 'active' : 'pending',
    },
  ];

  const formatExpiration = () => {
    if (!oauthState.expiresAt) return 'Unknown';
    const now = new Date();
    const diff = oauthState.expiresAt.getTime() - now.getTime();
    if (diff <= 0) return 'Expired';
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}m ${seconds}s remaining`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>OAuth Debugger: {serverName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            OAuth Flow Status
          </div>

          {/* Step 1: Authorization Request */}
          <StepCard
            step={steps[0]}
            index={0}
            expanded={expandedSteps.has(0)}
            onToggle={() => toggleStep(0)}
          >
            {oauthState.authorizationUrl ? (
              <div className="space-y-2 mt-2">
                <div className="text-xs text-muted-foreground">Authorization URL:</div>
                <CodeBlock copyable>
                  {oauthState.authorizationUrl}
                </CodeBlock>
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={oauthState.authorizationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open URL
                      <ExternalLink className="h-3 w-3 ml-1" />
                    </a>
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mt-2">
                No authorization request initiated yet.
              </p>
            )}
          </StepCard>

          {/* Step 2: Authorization Code */}
          <StepCard
            step={steps[1]}
            index={1}
            expanded={expandedSteps.has(1)}
            onToggle={() => toggleStep(1)}
          >
            {oauthState.authorizationCode ? (
              <div className="space-y-2 mt-2">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">code: </span>
                    <code className="text-xs">{oauthState.authorizationCode.slice(0, 20)}...</code>
                  </div>
                  <div>
                    <span className="text-muted-foreground">state: </span>
                    <code className="text-xs">{oauthState.state}</code>
                    {oauthState.stateVerified && (
                      <Badge variant="outline" className="ml-2 text-xs">verified</Badge>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mt-2">
                Waiting for authorization code...
              </p>
            )}
          </StepCard>

          {/* Step 3: Token Exchange */}
          <StepCard
            step={steps[2]}
            index={2}
            expanded={expandedSteps.has(2)}
            onToggle={() => toggleStep(2)}
          >
            {oauthState.tokenEndpoint ? (
              <div className="space-y-2 mt-2">
                <div className="text-xs text-muted-foreground">Token Endpoint:</div>
                <CodeBlock>
                  {`POST ${oauthState.tokenEndpoint}\ngrant_type=authorization_code&code=${oauthState.authorizationCode?.slice(0, 10) || ''}...`}
                </CodeBlock>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mt-2">
                Token exchange not performed yet.
              </p>
            )}
          </StepCard>

          {/* Step 4: Access Token */}
          <StepCard
            step={steps[3]}
            index={3}
            expanded={expandedSteps.has(3)}
            onToggle={() => toggleStep(3)}
          >
            {oauthState.accessToken ? (
              <div className="space-y-3 mt-2">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">access_token:</span>
                    <CopyButton text={oauthState.accessToken} />
                  </div>
                  <code className="block text-xs bg-muted p-2 rounded overflow-x-auto">
                    {oauthState.accessToken.slice(0, 50)}...
                  </code>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">token_type: </span>
                    <span>{oauthState.tokenType}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">expires_in: </span>
                    <span>{oauthState.expiresIn}s</span>
                    <span className="text-xs text-muted-foreground ml-1">({formatExpiration()})</span>
                  </div>
                </div>
                {oauthState.scopes && (
                  <div>
                    <span className="text-sm text-muted-foreground">scope: </span>
                    {oauthState.scopes.map((scope) => (
                      <Badge key={scope} variant="secondary" className="mr-1 text-xs">
                        {scope}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mt-2">
                No access token received yet.
              </p>
            )}
          </StepCard>

          {/* Refresh Token Section */}
          {oauthState.refreshToken && (
            <div className="border border-border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">Refresh Token</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRefreshToken}
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Test Refresh Now
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-muted p-2 rounded flex-1 overflow-x-auto">
                  {oauthState.refreshToken.slice(0, 30)}...
                </code>
                <CopyButton text={oauthState.refreshToken} />
              </div>
            </div>
          )}

          <hr className="border-border" />

          {/* Decoded JWT */}
          {oauthState.decodedToken && (
            <div className="space-y-3">
              <div className="font-medium">Decoded Access Token (JWT)</div>
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">Header:</div>
                <CodeBlock copyable>
                  {JSON.stringify(oauthState.decodedToken.header, null, 2)}
                </CodeBlock>
              </div>
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">Payload:</div>
                <CodeBlock copyable>
                  {JSON.stringify(oauthState.decodedToken.payload, null, 2)}
                </CodeBlock>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onRevokeToken}
              className="text-red-400 hover:text-red-300"
            >
              <XCircle className="h-4 w-4 mr-1" />
              Revoke Token
            </Button>
            <Button variant="outline" onClick={onStartNewFlow}>
              Start New Flow
            </Button>
          </div>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
