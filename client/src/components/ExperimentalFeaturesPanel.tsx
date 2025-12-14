import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, Send, AlertTriangle, Beaker, Code } from 'lucide-react';
import { initialCapabilities } from '@/mocks';

export function ExperimentalFeaturesPanel() {
  const [capabilities, setCapabilities] = useState(initialCapabilities);
  const [jsonRpcExpanded, setJsonRpcExpanded] = useState(false);
  const [capabilitiesExpanded, setCapabilitiesExpanded] = useState(true);

  // JSON-RPC tester state
  const [method, setMethod] = useState('tools/list');
  const [params, setParams] = useState('{}');
  const [result, setResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const toggleCapability = (id: string) => {
    setCapabilities((prev) =>
      prev.map((cap) =>
        cap.id === id ? { ...cap, enabled: !cap.enabled } : cap
      )
    );
  };

  const handleSendRequest = () => {
    setIsLoading(true);
    // Simulate sending request
    setTimeout(() => {
      try {
        const parsedParams = JSON.parse(params);
        // Mock response
        const mockResponse = {
          jsonrpc: '2.0',
          id: 1,
          result: {
            _note: 'This is a mock response for demonstration',
            method,
            receivedParams: parsedParams,
            timestamp: new Date().toISOString(),
          },
        };
        setResult(JSON.stringify(mockResponse, null, 2));
      } catch (e) {
        setResult(
          JSON.stringify(
            {
              jsonrpc: '2.0',
              id: 1,
              error: {
                code: -32700,
                message: 'Parse error',
                data: 'Invalid JSON in params',
              },
            },
            null,
            2
          )
        );
      }
      setIsLoading(false);
    }, 500);
  };

  const enabledCount = capabilities.filter((c) => c.enabled).length;

  return (
    <div className="space-y-4">
      {/* Experimental Capabilities Section */}
      <Card>
        <Collapsible open={capabilitiesExpanded} onOpenChange={setCapabilitiesExpanded}>
          <CardHeader className="pb-2">
            <CollapsibleTrigger className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <Beaker className="h-5 w-5" />
                <CardTitle className="text-base">Experimental Capabilities</CardTitle>
                <Badge variant="secondary" className="ml-2">
                  {enabledCount}/{capabilities.length} enabled
                </Badge>
              </div>
              {capabilitiesExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-yellow-200">
                  Experimental features may change or be removed in future versions.
                  Use with caution in production environments.
                </p>
              </div>

              <div className="space-y-3">
                {capabilities.map((cap) => (
                  <div
                    key={cap.id}
                    className="flex items-start justify-between p-3 border rounded-md"
                  >
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{cap.name}</span>
                        {cap.enabled && (
                          <Badge variant="success" className="text-xs">
                            Enabled
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{cap.description}</p>
                      {cap.warning && (
                        <p className="text-xs text-yellow-400 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          {cap.warning}
                        </p>
                      )}
                    </div>
                    <Switch
                      checked={cap.enabled}
                      onCheckedChange={() => toggleCapability(cap.id)}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* JSON-RPC Tester Section */}
      <Card>
        <Collapsible open={jsonRpcExpanded} onOpenChange={setJsonRpcExpanded}>
          <CardHeader className="pb-2">
            <CollapsibleTrigger className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <Code className="h-5 w-5" />
                <CardTitle className="text-base">JSON-RPC Tester</CardTitle>
                <Badge variant="outline" className="ml-2">
                  Advanced
                </Badge>
              </div>
              {jsonRpcExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              <p className="text-sm text-muted-foreground">
                Send raw JSON-RPC requests to the connected server for testing and debugging.
              </p>

              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Method</label>
                  <Input
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    placeholder="e.g., tools/list, resources/read"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Parameters (JSON)</label>
                  <Textarea
                    value={params}
                    onChange={(e) => setParams(e.target.value)}
                    placeholder='{"key": "value"}'
                    className="font-mono text-sm min-h-[100px]"
                  />
                </div>

                <Button onClick={handleSendRequest} disabled={isLoading} className="w-full">
                  <Send className="h-4 w-4 mr-2" />
                  {isLoading ? 'Sending...' : 'Send Request'}
                </Button>

                {result && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Response</label>
                    <pre className="p-3 bg-muted rounded-md text-xs font-mono overflow-auto max-h-[200px]">
                      {result}
                    </pre>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigator.clipboard.writeText(result)}
                    >
                      Copy Response
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </div>
  );
}
