import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ListChangedIndicator } from '@/components/ListChangedIndicator';
import { AnnotationBadges, getPriorityLabel } from '@/components/AnnotationBadges';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  mockResources,
  mockTemplates,
  mockSubscriptions,
  type Resource,
  type ResourceTemplate,
  type Subscription,
} from '@/mocks';

// Collapsible section component for accordion pattern
function AccordionSection({
  title,
  count,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border rounded-md">
      <button
        className="w-full flex items-center gap-2 p-2 text-sm font-medium hover:bg-muted/50 transition-colors"
        onClick={onToggle}
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        <span>{title}</span>
        <span className="text-muted-foreground">({count})</span>
      </button>
      {isOpen && <div className="p-2 pt-0 border-t">{children}</div>}
    </div>
  );
}

export function Resources() {
  const [hasResourcesChanged, setHasResourcesChanged] = useState(true);
  const [selectedResource, setSelectedResource] = useState<Resource>(mockResources[0]);
  const [searchFilter, setSearchFilter] = useState('');
  const [templateInputs, setTemplateInputs] = useState<Record<string, string>>({});
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(mockSubscriptions);

  // Accordion state - Resources expanded by default, others collapsed
  const [expandedSections, setExpandedSections] = useState({
    resources: true,
    templates: false,
    subscriptions: false,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

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

  // Filter all sections based on search
  const filteredResources = mockResources.filter((resource) =>
    resource.uri.toLowerCase().includes(searchFilter.toLowerCase())
  );
  const filteredTemplates = mockTemplates.filter(
    (t) =>
      t.uriTemplate.toLowerCase().includes(searchFilter.toLowerCase()) ||
      t.description.toLowerCase().includes(searchFilter.toLowerCase())
  );
  const filteredSubscriptions = subscriptions.filter((s) =>
    s.uri.toLowerCase().includes(searchFilter.toLowerCase())
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

          {/* Accordion Sections */}
          <div className="space-y-2">
            {/* Resources Section */}
            <AccordionSection
              title="Resources"
              count={filteredResources.length}
              isOpen={expandedSections.resources}
              onToggle={() => toggleSection('resources')}
            >
              <div className="space-y-1 pt-2">
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
                    <AnnotationBadges
                      annotations={resource.annotations}
                      className="flex flex-wrap gap-1 pl-3 pb-1"
                    />
                  </div>
                ))}
              </div>
            </AccordionSection>

            {/* Templates Section */}
            <AccordionSection
              title="Templates"
              count={filteredTemplates.length}
              isOpen={expandedSections.templates && filteredTemplates.length > 0}
              onToggle={() => toggleSection('templates')}
            >
              <div className="space-y-2 pt-2">
                {filteredTemplates.map((template) => {
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
            </AccordionSection>

            {/* Subscriptions Section */}
            <AccordionSection
              title="Subscriptions"
              count={filteredSubscriptions.length}
              isOpen={expandedSections.subscriptions && filteredSubscriptions.length > 0}
              onToggle={() => toggleSection('subscriptions')}
            >
              <div className="space-y-1 pt-2">
                {filteredSubscriptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No active subscriptions</p>
                ) : (
                  filteredSubscriptions.map((sub) => (
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
                  ))
                )}
              </div>
            </AccordionSection>
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
