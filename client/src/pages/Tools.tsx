import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ListChangedIndicator } from '@/components/ListChangedIndicator';

// Tool interface with annotations per MCP spec
interface Tool {
  name: string;
  description: string;
  annotations?: {
    audience?: 'user' | 'assistant';
    readOnly?: boolean;
    destructive?: boolean;
    longRunning?: boolean;
    hints?: string;
  };
}

// Mock tools data with annotations
const mockTools: Tool[] = [
  {
    name: 'query_db',
    description: 'Queries the database and returns results',
    annotations: { audience: 'user', readOnly: true },
  },
  {
    name: 'echo',
    description: 'Echoes the input message',
    annotations: {},
  },
  {
    name: 'add',
    description: 'Adds two numbers together',
    annotations: {},
  },
  {
    name: 'longOp',
    description: 'A long-running operation for testing',
    annotations: { longRunning: true, hints: 'May take several minutes to complete' },
  },
  {
    name: 'dangerOp',
    description: 'Performs a destructive operation',
    annotations: { destructive: true },
  },
];

export function Tools() {
  const [hasToolsChanged, setHasToolsChanged] = useState(true);
  const [selectedTool, setSelectedTool] = useState<Tool>(mockTools[0]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [progress, setProgress] = useState<{ percent: number; message?: string } | null>(null);
  const [searchFilter, setSearchFilter] = useState('');

  const handleRefresh = () => {
    setHasToolsChanged(false);
  };

  const handleExecute = () => {
    setIsExecuting(true);
    setProgress({ percent: 0, message: 'Starting...' });

    // Simulate progress for demo
    let percent = 0;
    const interval = setInterval(() => {
      percent += 20;
      if (percent >= 100) {
        clearInterval(interval);
        setIsExecuting(false);
        setProgress(null);
      } else {
        setProgress({
          percent,
          message: `Processing step ${percent / 20} of 5...`,
        });
      }
    }, 800);
  };

  const handleCancel = () => {
    setIsExecuting(false);
    setProgress(null);
  };

  const filteredTools = mockTools.filter((tool) =>
    tool.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="grid grid-cols-12 gap-4 h-[calc(100vh-120px)]">
      {/* Tool List Panel (3/12) */}
      <Card className="col-span-3 overflow-hidden flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Tools ({mockTools.length})</CardTitle>
          </div>
          <ListChangedIndicator
            hasChanges={hasToolsChanged}
            onRefresh={handleRefresh}
            label="List updated"
          />
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3 flex-1 overflow-auto">
          <Input
            placeholder="Search tools..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
          <div className="space-y-1">
            {filteredTools.map((tool) => (
              <div key={tool.name} className="space-y-1">
                <Button
                  variant={selectedTool.name === tool.name ? 'default' : 'ghost'}
                  className="w-full justify-start"
                  onClick={() => setSelectedTool(tool)}
                >
                  {tool.name}
                </Button>
                {/* Annotation badges below tool name */}
                {tool.annotations && Object.keys(tool.annotations).length > 0 && (
                  <div className="flex flex-wrap gap-1 pl-3 pb-1">
                    {tool.annotations.audience && (
                      <Badge variant="secondary" className="text-xs">
                        {tool.annotations.audience}
                      </Badge>
                    )}
                    {tool.annotations.readOnly && (
                      <Badge variant="default" className="text-xs">
                        read-only
                      </Badge>
                    )}
                    {tool.annotations.destructive && (
                      <Badge variant="error" className="text-xs">
                        destructive
                      </Badge>
                    )}
                    {tool.annotations.longRunning && (
                      <Badge variant="warning" className="text-xs">
                        long-run
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Parameters Panel (5/12) */}
      <Card className="col-span-5">
        <CardContent className="p-4 space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Tool: {selectedTool.name}</h3>
            <p className="text-sm text-muted-foreground">{selectedTool.description}</p>
          </div>

          {/* Display annotations */}
          {selectedTool.annotations && Object.keys(selectedTool.annotations).length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Annotations:</p>
              <div className="flex flex-wrap gap-2">
                {selectedTool.annotations.audience && (
                  <span className="text-sm text-muted-foreground">
                    Audience: {selectedTool.annotations.audience}
                  </span>
                )}
                {selectedTool.annotations.readOnly && (
                  <span className="text-sm text-muted-foreground">Read-only: true</span>
                )}
                {selectedTool.annotations.destructive && (
                  <span className="text-sm text-red-400">Destructive: true</span>
                )}
                {selectedTool.annotations.longRunning && (
                  <span className="text-sm text-yellow-400">Long-running: true</span>
                )}
              </div>
              {selectedTool.annotations.hints && (
                <p className="text-sm text-muted-foreground italic">
                  Hints: "{selectedTool.annotations.hints}"
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">
              message <span className="text-red-400">*</span>
            </label>
            <Input placeholder="Enter message..." disabled={isExecuting} />
          </div>

          {/* Progress bar */}
          {progress && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Progress value={progress.percent} className="flex-1" />
                <span className="text-sm text-muted-foreground w-12 text-right">
                  {progress.percent}%
                </span>
              </div>
              {progress.message && (
                <p className="text-sm text-muted-foreground">{progress.message}</p>
              )}
            </div>
          )}

          {/* Execute / Cancel buttons */}
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={handleExecute}
              disabled={isExecuting}
            >
              {isExecuting ? 'Executing...' : 'Execute Tool'}
            </Button>
            {isExecuting && (
              <Button
                variant="outline"
                onClick={handleCancel}
                className="text-red-400 hover:text-red-300"
              >
                Cancel
              </Button>
            )}
          </div>
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
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              Copy
            </Button>
            <Button variant="outline" size="sm">
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
