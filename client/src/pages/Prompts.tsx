import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Mock prompts data
const mockPrompts = [
  { name: 'greeting_prompt', description: 'Generate a greeting' },
  { name: 'summarize', description: 'Summarize text' },
];

export function Prompts() {
  return (
    <div className="grid grid-cols-12 gap-4 h-[calc(100vh-120px)]">
      {/* Prompt Selection Panel (4/12) */}
      <Card className="col-span-4">
        <CardContent className="p-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Prompt</label>
            <Select defaultValue="greeting_prompt">
              <SelectTrigger>
                <SelectValue placeholder="Choose a prompt..." />
              </SelectTrigger>
              <SelectContent>
                {mockPrompts.map((p) => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <h4 className="font-semibold mb-3">Arguments</h4>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">
                  name <span className="text-red-400">*</span>
                </label>
                <Input placeholder="Enter name..." />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">interests</label>
                <Input placeholder="Enter interests..." />
              </div>
            </div>
          </div>

          <Button className="w-full">Get Prompt</Button>
        </CardContent>
      </Card>

      {/* Result Panel (8/12) */}
      <Card className="col-span-8">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Messages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <Card className="bg-muted/50">
              <CardContent className="p-3">
                <p className="text-xs font-semibold text-muted-foreground mb-1">
                  [0] role: user
                </p>
                <p className="text-sm">
                  "Hello, my name is John and I like cats"
                </p>
              </CardContent>
            </Card>

            <Card className="bg-muted/50">
              <CardContent className="p-3">
                <p className="text-xs font-semibold text-muted-foreground mb-1">
                  [1] role: assistant
                </p>
                <p className="text-sm">
                  "Nice to meet you, John! It's wonderful that you enjoy cats..."
                </p>
              </CardContent>
            </Card>
          </div>

          <Button variant="outline" size="sm">
            Copy
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
