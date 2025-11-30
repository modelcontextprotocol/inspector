import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ListChangedIndicator } from '@/components/ListChangedIndicator';

// Resource interface with annotations per MCP spec
interface Resource {
  uri: string;
  mimeType: string;
  annotations?: {
    audience?: 'user' | 'application';
    priority?: number; // 0-1
  };
}

interface ResourceTemplate {
  uriTemplate: string;
  description: string;
}

interface Subscription {
  uri: string;
  lastUpdated: string;
}

// Mock resources data with annotations
const mockResources: Resource[] = [
  {
    uri: 'file:///config.json',
    mimeType: 'application/json',
    annotations: { audience: 'application', priority: 0.9 },
  },
  {
    uri: 'file:///readme.md',
    mimeType: 'text/markdown',
    annotations: { audience: 'user' },
  },
  {
    uri: 'file:///data.csv',
    mimeType: 'text/csv',
    annotations: { priority: 0.5 },
  },
];

const mockTemplates: ResourceTemplate[] = [
  { uriTemplate: 'user/{id}', description: 'Get user by ID' },
  { uriTemplate: 'file/{path}', description: 'Read file by path' },
];

const mockSubscriptions: Subscription[] = [
  { uri: 'file:///config.json', lastUpdated: '2025-11-30T14:32:05Z' },
];

function getPriorityLabel(priority: number): { label: string; variant: 'default' | 'secondary' | 'warning' } {
  if (priority > 0.7) return { label: 'high', variant: 'warning' };
  if (priority > 0.3) return { label: 'medium', variant: 'secondary' };
  return { label: 'low', variant: 'default' };
}

