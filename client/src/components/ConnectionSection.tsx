import { useState, useCallback } from "react";
import {
  Play,
  Eye,
  EyeOff,
  RotateCcw,
  HelpCircle,
  RefreshCwOff,
  Copy,
  CheckCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StdErrNotification } from "@/lib/notificationTypes";
import {
  LoggingLevel,
  LoggingLevelSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { InspectorConfig } from "@/lib/configurationTypes";
import { ConnectionStatus } from "@/lib/constants";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useToast } from "../lib/hooks/useToast";

interface ConnectionSectionProps {
  connectionStatus: ConnectionStatus;
  transportType: "stdio" | "sse" | "streamable-http";
  setTransportType: (type: "stdio" | "sse" | "streamable-http") => void;
  command: string;
  setCommand: (command: string) => void;
  args: string;
  setArgs: (args: string) => void;
  sseUrl: string;
  setSseUrl: (url: string) => void;
  env: Record<string, string>;
  setEnv: (env: Record<string, string>) => void;
  bearerToken: string;
  setBearerToken: (token: string) => void;
  headerName?: string;
  setHeaderName?: (name: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  stdErrNotifications: StdErrNotification[];
  clearStdErrNotifications: () => void;
  logLevel: LoggingLevel;
  sendLogLevelRequest: (level: LoggingLevel) => void;
  loggingSupported: boolean;
  config: InspectorConfig;
  setConfig: (config: InspectorConfig) => void;
}

const ConnectionSection = ({
  connectionStatus,
  transportType,
  setTransportType,
  command,
  setCommand,
  args,
  setArgs,
  sseUrl,
  setSseUrl,
  env,
  setEnv,
  bearerToken,
  setBearerToken,
  headerName,
  setHeaderName,
  onConnect,
  onDisconnect,
  stdErrNotifications,
  clearStdErrNotifications,
  logLevel,
  sendLogLevelRequest,
  loggingSupported,
  config,
  setConfig,
}: ConnectionSectionProps) => {
  const [activeTab, setActiveTab] = useState("connection");
  const [shownEnvVars, setShownEnvVars] = useState<Set<string>>(new Set());
  const [copiedServerEntry, setCopiedServerEntry] = useState(false);
  const [copiedServerFile, setCopiedServerFile] = useState(false);
  const { toast } = useToast();

  // Reusable error reporter for copy actions
  const reportError = useCallback(
    (error: unknown) => {
      toast({
        title: "Error",
        description: `Failed to copy config: ${error instanceof Error ? error.message : String(error)}`,
        variant: "destructive",
      });
    },
    [toast],
  );

  // Shared utility function to generate server config
  const generateServerConfig = useCallback(() => {
    if (transportType === "stdio") {
      return {
        command,
        args: args.trim() ? args.split(/\s+/) : [],
        env: { ...env },
      };
    }
    if (transportType === "sse") {
      return {
        type: "sse",
        url: sseUrl,
        note: "For SSE connections, add this URL directly in your MCP Client",
      };
    }
    if (transportType === "streamable-http") {
      return {
        type: "streamable-http",
        url: sseUrl,
        note: "For Streamable HTTP connections, add this URL directly in your MCP Client",
      };
    }
    return {};
  }, [transportType, command, args, env, sseUrl]);

  // Memoized config entry generator
  const generateMCPServerEntry = useCallback(() => {
    return JSON.stringify(generateServerConfig(), null, 4);
  }, [generateServerConfig]);

  // Memoized config file generator
  const generateMCPServerFile = useCallback(() => {
    return JSON.stringify(
      {
        mcpServers: {
          "default-server": generateServerConfig(),
        },
      },
      null,
      4,
    );
  }, [generateServerConfig]);

  // Memoized copy handlers
  const handleCopyServerEntry = useCallback(() => {
    try {
      const configJson = generateMCPServerEntry();
      navigator.clipboard
        .writeText(configJson)
        .then(() => {
          setCopiedServerEntry(true);

          toast({
            title: "Config entry copied",
            description:
              transportType === "stdio"
                ? "Server configuration has been copied to clipboard. Add this to your mcp.json inside the 'mcpServers' object with your preferred server name."
                : "SSE URL has been copied. Use this URL directly in your MCP Client.",
          });

          setTimeout(() => {
            setCopiedServerEntry(false);
          }, 2000);
        })
        .catch((error) => {
          reportError(error);
        });
    } catch (error) {
      reportError(error);
    }
  }, [generateMCPServerEntry, transportType, toast, reportError]);

  const handleCopyServerFile = useCallback(() => {
    try {
      const configJson = generateMCPServerFile();
      navigator.clipboard
        .writeText(configJson)
        .then(() => {
          setCopiedServerFile(true);

          toast({
            title: "Servers file copied",
            description:
              "Servers configuration has been copied to clipboard. Add this to your mcp.json file. Current testing server will be added as 'default-server'",
          });

          setTimeout(() => {
            setCopiedServerFile(false);
          }, 2000);
        })
        .catch((error) => {
          reportError(error);
        });
    } catch (error) {
      reportError(error);
    }
  }, [generateMCPServerFile, toast, reportError]);

  return (
    <div className="flex flex-col bg-background">
      <div className="border-b border-border bg-card">
        <div className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <Select
              value={transportType}
              onValueChange={(value: "stdio" | "sse" | "streamable-http") =>
                setTransportType(value)
              }
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select transport type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">STDIO</SelectItem>
                <SelectItem value="sse">SSE</SelectItem>
                <SelectItem value="streamable-http">Streamable HTTP</SelectItem>
              </SelectContent>
            </Select>

            {/* URL/Command Input (like URL in Postman) */}
            <div className="flex-1">
              {transportType === "stdio" ? (
                <div className="flex gap-2">
                  <Input
                    placeholder="Command"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    className="font-mono flex-1"
                  />
                  <Input
                    placeholder="Arguments (space-separated)"
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                    className="font-mono flex-1"
                  />
                </div>
              ) : (
                <Input
                  placeholder="Enter URL"
                  value={sseUrl}
                  onChange={(e) => setSseUrl(e.target.value)}
                  className="font-mono"
                />
              )}
            </div>

            {/* Connect Button (like Send in Postman) */}
            <div className="flex gap-2">
              {connectionStatus === "connected" ? (
                <>
                  <Button
                    onClick={() => {
                      onDisconnect();
                      onConnect();
                    }}
                    className="px-6"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    {transportType === "stdio" ? "Restart" : "Reconnect"}
                  </Button>
                  <Button onClick={onDisconnect} variant="outline">
                    <RefreshCwOff className="w-4 h-4 mr-2" />
                    Disconnect
                  </Button>
                </>
              ) : (
                <Button onClick={onConnect} className="px-8">
                  <Play className="w-4 h-4 mr-2" />
                  Connect
                </Button>
              )}
            </div>
          </div>

          {/* Connection Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div
                className={`w-2 h-2 rounded-full ${(() => {
                  switch (connectionStatus) {
                    case "connected":
                      return "bg-green-500";
                    case "error":
                      return "bg-red-500";
                    case "error-connecting-to-proxy":
                      return "bg-red-500";
                    default:
                      return "bg-gray-500";
                  }
                })()}`}
              />
              <span className="text-sm text-muted-foreground">
                {(() => {
                  switch (connectionStatus) {
                    case "connected":
                      return "Connected";
                    case "error":
                      return "Connection Error, is your MCP server running?";
                    case "error-connecting-to-proxy":
                      return "Error Connecting to MCP Inspector Proxy - Check Console logs";
                    default:
                      return "Disconnected";
                  }
                })()}
              </span>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyServerEntry}
              >
                {copiedServerEntry ? (
                  <CheckCheck className="h-4 w-4 mr-2" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                Copy Entry
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyServerFile}
              >
                {copiedServerFile ? (
                  <CheckCheck className="h-4 w-4 mr-2" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                Copy File
              </Button>
            </div>
          </div>
        </div>

        {/* Postman-style tabs */}
        <div className="flex border-b border-border">
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "connection"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("connection")}
          >
            Connection
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "auth"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("auth")}
          >
            Auth
          </button>
          {transportType === "stdio" && (
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "env"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab("env")}
            >
              Environment
            </button>
          )}
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "config"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("config")}
          >
            Configuration
          </button>
          {loggingSupported && connectionStatus === "connected" && (
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "logging"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab("logging")}
            >
              Logging
            </button>
          )}
        </div>
      </div>

      {/* Tab Content */}
      <div className="">
        <div className="p-4">
          {activeTab === "auth" && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Authentication</h3>
              {transportType !== "stdio" ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Header Name</label>
                    <Input
                      placeholder="Authorization"
                      onChange={(e) =>
                        setHeaderName && setHeaderName(e.target.value)
                      }
                      className="font-mono"
                      value={headerName}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Bearer Token</label>
                    <Input
                      placeholder="Bearer Token"
                      value={bearerToken}
                      onChange={(e) => setBearerToken(e.target.value)}
                      className="font-mono"
                      type="password"
                    />
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  Authentication is not available for STDIO connections.
                </p>
              )}
            </div>
          )}

          {activeTab === "env" && transportType === "stdio" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Environment Variables</h3>
                <Button
                  variant="outline"
                  onClick={() => {
                    const key = "";
                    const newEnv = { ...env };
                    newEnv[key] = "";
                    setEnv(newEnv);
                  }}
                >
                  Add Variable
                </Button>
              </div>
              <div className="space-y-3">
                {Object.entries(env).map(([key, value], idx) => (
                  <div key={idx} className="space-y-2 p-3 border rounded-lg">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Key"
                        value={key}
                        onChange={(e) => {
                          const newKey = e.target.value;
                          const newEnv = Object.entries(env).reduce(
                            (acc, [k, v]) => {
                              if (k === key) {
                                acc[newKey] = value;
                              } else {
                                acc[k] = v;
                              }
                              return acc;
                            },
                            {} as Record<string, string>,
                          );
                          setEnv(newEnv);
                          setShownEnvVars((prev) => {
                            const next = new Set(prev);
                            if (next.has(key)) {
                              next.delete(key);
                              next.add(newKey);
                            }
                            return next;
                          });
                        }}
                        className="font-mono"
                      />
                      <Button
                        variant="destructive"
                        size="icon"
                        onClick={() => {
                          // eslint-disable-next-line @typescript-eslint/no-unused-vars
                          const { [key]: _removed, ...rest } = env;
                          setEnv(rest);
                        }}
                      >
                        ×
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        type={shownEnvVars.has(key) ? "text" : "password"}
                        placeholder="Value"
                        value={value}
                        onChange={(e) => {
                          const newEnv = { ...env };
                          newEnv[key] = e.target.value;
                          setEnv(newEnv);
                        }}
                        className="font-mono"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          setShownEnvVars((prev) => {
                            const next = new Set(prev);
                            if (next.has(key)) {
                              next.delete(key);
                            } else {
                              next.add(key);
                            }
                            return next;
                          });
                        }}
                      >
                        {shownEnvVars.has(key) ? (
                          <Eye className="h-4 w-4" />
                        ) : (
                          <EyeOff className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "config" && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Configuration</h3>
              <div className="space-y-4">
                {Object.entries(config).map(([key, configItem]) => {
                  const configKey = key as keyof InspectorConfig;
                  return (
                    <div key={key} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-green-600">
                          {configItem.label}
                        </label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="h-4 w-4 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent>
                            {configItem.description}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      {typeof configItem.value === "number" ? (
                        <Input
                          type="number"
                          value={configItem.value}
                          onChange={(e) => {
                            const newConfig = { ...config };
                            newConfig[configKey] = {
                              ...configItem,
                              value: Number(e.target.value),
                            };
                            setConfig(newConfig);
                          }}
                          className="font-mono"
                        />
                      ) : typeof configItem.value === "boolean" ? (
                        <Select
                          value={configItem.value.toString()}
                          onValueChange={(val) => {
                            const newConfig = { ...config };
                            newConfig[configKey] = {
                              ...configItem,
                              value: val === "true",
                            };
                            setConfig(newConfig);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="true">True</SelectItem>
                            <SelectItem value="false">False</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={configItem.value}
                          onChange={(e) => {
                            const newConfig = { ...config };
                            newConfig[configKey] = {
                              ...configItem,
                              value: e.target.value,
                            };
                            setConfig(newConfig);
                          }}
                          className="font-mono"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === "logging" &&
            loggingSupported &&
            connectionStatus === "connected" && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Logging Configuration</h3>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Logging Level</label>
                  <Select
                    value={logLevel}
                    onValueChange={(value: LoggingLevel) =>
                      sendLogLevelRequest(value)
                    }
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Select logging level" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.values(LoggingLevelSchema.enum).map((level) => (
                        <SelectItem key={level} value={level}>
                          {level}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
        </div>

        {/* Error Notifications */}
        {stdErrNotifications.length > 0 && (
          <div className="border-t border-border bg-destructive/5">
            <div className="p-4">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-medium text-destructive">
                  Error output from MCP server
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearStdErrNotifications}
                >
                  Clear
                </Button>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-2">
                {stdErrNotifications.map((notification, index) => (
                  <div
                    key={index}
                    className="text-sm text-destructive font-mono p-2 bg-background rounded border"
                  >
                    {notification.params.content}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectionSection;
