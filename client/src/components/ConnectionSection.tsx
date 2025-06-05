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
  hideActionButtons?: boolean;
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
  hideActionButtons,
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

  const maybeRenderTabs = () => {
    if (connectionStatus === "connected") {
      return null;
    }
    return (
      <div className="flex border-b border-slate-200 dark:border-slate-700 px-4">
        {[
          { key: "auth", label: "Auth" },
          ...(transportType === "stdio"
            ? [{ key: "env", label: "Environment" }]
            : []),
          { key: "config", label: "Configuration" },
          ...(loggingSupported ? [{ key: "logging", label: "Logging" }] : []),
        ].map((tab) => (
          <button
            key={tab.key}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    );
  };

  const maybeRenderContentBody = () => {
    if (connectionStatus === "connected") {
      return null;
    }
    return (
      <div className="p-4 space-y-4">
        {activeTab === "auth" && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Authentication
            </h3>
            {transportType !== "stdio" ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-600 dark:text-slate-400 mb-1 block">
                    Header Name
                  </label>
                  <Input
                    placeholder="Authorization"
                    onChange={(e) =>
                      setHeaderName && setHeaderName(e.target.value)
                    }
                    className="h-8 text-sm"
                    value={headerName}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600 dark:text-slate-400 mb-1 block">
                    Bearer Token
                  </label>
                  <Input
                    placeholder="Bearer Token"
                    value={bearerToken}
                    onChange={(e) => setBearerToken(e.target.value)}
                    className="h-8 text-sm"
                    type="password"
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Authentication is not available for STDIO connections.
              </p>
            )}
          </div>
        )}

        {activeTab === "env" && transportType === "stdio" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Environment Variables
              </h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const key = "";
                  const newEnv = { ...env };
                  newEnv[key] = "";
                  setEnv(newEnv);
                }}
                className="h-7 px-2 text-xs"
              >
                Add Variable
              </Button>
            </div>
            <div className="space-y-2">
              {Object.entries(env).map(([key, value], idx) => (
                <div
                  key={idx}
                  className="border border-slate-200 dark:border-slate-700 rounded p-2 space-y-2"
                >
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
                      className="h-7 text-xs flex-1"
                    />
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                        const { [key]: _removed, ...rest } = env;
                        setEnv(rest);
                      }}
                      className="h-7 w-7 p-0 text-xs"
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
                      className="h-7 text-xs flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
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
                      className="h-7 w-7 p-0"
                    >
                      {shownEnvVars.has(key) ? (
                        <Eye className="h-3 w-3" />
                      ) : (
                        <EyeOff className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "config" && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Configuration
            </h3>
            <div className="space-y-3">
              {Object.entries(config).map(([key, configItem]) => {
                const configKey = key as keyof InspectorConfig;
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-600 dark:text-slate-400">
                        {configItem.label}
                      </label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3 w-3 text-slate-400" />
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
                        className="h-8 text-sm"
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
                        <SelectTrigger className="h-8 text-sm">
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
                        className="h-8 text-sm"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "logging" && loggingSupported && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Logging Configuration
            </h3>
            <div>
              <label className="text-xs text-slate-600 dark:text-slate-400 mb-1 block">
                Logging Level
              </label>
              <Select
                value={logLevel}
                onValueChange={(value: LoggingLevel) =>
                  sendLogLevelRequest(value)
                }
              >
                <SelectTrigger className="w-48 h-8 text-sm">
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
    );
  };

  return (
    <div className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      {/* Header Section */}
      <div className="p-4">
        {/* Main Controls Row */}
        <div className="flex items-center gap-3 mb-3">
          {/* Transport Type Selector */}
          <Select
            value={transportType}
            onValueChange={(value: "stdio" | "sse" | "streamable-http") =>
              setTransportType(value)
            }
          >
            <SelectTrigger className="w-24 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stdio">STDIO</SelectItem>
              <SelectItem value="sse">SSE</SelectItem>
              <SelectItem value="streamable-http">HTTP</SelectItem>
            </SelectContent>
          </Select>

          {/* URL/Command Input */}
          <div className="flex-1">
            {transportType === "stdio" ? (
              <div className="flex gap-2">
                <Input
                  placeholder="npx"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  className="h-8 text-sm flex-1"
                />
                <Input
                  placeholder="@modelcontextprotocol/server-everything"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  className="h-8 text-sm flex-1"
                />
              </div>
            ) : (
              <Input
                placeholder={
                  transportType === "sse"
                    ? "https://mcp.asana.com/sse"
                    : "Enter URL"
                }
                value={sseUrl}
                onChange={(e) => setSseUrl(e.target.value)}
                className="h-8 text-sm"
              />
            )}
          </div>

          {/* Action Buttons */}
          {!hideActionButtons && (
            <div className="flex gap-2">
              {connectionStatus === "connected" ? (
                <>
                  <Button
                    onClick={() => {
                      onDisconnect();
                      onConnect();
                    }}
                    size="sm"
                    className="h-8 px-3 text-xs"
                  >
                    <RotateCcw className="w-3 h-3 mr-1" />
                    {transportType === "stdio" ? "Restart" : "Reconnect"}
                  </Button>
                  <Button
                    onClick={onDisconnect}
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-xs"
                  >
                    <RefreshCwOff className="w-3 h-3 mr-1" />
                    Disconnect
                  </Button>
                </>
              ) : (
                <Button
                  onClick={onConnect}
                  size="sm"
                  className="h-8 px-4 text-xs"
                >
                  <Play className="w-3 h-3 mr-1" />
                  Connect
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Connection Status & Config Actions */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${(() => {
                switch (connectionStatus) {
                  case "connected":
                    return "bg-emerald-500";
                  case "error":
                    return "bg-red-500";
                  case "error-connecting-to-proxy":
                    return "bg-red-500";
                  default:
                    return "bg-slate-400";
                }
              })()}`}
            />
            <span
              className={`${(() => {
                switch (connectionStatus) {
                  case "connected":
                    return "text-emerald-700 dark:text-emerald-300";
                  case "error":
                    return "text-red-700 dark:text-red-300";
                  case "error-connecting-to-proxy":
                    return "text-red-700 dark:text-red-300";
                  default:
                    return "text-slate-600 dark:text-slate-400";
                }
              })()}`}
            >
              {(() => {
                switch (connectionStatus) {
                  case "connected":
                    return "Connected";
                  case "error":
                    return "Connection Error";
                  case "error-connecting-to-proxy":
                    return "Proxy Error";
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
              className="h-6 px-2 text-xs"
            >
              {copiedServerEntry ? (
                <CheckCheck className="h-3 w-3 mr-1 text-emerald-600" />
              ) : (
                <Copy className="h-3 w-3 mr-1" />
              )}
              Copy Entry
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyServerFile}
              className="h-6 px-2 text-xs"
            >
              {copiedServerFile ? (
                <CheckCheck className="h-3 w-3 mr-1 text-emerald-600" />
              ) : (
                <Copy className="h-3 w-3 mr-1" />
              )}
              Copy File
            </Button>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      {maybeRenderTabs()}

      {/* Content Area */}
      {maybeRenderContentBody()}

      {/* Error Notifications */}
      {stdErrNotifications.length > 0 && (
        <div className="border-t border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20">
          <div className="p-3">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-xs font-medium text-red-700 dark:text-red-400 flex items-center gap-1">
                <div className="w-1.5 h-1.5 bg-red-500 rounded-full"></div>
                Error output from MCP server
              </h3>
              <Button
                variant="outline"
                size="sm"
                onClick={clearStdErrNotifications}
                className="h-6 px-2 text-xs"
              >
                Clear
              </Button>
            </div>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {stdErrNotifications.map((notification, index) => (
                <div
                  key={index}
                  className="text-xs text-red-800 dark:text-red-200 font-mono p-2 bg-white/60 dark:bg-slate-900/60 rounded border border-red-200/60 dark:border-red-700/60"
                >
                  {notification.params.content}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConnectionSection;
