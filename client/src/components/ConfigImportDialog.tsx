import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Upload,
  AlertCircle,
  CheckCircle,
  FileText,
  Copy,
  X,
} from "lucide-react";
import {
  parseConfigFile,
  generateExampleConfig,
  ConfigImportResult,
  ParsedServerConfig,
} from "@/utils/configImportUtils";
import { useToast } from "@/lib/hooks/useToast";

interface ConfigImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportServers: (servers: ParsedServerConfig[]) => void;
}

const ConfigImportDialog = ({
  open,
  onOpenChange,
  onImportServers,
}: ConfigImportDialogProps) => {
  const [configText, setConfigText] = useState("");
  const [parseResult, setParseResult] = useState<ConfigImportResult | null>(
    null,
  );
  const [isValidating, setIsValidating] = useState(false);
  const { toast } = useToast();

  const handleConfigChange = useCallback((value: string) => {
    setConfigText(value);
    setParseResult(null);
  }, []);

  const validateConfig = useCallback(() => {
    if (!configText.trim()) {
      setParseResult({
        success: false,
        servers: [],
        errors: ["Please enter a configuration"],
      });
      return;
    }

    setIsValidating(true);
    try {
      const result = parseConfigFile(configText);
      setParseResult(result);
    } catch (error) {
      setParseResult({
        success: false,
        servers: [],
        errors: [
          `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        ],
      });
    } finally {
      setIsValidating(false);
    }
  }, [configText]);

  const handleImport = useCallback(() => {
    if (parseResult?.success && parseResult.servers.length > 0) {
      onImportServers(parseResult.servers);
      toast({
        title: "Configuration imported",
        description: `Successfully imported ${parseResult.servers.length} server(s)`,
      });
      onOpenChange(false);
      setConfigText("");
      setParseResult(null);
    }
  }, [parseResult, onImportServers, onOpenChange, toast]);

  const handlePasteExample = useCallback(() => {
    const example = generateExampleConfig();
    setConfigText(example);
    setParseResult(null);
  }, []);

  const handleCopyExample = useCallback(async () => {
    try {
      const example = generateExampleConfig();
      await navigator.clipboard.writeText(example);
      toast({
        title: "Example copied",
        description: "Example configuration has been copied to clipboard",
      });
    } catch {
      toast({
        title: "Copy failed",
        description: "Failed to copy example configuration",
        variant: "destructive",
      });
    }
  }, [toast]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
    setConfigText("");
    setParseResult(null);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import MCP Configuration
          </DialogTitle>
          <DialogDescription>
            Paste your MCP configuration JSON to import servers. Supports:
            <br />• <strong>Global config</strong>: Complete mcp.json with
            "mcpServers" wrapper
            <br />• <strong>Named server</strong>: Single server with name key
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {/* Configuration Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Configuration JSON</label>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePasteExample}
                  className="h-7 px-2 text-xs"
                >
                  <FileText className="h-3 w-3 mr-1" />
                  Paste Example
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyExample}
                  className="h-7 px-2 text-xs"
                >
                  <Copy className="h-3 w-3 mr-1" />
                  Copy Example
                </Button>
              </div>
            </div>
            <Textarea
              value={configText}
              onChange={(e) => handleConfigChange(e.target.value)}
              placeholder={`Paste your configuration here. Supports two formats:

1. Global config (complete mcp.json):
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-everything"]
    }
  }
}

2. Named server config:
{
  "everything": {
    "command": "npx", 
    "args": ["@modelcontextprotocol/server-everything"]
  }
}

or

{
  "my-sse-server": {
    "url": "https://api.example.com/mcp",
    "type": "sse"
  }
}`}
              className="font-mono text-xs min-h-[200px] resize-none"
            />
          </div>

          {/* Validation Button */}
          <div className="flex gap-2">
            <Button
              onClick={validateConfig}
              disabled={!configText.trim() || isValidating}
              variant="outline"
              className="flex-1"
            >
              {isValidating ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                  Validating...
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 mr-2" />
                  Validate Configuration
                </>
              )}
            </Button>
          </div>

          {/* Validation Results */}
          {parseResult && (
            <div className="space-y-3 flex-1 min-h-0 overflow-y-auto">
              {parseResult.success ? (
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertTitle>Configuration Valid</AlertTitle>
                  <AlertDescription>
                    Found {parseResult.servers.length} server(s) ready to
                    import:
                    <ul className="mt-2 space-y-1">
                      {parseResult.servers.map((server) => (
                        <li key={server.name} className="text-xs font-mono">
                          • <strong>{server.name}</strong> (
                          {server.config.transportType})
                          {server.config.transportType === "stdio" &&
                            "command" in server.config && (
                              <span className="text-muted-foreground ml-2">
                                {server.config.command}{" "}
                                {server.config.args?.join(" ")}
                              </span>
                            )}
                          {server.config.transportType !== "stdio" &&
                            "url" in server.config &&
                            server.config.url && (
                              <span className="text-muted-foreground ml-2">
                                {server.config.url.toString()}
                              </span>
                            )}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Configuration Invalid</AlertTitle>
                  <AlertDescription>
                    <div className="space-y-1">
                      {parseResult.errors.map((error, index) => (
                        <div key={index} className="text-xs font-mono">
                          • {error}
                        </div>
                      ))}
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 pt-4 border-t">
          <Button variant="outline" onClick={handleClose} className="flex-1">
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={!parseResult?.success || parseResult.servers.length === 0}
            className="flex-1"
          >
            <Upload className="h-4 w-4 mr-2" />
            Import {parseResult?.servers.length || 0} Server(s)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ConfigImportDialog;
