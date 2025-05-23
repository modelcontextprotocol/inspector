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

  const maybeRenderTabs = () => {
    if (connectionStatus === "connected") {
      return null;
    }
    return (
      <div className="flex border-b border-slate-200/60 dark:border-slate-700/60 px-6 bg-gradient-to-r from-slate-50/50 to-white/50 dark:from-slate-900/50 dark:to-slate-800/50">
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
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-all duration-200 relative ${
              activeTab === tab.key
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600"
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {activeTab === tab.key && (
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-blue-500 to-blue-600 shadow-lg"></div>
            )}
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
      <div className="flex-1 overflow-auto">
        <div className="p-6">
          {activeTab === "auth" && (
            <div className="space-y-6">
              <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm rounded-xl p-6 border border-slate-200/60 dark:border-slate-700/60 shadow-lg">
                <h3 className="text-xl font-semibold mb-6 text-slate-800  bg-clip-text">
                  Authentication
                </h3>
                {transportType !== "stdio" ? (
                  <div className="space-y-5">
                    <div className="space-y-3">
                      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Header Name
                      </label>
                      <Input
                        placeholder="Authorization"
                        onChange={(e) =>
                          setHeaderName && setHeaderName(e.target.value)
                        }
                        className="font-mono h-11 bg-white/70 dark:bg-slate-900/70 backdrop-blur-sm border-slate-300/60 dark:border-slate-600/60 hover:border-blue-400/60 dark:hover:border-blue-500/60 focus:border-blue-500 dark:focus:border-blue-400 transition-all duration-200 shadow-sm hover:shadow-md focus:shadow-lg"
                        value={headerName}
                      />
                    </div>
                    <div className="space-y-3">
                      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Bearer Token
                      </label>
                      <Input
                        placeholder="Bearer Token"
                        value={bearerToken}
                        onChange={(e) => setBearerToken(e.target.value)}
                        className="font-mono h-11 bg-white/70 dark:bg-slate-900/70 backdrop-blur-sm border-slate-300/60 dark:border-slate-600/60 hover:border-blue-400/60 dark:hover:border-blue-500/60 focus:border-blue-500 dark:focus:border-blue-400 transition-all duration-200 shadow-sm hover:shadow-md focus:shadow-lg"
                        type="password"
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-600 dark:text-slate-400 italic">
                    Authentication is not available for STDIO connections.
                  </p>
                )}
              </div>
            </div>
          )}

          {activeTab === "env" && transportType === "stdio" && (
            <div className="space-y-6">
              <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm rounded-xl p-6 border border-slate-200/60 dark:border-slate-700/60 shadow-lg">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-semibold text-slate-800bg-clip-text">
                    Environment Variables
                  </h3>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const key = "";
                      const newEnv = { ...env };
                      newEnv[key] = "";
                      setEnv(newEnv);
                    }}
                    className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm border-slate-300/60 dark:border-slate-600/60 hover:border-emerald-400/60 dark:hover:border-emerald-500/60 hover:bg-emerald-50/80 dark:hover:bg-emerald-900/20 transition-all duration-200 shadow-sm hover:shadow-md"
                  >
                    Add Variable
                  </Button>
                </div>
                <div className="space-y-4">
                  {Object.entries(env).map(([key, value], idx) => (
                    <div
                      key={idx}
                      className="bg-white/40 dark:bg-slate-900/40 backdrop-blur-sm rounded-lg p-4 border border-slate-200/40 dark:border-slate-700/40 shadow-md hover:shadow-lg transition-all duration-200"
                    >
                      <div className="flex gap-3 mb-3">
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
                          className="font-mono flex-1 h-10 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm border-slate-300/60 dark:border-slate-600/60 hover:border-blue-400/60 dark:hover:border-blue-500/60 focus:border-blue-500 dark:focus:border-blue-400 transition-all duration-200"
                        />
                        <Button
                          variant="destructive"
                          size="icon"
                          onClick={() => {
                            // eslint-disable-next-line @typescript-eslint/no-unused-vars
                            const { [key]: _removed, ...rest } = env;
                            setEnv(rest);
                          }}
                          className="h-10 w-10 bg-red-500/80 hover:bg-red-600/90 shadow-md hover:shadow-lg transition-all duration-200"
                        >
                          ×
                        </Button>
                      </div>
                      <div className="flex gap-3">
                        <Input
                          type={shownEnvVars.has(key) ? "text" : "password"}
                          placeholder="Value"
                          value={value}
                          onChange={(e) => {
                            const newEnv = { ...env };
                            newEnv[key] = e.target.value;
                            setEnv(newEnv);
                          }}
                          className="font-mono flex-1 h-10 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm border-slate-300/60 dark:border-slate-600/60 hover:border-blue-400/60 dark:hover:border-blue-500/60 focus:border-blue-500 dark:focus:border-blue-400 transition-all duration-200"
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
                          className="h-10 w-10 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm border-slate-300/60 dark:border-slate-600/60 hover:border-blue-400/60 dark:hover:border-blue-500/60 hover:bg-blue-50/80 dark:hover:bg-blue-900/20 transition-all duration-200"
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
            </div>
          )}

          {activeTab === "config" && (
            <div className="space-y-6">
              <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm rounded-xl p-6 border border-slate-200/60 dark:border-slate-700/60 shadow-lg">
                <h3 className="text-xl font-semibold mb-6 text-slate-800 bg-clip-text">
                  Configuration
                </h3>
                <div className="space-y-5">
                  {Object.entries(config).map(([key, configItem]) => {
                    const configKey = key as keyof InspectorConfig;
                    return (
                      <div
                        key={key}
                        className="space-y-3 p-4 bg-white/40 dark:bg-slate-900/40 backdrop-blur-sm rounded-lg border border-slate-200/40 dark:border-slate-700/40 shadow-sm hover:shadow-md transition-all duration-200"
                      >
                        <div className="flex items-center gap-3">
                          <label className="text-sm font-medium text-slate-800">
                            {configItem.label}
                          </label>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="h-4 w-4 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200" />
                            </TooltipTrigger>
                            <TooltipContent className="bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl border-slate-200/60 dark:border-slate-700/60 shadow-xl">
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
                            className="font-mono h-10 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm border-slate-300/60 dark:border-slate-600/60 hover:border-blue-400/60 dark:hover:border-blue-500/60 focus:border-blue-500 dark:focus:border-blue-400 transition-all duration-200"
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
                            <SelectTrigger className="h-10 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm border-slate-300/60 dark:border-slate-600/60 hover:border-blue-400/60 dark:hover:border-blue-500/60 transition-all duration-200">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl border-slate-200/60 dark:border-slate-700/60 shadow-xl">
                              <SelectItem
                                value="true"
                                className="hover:bg-blue-50/80 dark:hover:bg-blue-900/30"
                              >
                                True
                              </SelectItem>
                              <SelectItem
                                value="false"
                                className="hover:bg-blue-50/80 dark:hover:bg-blue-900/30"
                              >
                                False
                              </SelectItem>
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
                            className="font-mono h-10 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm border-slate-300/60 dark:border-slate-600/60 hover:border-blue-400/60 dark:hover:border-blue-500/60 focus:border-blue-500 dark:focus:border-blue-400 transition-all duration-200"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === "logging" && loggingSupported && (
            <div className="space-y-6">
              <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm rounded-xl p-6 border border-slate-200/60 dark:border-slate-700/60 shadow-lg">
                <h3 className="text-xl font-semibold mb-6 text-slate-800 dark:text-slate-200 bg-gradient-to-r from-orange-600 to-orange-800 dark:from-orange-400 dark:to-orange-600 bg-clip-text text-transparent">
                  Logging Configuration
                </h3>
                <div className="space-y-3">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Logging Level
                  </label>
                  <Select
                    value={logLevel}
                    onValueChange={(value: LoggingLevel) =>
                      sendLogLevelRequest(value)
                    }
                  >
                    <SelectTrigger className="w-64 h-11 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm border-slate-300/60 dark:border-slate-600/60 hover:border-blue-400/60 dark:hover:border-blue-500/60 transition-all duration-200 shadow-sm hover:shadow-md">
                      <SelectValue placeholder="Select logging level" />
                    </SelectTrigger>
                    <SelectContent className="bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl border-slate-200/60 dark:border-slate-700/60 shadow-xl">
                      {Object.values(LoggingLevelSchema.enum).map((level) => (
                        <SelectItem
                          key={level}
                          value={level}
                          className="hover:bg-blue-50/80 dark:hover:bg-blue-900/30"
                        >
                          {level}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Error Notifications with Modern Styling */}
        {stdErrNotifications.length > 0 && (
          <div className="border-t border-red-200/60 dark:border-red-800/60 bg-gradient-to-r from-red-50/80 to-rose-50/80 dark:from-red-950/60 dark:to-rose-950/60 backdrop-blur-sm">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-semibold text-red-700 dark:text-red-400 flex items-center gap-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                  Error output from MCP server
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearStdErrNotifications}
                  className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm border-red-300/60 dark:border-red-600/60 hover:border-red-500/60 dark:hover:border-red-400/60 hover:bg-red-50/80 dark:hover:bg-red-900/20 transition-all duration-200 shadow-sm hover:shadow-md"
                >
                  Clear
                </Button>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-3">
                {stdErrNotifications.map((notification, index) => (
                  <div
                    key={index}
                    className="text-sm text-red-800 dark:text-red-200 font-mono p-4 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm rounded-lg border border-red-200/60 dark:border-red-700/60 shadow-md hover:shadow-lg transition-all duration-200"
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

  return (
    <div className="flex flex-col bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-800">
      {/* Header Section with Modern Glass Effect */}
      <div className="backdrop-blur-xl bg-white/80 dark:bg-slate-900/80 border-b border-slate-200/60 dark:border-slate-700/60 shadow-sm">
        <div className="p-6">
          {/* Main Controls Row */}
          <div className="flex items-center gap-4 mb-6">
            {/* Transport Type Selector */}
            <div className="relative">
              <Select
                value={transportType}
                onValueChange={(value: "stdio" | "sse" | "streamable-http") =>
                  setTransportType(value)
                }
              >
                <SelectTrigger className="w-36 h-11 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm border-slate-300/60 dark:border-slate-600/60 hover:border-blue-400/60 dark:hover:border-blue-500/60 transition-all duration-200 shadow-sm hover:shadow-md">
                  <SelectValue placeholder="Select transport type" />
                </SelectTrigger>
                <SelectContent className="bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl border-slate-200/60 dark:border-slate-700/60 shadow-xl">
                  <SelectItem
                    value="stdio"
                    className="hover:bg-blue-50/80 dark:hover:bg-blue-900/30"
                  >
                    STDIO
                  </SelectItem>
                  <SelectItem
                    value="sse"
                    className="hover:bg-blue-50/80 dark:hover:bg-blue-900/30"
                  >
                    SSE
                  </SelectItem>
                  <SelectItem
                    value="streamable-http"
                    className="hover:bg-blue-50/80 dark:hover:bg-blue-900/30"
                  >
                    HTTP
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* URL/Command Input */}
            <div className="flex-1">
              {transportType === "stdio" ? (
                <div className="flex gap-3">
                  <Input
                    placeholder="npx"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    className="font-mono flex-1 h-11 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm border-slate-300/60 dark:border-slate-600/60 hover:border-blue-400/60 dark:hover:border-blue-500/60 focus:border-blue-500 dark:focus:border-blue-400 transition-all duration-200 shadow-sm hover:shadow-md focus:shadow-lg"
                  />
                  <Input
                    placeholder="@modelcontextprotocol/server-brave-search"
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                    className="font-mono flex-1 h-11 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm border-slate-300/60 dark:border-slate-600/60 hover:border-blue-400/60 dark:hover:border-blue-500/60 focus:border-blue-500 dark:focus:border-blue-400 transition-all duration-200 shadow-sm hover:shadow-md focus:shadow-lg"
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
                  className="font-mono h-11 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm border-slate-300/60 dark:border-slate-600/60 hover:border-blue-400/60 dark:hover:border-blue-500/60 focus:border-blue-500 dark:focus:border-blue-400 transition-all duration-200 shadow-sm hover:shadow-md focus:shadow-lg"
                />
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              {connectionStatus === "connected" ? (
                <>
                  <Button
                    onClick={() => {
                      onDisconnect();
                      onConnect();
                    }}
                    className="px-6 h-11 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    {transportType === "stdio" ? "Restart" : "Reconnect"}
                  </Button>
                  <Button
                    onClick={onDisconnect}
                    variant="outline"
                    className="h-11 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm border-slate-300/60 dark:border-slate-600/60 hover:border-red-400/60 dark:hover:border-red-500/60 hover:bg-red-50/80 dark:hover:bg-red-900/20 transition-all duration-200 shadow-sm hover:shadow-md"
                  >
                    <RefreshCwOff className="w-4 h-4 mr-2" />
                    Disconnect
                  </Button>
                </>
              ) : (
                <Button
                  onClick={onConnect}
                  className="px-8 h-11 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Connect
                </Button>
              )}
            </div>
          </div>

          {/* Connection Status & Config Actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="relative">
                <div
                  className={`w-3 h-3 rounded-full shadow-lg ${(() => {
                    switch (connectionStatus) {
                      case "connected":
                        return "bg-emerald-500 shadow-emerald-500/50";
                      case "error":
                        return "bg-red-500 shadow-red-500/50";
                      case "error-connecting-to-proxy":
                        return "bg-red-500 shadow-red-500/50";
                      default:
                        return "bg-slate-400 shadow-slate-400/50";
                    }
                  })()}`}
                />
                {connectionStatus === "connected" && (
                  <div className="absolute inset-0 w-3 h-3 rounded-full bg-emerald-500 animate-ping opacity-75"></div>
                )}
              </div>
              <span
                className={`text-sm font-medium ${(() => {
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
                      return "Connection Error, is your MCP server running?";
                    case "error-connecting-to-proxy":
                      return "Error Connecting to MCP Inspector Proxy - Check Console logs";
                    default:
                      return "Disconnected";
                  }
                })()}
              </span>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyServerEntry}
                className="h-9 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm border-slate-300/60 dark:border-slate-600/60 hover:border-blue-400/60 dark:hover:border-blue-500/60 hover:bg-blue-50/80 dark:hover:bg-blue-900/20 transition-all duration-200 shadow-sm hover:shadow-md"
              >
                {copiedServerEntry ? (
                  <CheckCheck className="h-4 w-4 mr-2 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                Copy Entry
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyServerFile}
                className="h-9 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm border-slate-300/60 dark:border-slate-600/60 hover:border-blue-400/60 dark:hover:border-blue-500/60 hover:bg-blue-50/80 dark:hover:bg-blue-900/20 transition-all duration-200 shadow-sm hover:shadow-md"
              >
                {copiedServerFile ? (
                  <CheckCheck className="h-4 w-4 mr-2 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                Copy File
              </Button>
            </div>
          </div>
        </div>

        {/* Modern Tab Navigation */}
        {maybeRenderTabs()}
      </div>

      {/* Content Area with Modern Styling */}
      {maybeRenderContentBody()}

      {/* Error Notifications with Modern Styling */}
      {stdErrNotifications.length > 0 && (
        <div className="border-t border-red-200/60 dark:border-red-800/60 bg-gradient-to-r from-red-50/80 to-rose-50/80 dark:from-red-950/60 dark:to-rose-950/60 backdrop-blur-sm">
          <div className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-semibold text-red-700 dark:text-red-400 flex items-center gap-2">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                Error output from MCP server
              </h3>
              <Button
                variant="outline"
                size="sm"
                onClick={clearStdErrNotifications}
                className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm border-red-300/60 dark:border-red-600/60 hover:border-red-500/60 dark:hover:border-red-400/60 hover:bg-red-50/80 dark:hover:bg-red-900/20 transition-all duration-200 shadow-sm hover:shadow-md"
              >
                Clear
              </Button>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-3">
              {stdErrNotifications.map((notification, index) => (
                <div
                  key={index}
                  className="text-sm text-red-800 dark:text-red-200 font-mono p-4 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm rounded-lg border border-red-200/60 dark:border-red-700/60 shadow-md hover:shadow-lg transition-all duration-200"
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
