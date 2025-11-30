import { useState } from 'react';
import {
  Copy,
  Check,
  ExternalLink,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ElicitationFormField {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description?: string;
  required?: boolean;
  enum?: string[];
  default?: string | number | boolean;
}

interface ElicitationFormRequest {
  mode: 'form';
  message: string;
  schema: {
    properties: Record<string, ElicitationFormField>;
    required?: string[];
  };
  serverName: string;
}

interface ElicitationUrlRequest {
  mode: 'url';
  message: string;
  url: string;
  elicitationId: string;
  serverName: string;
}

type ElicitationRequest = ElicitationFormRequest | ElicitationUrlRequest;

interface ElicitationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'form' | 'url';
}

// Mock form mode request
const mockFormRequest: ElicitationFormRequest = {
  mode: 'form',
  message: 'Please provide your database connection details to proceed.',
  schema: {
    properties: {
      host: {
        name: 'host',
        type: 'string',
        description: 'Database hostname',
        required: true,
        default: 'localhost',
      },
      port: {
        name: 'port',
        type: 'number',
        description: 'Database port number',
        required: true,
        default: 5432,
      },
      database: {
        name: 'database',
        type: 'string',
        description: 'Database name',
      },
      sslMode: {
        name: 'sslMode',
        type: 'string',
        description: 'SSL connection mode',
        enum: ['disable', 'require', 'verify-ca', 'verify-full'],
        default: 'require',
      },
    },
    required: ['host', 'port'],
  },
  serverName: 'database-connector',
};

// Mock URL mode request
const mockUrlRequest: ElicitationUrlRequest = {
  mode: 'url',
  message: 'Please complete the OAuth authorization in your browser.',
  url: 'https://auth.example.com/oauth/authorize?client_id=abc123&redirect_uri=http://localhost:3000/callback&state=xyz789&scope=read+write',
  elicitationId: 'elicit-abc123-def456',
  serverName: 'oauth-server',
};

export function ElicitationModal({
  open,
  onOpenChange,
  mode,
}: ElicitationModalProps) {
  const request: ElicitationRequest =
    mode === 'form' ? mockFormRequest : mockUrlRequest;

  if (mode === 'form') {
    return (
      <ElicitationFormMode
        open={open}
        onOpenChange={onOpenChange}
        request={request as ElicitationFormRequest}
      />
    );
  }

  return (
    <ElicitationUrlMode
      open={open}
      onOpenChange={onOpenChange}
      request={request as ElicitationUrlRequest}
    />
  );
}

// Form Mode Component
function ElicitationFormMode({
  open,
  onOpenChange,
  request,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: ElicitationFormRequest;
}) {
  const [formData, setFormData] = useState<Record<string, string | number>>(() => {
    // Initialize with defaults
    const initial: Record<string, string | number> = {};
    Object.entries(request.schema.properties).forEach(([key, field]) => {
      if (field.default !== undefined) {
        initial[key] = field.default as string | number;
      }
    });
    return initial;
  });

  const handleChange = (key: string, value: string | number) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleCancel = () => {
    console.log('Elicitation cancelled - sending declined response');
    onOpenChange(false);
  };

  const handleSubmit = () => {
    console.log('Elicitation form submitted:', formData);
    onOpenChange(false);
  };

  const isRequired = (fieldName: string) =>
    request.schema.required?.includes(fieldName);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Server Request: User Input Required</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Message */}
          <p className="text-sm">{request.message}</p>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Form Fields */}
          <div className="space-y-4">
            {Object.entries(request.schema.properties).map(([key, field]) => (
              <div key={key}>
                <Label htmlFor={key} className="text-sm">
                  {field.name}
                  {isRequired(key) && (
                    <span className="text-red-500 ml-1">*</span>
                  )}
                </Label>
                {field.description && (
                  <p className="text-xs text-muted-foreground mb-1">
                    {field.description}
                  </p>
                )}
                {field.enum ? (
                  <Select
                    value={String(formData[key] ?? '')}
                    onValueChange={(val) => handleChange(key, val)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder={`Select ${field.name}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {field.enum.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={key}
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={formData[key] ?? ''}
                    onChange={(e) =>
                      handleChange(
                        key,
                        field.type === 'number'
                          ? Number(e.target.value)
                          : e.target.value
                      )
                    }
                    className="mt-1"
                    placeholder={`Enter ${field.name}`}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Security Warning */}
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-yellow-500">Warning</p>
                <p className="text-muted-foreground">
                  Only provide information you trust this server with. The
                  server "{request.serverName}" is requesting this data.
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>Submit</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// URL Mode Component
function ElicitationUrlMode({
  open,
  onOpenChange,
  request,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: ElicitationUrlRequest;
}) {
  const [copied, setCopied] = useState(false);
  const [status] = useState<'waiting' | 'completed'>('waiting');

  const handleCopyUrl = async () => {
    await navigator.clipboard.writeText(request.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenInBrowser = () => {
    window.open(request.url, '_blank');
  };

  const handleCancel = () => {
    console.log('Elicitation cancelled - sending declined response');
    onOpenChange(false);
  };

  // Extract domain from URL for display
  let domain = '';
  try {
    domain = new URL(request.url).hostname;
  } catch {
    domain = 'unknown';
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Server Request: External Action Required</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Message */}
          <p className="text-sm">{request.message}</p>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* URL Display */}
          <div>
            <p className="text-sm text-muted-foreground mb-2">
              The server is requesting you visit:
            </p>
            <Card>
              <CardContent className="p-3">
                <code className="text-xs break-all">{request.url}</code>
              </CardContent>
            </Card>
            <div className="flex justify-end mt-2">
              <Button variant="ghost" size="sm" onClick={handleCopyUrl}>
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-1 text-green-500" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-1" />
                    Copy URL
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Open in Browser Button */}
          <div className="flex justify-center">
            <Button onClick={handleOpenInBrowser}>
              <ExternalLink className="h-4 w-4 mr-2" />
              Open in Browser
            </Button>
          </div>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Status */}
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Status:</span>
              {status === 'waiting' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Waiting for completion...</span>
                </>
              ) : (
                <span className="text-green-500">Completed</span>
              )}
            </div>
          </div>

          {/* Elicitation ID */}
          <div className="text-xs text-muted-foreground">
            Elicitation ID: {request.elicitationId}
          </div>

          {/* Domain Warning */}
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-yellow-500">Warning</p>
                <p className="text-muted-foreground">
                  This will open an external URL ({domain}). Verify the domain
                  before proceeding.
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end">
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
