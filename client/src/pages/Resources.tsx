import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Mock resources data
const mockResources = [
  { uri: 'file:///config.json', mimeType: 'application/json' },
  { uri: 'file:///readme.md', mimeType: 'text/markdown' },
  { uri: 'file:///data.csv', mimeType: 'text/csv' },
];

const mockTemplates = [
  { uriTemplate: 'user/{id}', description: 'Get user by ID' },
  { uriTemplate: 'file/{path}', description: 'Read file by path' },
];

export function Resources() {
  return (
    <div className="grid grid-cols-12 gap-4 h-[calc(100vh-120px)]">
      {/* Resource List Panel (4/12) */}
      <Card className="col-span-4 overflow-hidden">
        <CardContent className="p-4 space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Search..." className="flex-1" />
            <Button variant="outline" size="sm">
              Refresh
            </Button>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase">
              Resources
            </p>
            <div className="space-y-1">
              {mockResources.map((resource, index) => (
                <Button
                  key={resource.uri}
                  variant={index === 0 ? 'default' : 'ghost'}
                  className="w-full justify-start text-sm"
                  size="sm"
                >
                  {resource.uri.split('/').pop()}
                </Button>
              ))}
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase pt-2">
              Templates
            </p>
            <div className="space-y-1">
              {mockTemplates.map((template) => (
                <Button
                  key={template.uriTemplate}
                  variant="ghost"
                  className="w-full justify-start text-sm"
                  size="sm"
                >
                  {template.uriTemplate}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Content Preview Panel (8/12) */}
      <Card className="col-span-8">
        <CardContent className="p-4 space-y-4">
          <div className="text-sm text-muted-foreground">
            <p>URI: file:///config.json</p>
            <p>MIME: application/json</p>
          </div>

          <pre className="p-4 bg-muted rounded-md text-sm font-mono overflow-auto max-h-[60vh]">
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

          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              Copy
            </Button>
            <Button variant="outline" size="sm">
              Subscribe
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
