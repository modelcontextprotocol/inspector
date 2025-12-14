import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download, ChevronDown } from 'lucide-react';
import { mockLogs, logLevels, levelColors, levelVariants } from '@/mocks';

export function Logs() {
  const [logs, setLogs] = useState(mockLogs);
  const [logLevel, setLogLevel] = useState('debug');
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  // All 8 RFC 5424 log levels
  const [visibleLevels, setVisibleLevels] = useState({
    debug: true,
    info: true,
    notice: true,
    warning: true,
    error: true,
    critical: true,
    alert: true,
    emergency: true,
  });

  const toggleLevel = (level: string) => {
    setVisibleLevels((prev) => ({ ...prev, [level]: !prev[level as keyof typeof prev] }));
  };

  const filteredLogs = logs.filter((log) => {
    const matchesFilter = filter === '' || log.message.toLowerCase().includes(filter.toLowerCase());
    const matchesLevel = visibleLevels[log.level as keyof typeof visibleLevels] ?? true;
    return matchesFilter && matchesLevel;
  });

  const handleClear = () => {
    setLogs([]);
  };

  const handleExportJson = () => {
    const exportData = filteredLogs.map((log) => ({
      timestamp: log.timestamp,
      level: log.level,
      message: log.message,
      logger: log.logger,
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mcp-logs-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportText = () => {
    const lines = filteredLogs.map(
      (log) => `[${log.timestamp}] [${log.level.toUpperCase()}] [${log.logger}] ${log.message}`
    );
    const blob = new Blob([lines.join('\n')], {
      type: 'text/plain',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mcp-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyAll = () => {
    const lines = filteredLogs.map(
      (log) => `[${log.timestamp}] [${log.level.toUpperCase()}] [${log.logger}] ${log.message}`
    );
    navigator.clipboard.writeText(lines.join('\n'));
  };

  return (
    <div className="grid grid-cols-12 gap-4 h-[calc(100vh-120px)]">
      {/* Left Panel - Controls (25%) */}
      <Card className="col-span-3">
        <CardContent className="p-4 space-y-6">
          {/* Log Level */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Log Level</label>
            <div className="flex gap-2">
              <Select value={logLevel} onValueChange={setLogLevel}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {logLevels.map((level) => (
                    <SelectItem key={level} value={level}>
                      {level.charAt(0).toUpperCase() + level.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm">Set Level</Button>
            </div>
          </div>

          {/* Text Filter */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Filter</label>
            <Input
              placeholder="Search logs..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          {/* Level Checkboxes */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Show Levels</label>
            <div className="space-y-2">
              {Object.entries(visibleLevels).map(([level, checked]) => (
                <label key={level} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleLevel(level)}
                  />
                  <span className={`text-sm uppercase ${levelColors[level]}`}>
                    {level}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={handleClear}>
              Clear
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="flex-1">
                  <Download className="h-4 w-4 mr-1" />
                  Export
                  <ChevronDown className="h-4 w-4 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportJson}>
                  Export as JSON
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportText}>
                  Export as Text
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      {/* Right Panel - Log Stream (75%) */}
      <Card className="col-span-9 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">Log Stream</h3>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={autoScroll}
                onCheckedChange={(checked) => setAutoScroll(checked as boolean)}
              />
              <span className="text-sm">Auto-scroll</span>
            </label>
            <Button variant="ghost" size="sm" onClick={handleCopyAll}>
              Copy All
            </Button>
          </div>
        </div>
        <CardContent className="flex-1 overflow-auto p-4">
          <div className="space-y-1 font-mono text-sm">
            {filteredLogs.map((log, index) => (
              <div key={index} className="flex items-start gap-3 py-1">
                <span className="text-muted-foreground shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <Badge
                  variant={levelVariants[log.level]}
                  className="uppercase text-xs shrink-0"
                >
                  {log.level}
                </Badge>
                <span className={levelColors[log.level]}>
                  {log.message}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
