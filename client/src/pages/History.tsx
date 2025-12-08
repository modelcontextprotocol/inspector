import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChevronDown, ChevronUp, Pin, PinOff, Download } from 'lucide-react';

// History entry interface
interface HistoryEntry {
  id: string;
  timestamp: string;
  method: string;
  target: string | null;
  params?: Record<string, unknown>;
  response?: Record<string, unknown>;
  duration: number;
  success: boolean;
  pinned: boolean;
  label?: string;
  sseId?: string; // SSE event id for debugging reconnection behavior
  progressToken?: string; // Progress token for tracking long-running operations
}

// Mock history data with params and response
const initialHistory: HistoryEntry[] = [
  {
    id: 'req-1',
    timestamp: '2025-11-30T14:24:12Z',
    method: 'tools/call',
    target: 'echo',
    params: { message: 'Hello world' },
    response: { content: [{ type: 'text', text: 'Hello world' }] },
    duration: 45,
    success: true,
    pinned: true,
    label: 'Test echo',
    sseId: 'evt-12345',
  },
  {
    id: 'req-2',
    timestamp: '2025-11-30T14:23:05Z',
    method: 'tools/list',
    target: null,
    params: {},
    response: { tools: ['echo', 'add', 'longOp'] },
    duration: 12,
    success: true,
    pinned: false,
    sseId: 'evt-12344',
  },
  {
    id: 'req-3',
    timestamp: '2025-11-30T14:22:00Z',
    method: 'resources/read',
    target: 'file:///config.json',
    params: { uri: 'file:///config.json' },
    response: { name: 'my-app', version: '1.0.0' },
    duration: 8,
    success: true,
    pinned: true,
    label: 'Get config',
    sseId: 'evt-12343',
    progressToken: 'prog-abc123',
  },
  {
    id: 'req-4',
    timestamp: '2025-11-30T14:21:30Z',
    method: 'prompts/get',
    target: 'greeting_prompt',
    params: { name: 'greeting_prompt', arguments: { name: 'John' } },
    response: { error: 'Prompt not found' },
    duration: 0,
    success: false,
    pinned: false,
  },
];

interface HistoryCardProps {
  entry: HistoryEntry;
  expanded: boolean;
  onToggleExpand: () => void;
  onTogglePin: () => void;
}