export function Resources() {
  const [hasResourcesChanged, setHasResourcesChanged] = useState(true);
  const [selectedResource, setSelectedResource] = useState<Resource>(mockResources[0]);
  const [searchFilter, setSearchFilter] = useState('');
  const [templateInputs, setTemplateInputs] = useState<Record<string, string>>({});
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(mockSubscriptions);

  const handleRefresh = () => {
    setHasResourcesChanged(false);
  };

  const handleTemplateInputChange = (template: string, value: string) => {
    setTemplateInputs((prev) => ({ ...prev, [template]: value }));
  };

  const handleTemplateGo = (template: ResourceTemplate) => {
    const value = templateInputs[template.uriTemplate] || '';
    // Extract variable name from template
    const varMatch = template.uriTemplate.match(/\{(\w+)\}/);
    if (varMatch && value) {
      const resolvedUri = template.uriTemplate.replace(`{${varMatch[1]}}`, value);
      console.log('Resolving template:', resolvedUri);
      // In real implementation, would fetch the resolved resource
    }
  };

  const handleSubscribe = () => {
    if (!subscriptions.find((s) => s.uri === selectedResource.uri)) {
      setSubscriptions((prev) => [
        ...prev,
        { uri: selectedResource.uri, lastUpdated: new Date().toISOString() },
      ]);
    }
  };

  const handleUnsubscribe = (uri: string) => {
    setSubscriptions((prev) => prev.filter((s) => s.uri !== uri));
  };

  const filteredResources = mockResources.filter((resource) =>
    resource.uri.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const isSubscribed = subscriptions.some((s) => s.uri === selectedResource.uri);

  return (
    <div className="grid grid-cols-12 gap-4 h-[calc(100vh-120px)]">
      {/* Resource List Panel (4/12) */}
      <Card className="col-span-4 overflow-hidden flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Resources ({mockResources.length})</CardTitle>
          </div>
          <ListChangedIndicator
            hasChanges={hasResourcesChanged}
            onRefresh={handleRefresh}
            label="List updated"
          />
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3 flex-1 overflow-auto">
          <Input
            placeholder="Search..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />

          <div className="space-y-3">
            {/* Resources Section */}
            <p className="text-xs font-semibold text-muted-foreground uppercase">
              Resources
            </p>
            <div className="space-y-1">
              {filteredResources.map((resource) => (
                <div key={resource.uri} className="space-y-1">
                  <Button
                    variant={selectedResource.uri === resource.uri ? 'default' : 'ghost'}
                    className="w-full justify-start text-sm"
                    size="sm"
                    onClick={() => setSelectedResource(resource)}
                  >
                    {resource.uri.split('/').pop()}
                  </Button>
                  {/* Annotation badges */}
                  {resource.annotations && Object.keys(resource.annotations).length > 0 && (
                    <div className="flex flex-wrap gap-1 pl-3 pb-1">
                      {resource.annotations.audience && (
                        <Badge variant="secondary" className="text-xs">
                          {resource.annotations.audience}
                        </Badge>
                      )}
                      {resource.annotations.priority !== undefined && (
                        <Badge
                          variant={getPriorityLabel(resource.annotations.priority).variant}
                          className="text-xs"
                        >
                          priority: {getPriorityLabel(resource.annotations.priority).label}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Templates Section */}
            <p className="text-xs font-semibold text-muted-foreground uppercase pt-2">
              Templates
            </p>
            <div className="space-y-2">
              {mockTemplates.map((template) => {
                const varMatch = template.uriTemplate.match(/\{(\w+)\}/);
                const varName = varMatch ? varMatch[1] : '';
                return (
                  <div key={template.uriTemplate} className="space-y-1">
                    <p className="text-sm text-muted-foreground">{template.uriTemplate}</p>
                    <div className="flex gap-1">
                      <Input
                        placeholder={varName}
                        className="h-7 text-xs"
                        value={templateInputs[template.uriTemplate] || ''}
                        onChange={(e) =>
                          handleTemplateInputChange(template.uriTemplate, e.target.value)
                        }
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2"
                        onClick={() => handleTemplateGo(template)}
                      >
                        Go
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Subscriptions Section */}
            {subscriptions.length > 0 && (
              <>
                <p className="text-xs font-semibold text-muted-foreground uppercase pt-2">
                  Subscriptions
                </p>
                <div className="space-y-1">
                  {subscriptions.map((sub) => (
                    <div
                      key={sub.uri}
                      className="flex items-center justify-between text-sm py-1"
                    >
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-green-500" />
                        <span className="truncate">{sub.uri.split('/').pop()}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => handleUnsubscribe(sub.uri)}
                      >
                        Unsub
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Content Preview Panel (8/12) */}
      <Card className="col-span-8">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Content Preview</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-4">
          <div className="text-sm space-y-1">
            <p>
              <span className="text-muted-foreground">URI:</span> {selectedResource.uri}
            </p>
            <p>
              <span className="text-muted-foreground">MIME:</span> {selectedResource.mimeType}
            </p>
          </div>

          {/* Display annotations */}
          {selectedResource.annotations &&
            Object.keys(selectedResource.annotations).length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Annotations:</p>
                <div className="flex flex-wrap gap-2 text-sm">
                  {selectedResource.annotations.audience && (
                    <span className="text-muted-foreground">
                      Audience: {selectedResource.annotations.audience}
                    </span>
                  )}
                  {selectedResource.annotations.priority !== undefined && (
                    <span className="text-muted-foreground">
                      Priority: {selectedResource.annotations.priority.toFixed(1)} (
                      {getPriorityLabel(selectedResource.annotations.priority).label})
                    </span>
                  )}
                </div>
              </div>
            )}

          <pre className="p-4 bg-muted rounded-md text-sm font-mono overflow-auto max-h-[50vh]">
            {JSON.stringify(
              {
                name: 'my-app',
                version: '1.0.0',
                description: 'Sample configuration file',
              },
              null,
              2
            )}
          </pre>

          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Button variant="outline" size="sm">
                Copy
              </Button>
              {isSubscribed ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleUnsubscribe(selectedResource.uri)}
                >
                  Unsubscribe
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={handleSubscribe}>
                  Subscribe
                </Button>
              )}
            </div>
            {isSubscribed && (
              <span className="text-xs text-muted-foreground">
                Last updated:{' '}
                {new Date(
                  subscriptions.find((s) => s.uri === selectedResource.uri)?.lastUpdated || ''
                ).toLocaleTimeString()}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
