import React from "react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Server, Network, ArrowRight, ArrowLeft, Info } from "lucide-react";

interface ModeToggleProps {
  currentMode: "single" | "multi";
  onToggle: () => void;
  isLoading?: boolean;
  serverCount?: number;
  connectedCount?: number;
  className?: string;
}

export const ModeToggle: React.FC<ModeToggleProps> = ({
  currentMode,
  onToggle,
  isLoading = false,
  serverCount = 0,
  connectedCount = 0,
  className = "",
}) => {
  const isSingleMode = currentMode === "single";
  const isMultiMode = currentMode === "multi";

  return (
    <Card className={`w-full max-w-md ${className}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          {isSingleMode ? (
            <Server className="h-5 w-5" />
          ) : (
            <Network className="h-5 w-5" />
          )}
          Connection Mode
        </CardTitle>
        <CardDescription>
          Switch between single and multi-server modes
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Current Mode Display */}
        <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
          <div className="flex items-center gap-2">
            {isSingleMode ? (
              <Server className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Network className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="font-medium">
              {isSingleMode ? "Single Server" : "Multi-Server"}
            </span>
          </div>
          <Badge variant="outline">Active</Badge>
        </div>

        {/* Multi-server Stats */}
        {isMultiMode && (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-center p-2 bg-muted/50 rounded">
              <div className="font-semibold">{serverCount}</div>
              <div className="text-muted-foreground">Servers</div>
            </div>
            <div className="text-center p-2 bg-muted/50 rounded">
              <div className="font-semibold text-green-600">
                {connectedCount}
              </div>
              <div className="text-muted-foreground">Connected</div>
            </div>
          </div>
        )}

        {/* Mode Description */}
        <div className="text-sm text-muted-foreground space-y-2">
          {isSingleMode ? (
            <div className="flex gap-2">
              <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">Single Server Mode</p>
                <p>
                  Connect to one MCP server at a time using the traditional
                  interface.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">Multi-Server Mode</p>
                <p>
                  Manage multiple MCP server connections simultaneously with
                  advanced dashboard features.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Toggle Button */}
        <Button
          onClick={onToggle}
          disabled={isLoading}
          className="w-full"
          variant={isSingleMode ? "default" : "outline"}
          aria-label={`Switch to ${isSingleMode ? "multi-server" : "single-server"} mode`}
          aria-describedby="mode-description"
        >
          {isLoading ? (
            <div className="flex items-center gap-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
              Switching...
            </div>
          ) : isSingleMode ? (
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4" />
              Switch to Multi-Server
              <ArrowRight className="h-4 w-4" />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Switch to Single Server
              <Server className="h-4 w-4" />
            </div>
          )}
        </Button>

        {/* Warning for Multi to Single */}
        {isMultiMode && connectedCount > 0 && (
          <div className="text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-200">
            <div className="flex gap-1">
              <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <p>
                Switching to single-server mode will disconnect from all
                multi-server connections.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// Compact version for sidebar
export const CompactModeToggle: React.FC<ModeToggleProps> = ({
  currentMode,
  onToggle,
  isLoading = false,
  serverCount = 0,
  connectedCount = 0,
  className = "",
}) => {
  const isSingleMode = currentMode === "single";

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Mode</span>
        <Badge variant="outline" className="text-xs">
          {isSingleMode ? "Single" : "Multi"}
        </Badge>
      </div>

      {currentMode === "multi" && serverCount > 0 && (
        <div className="text-xs text-muted-foreground">
          {serverCount} servers • {connectedCount} connected
        </div>
      )}

      <Button
        onClick={onToggle}
        disabled={isLoading}
        size="sm"
        variant="outline"
        className="w-full text-xs"
      >
        {isLoading ? (
          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current" />
        ) : (
          <div className="flex items-center gap-1">
            {isSingleMode ? (
              <>
                <Network className="h-3 w-3" />
                Multi
              </>
            ) : (
              <>
                <Server className="h-3 w-3" />
                Single
              </>
            )}
          </div>
        )}
      </Button>
    </div>
  );
};