function HistoryCard({ entry, expanded, onToggleExpand, onTogglePin }: HistoryCardProps) {
  return (
    <Card className={entry.pinned ? 'border-yellow-500/30' : ''}>
      <CardContent className="p-4 space-y-3">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {entry.pinned && <span className="text-yellow-500">*</span>}
            <span className="font-mono text-sm text-muted-foreground">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
            <Badge variant="secondary">{entry.method}</Badge>
            {entry.target && (
              <span className="text-sm font-medium">{entry.target}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={entry.success ? 'success' : 'error'}>
              {entry.success ? 'OK' : 'Error'}
            </Badge>
            <span className="text-sm text-muted-foreground">{entry.duration}ms</span>
          </div>
        </div>

        {/* Parameters (always visible if present) */}
        {entry.params && Object.keys(entry.params).length > 0 && (
          <div className="text-sm">
            <span className="text-muted-foreground">Parameters: </span>
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              {JSON.stringify(entry.params)}
            </code>
          </div>
        )}

        {/* Metadata row: SSE ID, Progress Token */}
        {(entry.sseId || entry.progressToken) && (
          <div className="flex gap-4 text-xs text-muted-foreground">
            {entry.sseId && (
              <span>
                SSE ID: <code className="bg-muted px-1 py-0.5 rounded">{entry.sseId}</code>
              </span>
            )}
            {entry.progressToken && (
              <span>
                Progress Token: <code className="bg-muted px-1 py-0.5 rounded">{entry.progressToken}</code>
              </span>
            )}
          </div>
        )}

        {/* Expandable response section - with smooth transition */}
        {entry.response && (
          <div
            className={`overflow-hidden transition-all duration-200 ease-in-out ${
              expanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
            }`}
          >
            <div className="border-t pt-3 mt-3">
              <p className="text-sm text-muted-foreground mb-2">Response:</p>
              <pre className="p-3 bg-muted rounded-md text-xs font-mono overflow-auto max-h-48">
                {JSON.stringify(entry.response, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {/* Actions row */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex gap-2">
            <Button variant="ghost" size="sm">
              Replay
            </Button>
            <Button variant="ghost" size="sm" onClick={onTogglePin}>
              {entry.pinned ? (
                <>
                  <PinOff className="h-4 w-4 mr-1" />
                  Unpin
                </>
              ) : (
                <>
                  <Pin className="h-4 w-4 mr-1" />
                  Pin
                </>
              )}
            </Button>
          </div>
          {entry.response && (
            <Button variant="ghost" size="sm" onClick={onToggleExpand}>
              {expanded ? (
                <>
                  <ChevronUp className="h-4 w-4 mr-1" />
                  Collapse
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 mr-1" />
                  Expand
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const PAGE_SIZE = 10;

export function History() {
  const [history, setHistory] = useState<HistoryEntry[]>(initialHistory);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState<string>('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const togglePin = (id: string) => {
    setHistory((prev) =>
      prev.map((entry) =>
        entry.id === id ? { ...entry, pinned: !entry.pinned } : entry
      )
    );
  };

  const handleClearAll = () => {
    setHistory([]);
  };

  const handleExport = () => {
    const exportData = filteredHistory.map((entry) => ({
      timestamp: entry.timestamp,
      method: entry.method,
      target: entry.target,
      params: entry.params,
      response: entry.response,
      duration: entry.duration,
      success: entry.success,
      sseId: entry.sseId,
      progressToken: entry.progressToken,
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mcp-history-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleLoadMore = () => {
    setVisibleCount((prev) => prev + PAGE_SIZE);
  };

  // Filter history
  const filteredHistory = history.filter((entry) => {
    const matchesSearch =
      searchFilter === '' ||
      entry.method.toLowerCase().includes(searchFilter.toLowerCase()) ||
      entry.target?.toLowerCase().includes(searchFilter.toLowerCase()) ||
      JSON.stringify(entry.params).toLowerCase().includes(searchFilter.toLowerCase());
    const matchesMethod = methodFilter === '' || methodFilter === 'all' || entry.method === methodFilter;
    return matchesSearch && matchesMethod;
  });

  // Separate pinned and unpinned
  const pinnedEntries = filteredHistory.filter((entry) => entry.pinned);
  const unpinnedEntries = filteredHistory.filter((entry) => !entry.pinned);

  // Paginate unpinned entries
  const visibleUnpinnedEntries = unpinnedEntries.slice(0, visibleCount);
  const hasMoreEntries = unpinnedEntries.length > visibleCount;

  return (
    <div className="space-y-6 h-[calc(100vh-120px)] overflow-auto">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Request History</CardTitle>
            <div className="flex gap-2">
              <Input
                placeholder="Search..."
                className="w-48"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
              <Select value={methodFilter} onValueChange={setMethodFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Filter by method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All methods</SelectItem>
                  <SelectItem value="tools/call">tools/call</SelectItem>
                  <SelectItem value="tools/list">tools/list</SelectItem>
                  <SelectItem value="resources/read">resources/read</SelectItem>
                  <SelectItem value="prompts/get">prompts/get</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-4 w-4 mr-1" />
                Export JSON
              </Button>
              <Button variant="outline" size="sm" onClick={handleClearAll}>
                Clear All
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* History entries */}
      {unpinnedEntries.length === 0 && pinnedEntries.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No history entries
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visibleUnpinnedEntries.map((entry) => (
            <HistoryCard
              key={entry.id}
              entry={entry}
              expanded={expandedIds.has(entry.id)}
              onToggleExpand={() => toggleExpand(entry.id)}
              onTogglePin={() => togglePin(entry.id)}
            />
          ))}
          {/* Load More button */}
          {hasMoreEntries && (
            <div className="text-center pt-2">
              <Button variant="outline" onClick={handleLoadMore}>
                Load More ({unpinnedEntries.length - visibleCount} remaining)
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Pinned Requests Section */}
      {pinnedEntries.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold">Pinned Requests ({pinnedEntries.length})</h3>
          <Card>
            <CardContent className="p-4">
              <div className="space-y-2">
                {pinnedEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-yellow-500">*</span>
                      {entry.label && (
                        <span className="font-medium text-sm">"{entry.label}"</span>
                      )}
                      <Badge variant="secondary" className="text-xs">
                        {entry.method}
                      </Badge>
                      {entry.target && (
                        <span className="text-sm text-muted-foreground">
                          {entry.target}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm">
                        Replay
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => togglePin(entry.id)}
                      >
                        <PinOff className="h-4 w-4 mr-1" />
                        Unpin
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Footer stats */}
      <div className="text-sm text-muted-foreground text-right">
        Showing {visibleUnpinnedEntries.length + pinnedEntries.length} of {filteredHistory.length} entries
        {filteredHistory.length !== history.length && ` (${history.length} total)`}
      </div>
    </div>
  );
}
