import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// Mock tools data
const mockTools = [
  { name: 'echo', description: 'Echoes the input message' },
  { name: 'add', description: 'Adds two numbers together' },
  { name: 'longRunningOperation', description: 'A long-running operation for testing' },
  { name: 'sampleLLM', description: 'Samples from an LLM' },
];

export function Tools() {
  return (
    <div className="grid grid-cols-12 gap-4 h-[calc(100vh-120px)]">
      {/* Tool List Panel (3/12) */}
      <Card className="col-span-3 overflow-hidden">
        <CardContent className="p-4 space-y-3">
          <Input placeholder="Search tools..." />
          <div className="space-y-1">
            {mockTools.map((tool, index) => (
              <Button
                key={tool.name}
                variant={index === 0 ? 'default' : 'ghost'}
                className="w-full justify-start"
              >
                {tool.name}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Parameters Panel (5/12) */}
      <Card className="col-span-5">
        <CardContent className="p-4 space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Tool: echo</h3>
            <p className="text-sm text-muted-foreground">
              Echoes the input message
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              message <span className="text-red-400">*</span>
            </label>
            <Input placeholder="Enter message..." />
          </div>

          <Button className="w-full">Execute Tool</Button>
        </CardContent>
      </Card>

      {/* Results Panel (4/12) */}
      <Card className="col-span-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Results</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <pre className="p-4 bg-muted rounded-md text-sm font-mono overflow-auto max-h-[60vh]">
{JSON.stringify(
  {
    content: [
      {
        type: 'text',
        text: 'Hello, world!',
      },
    ],
  },
  null,
  2
)}
          </pre>
          <Button variant="outline" size="sm">
            Copy
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
