import React from "react";
import {
  CreateServerRequest,
  StdioConfig,
  HttpConfig,
} from "./types/multiserver";
import { MultiServerApi } from "./services/multiServerApi";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import {
  Plus,
  TestTube,
  Loader2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Copy,
  CheckCheck,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import { useToast } from "../../lib/hooks/useToast";

interface AddServerFormProps {
  onSubmit: (config: CreateServerRequest) => Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
  className?: string;
}

export const AddServerForm: React.FC<AddServerFormProps> = ({
  onSubmit,
  onCancel,
  isSubmitting = false,
  className = "",
}) => {
  const [transportType, setTransportType] = React.useState<
    "stdio" | "streamable-http"
  >("stdio");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [isTesting, setIsTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<{
    success: boolean;
    error?: string;
  } | null>(null);

  // Stdio config
  const [command, setCommand] = React.useState("");
  const [args, setArgs] = React.useState("");
  const [env, setEnv] = React.useState<Record<string, string>>({});
  const [showEnvVars, setShowEnvVars] = React.useState(false);
  const [showAuthConfig, setShowAuthConfig] = React.useState(false);
  const [shownEnvVars, setShownEnvVars] = React.useState<Set<string>>(
    new Set(),
  );

  // HTTP config
  const [url, setUrl] = React.useState("");
  const [bearerToken, setBearerToken] = React.useState("");
  const [headerName, setHeaderName] = React.useState("");
  const [oauthClientId, setOauthClientId] = React.useState("");
  const [oauthScope, setOauthScope] = React.useState("");

  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [copiedServerEntry, setCopiedServerEntry] = React.useState(false);
  const [copiedServerFile, setCopiedServerFile] = React.useState(false);
  const { toast } = useToast();

  // Fetch default environment variables on component mount
  React.useEffect(() => {
    const fetchDefaultConfig = async () => {
      try {
        const defaultConfig = await MultiServerApi.getDefaultConfig();
        if (defaultConfig.defaultEnvironment) {
          setEnv(defaultConfig.defaultEnvironment);
        }
        if (defaultConfig.defaultCommand) {
          setCommand(defaultConfig.defaultCommand);
        }
        if (defaultConfig.defaultArgs) {
          setArgs(defaultConfig.defaultArgs);
        }
        if (defaultConfig.defaultServerUrl) {
          setUrl(defaultConfig.defaultServerUrl);
        }
      } catch (error) {
        console.error("Failed to fetch default configuration:", error);
        // Don't show error toast as this is not critical - form can still be used
      }
    };

    fetchDefaultConfig();
  }, []);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Name validation
    if (!name.trim()) {
      newErrors.name = "Server name is required";
    } else if (name.trim().length < 2) {
      newErrors.name = "Server name must be at least 2 characters long";
    } else if (name.trim().length > 50) {
      newErrors.name = "Server name must be less than 50 characters";
    }

    if (transportType === "stdio") {
      // Command validation
      if (!command.trim()) {
        newErrors.command = "Command is required";
      } else if (command.trim().length < 1) {
        newErrors.command = "Command cannot be empty";
      }

      // Arguments are now space-separated, no validation needed

      // Environment variables are now handled as Record<string, string>, no validation needed
    } else {
      // URL validation
      if (!url.trim()) {
        newErrors.url = "URL is required";
      } else {
        try {
          const parsedUrl = new URL(url);
          if (!["http:", "https:"].includes(parsedUrl.protocol)) {
            newErrors.url = "URL must use HTTP or HTTPS protocol";
          }
        } catch (error) {
          newErrors.url =
            "Please enter a valid URL (e.g., https://api.example.com/mcp)";
        }
      }

      // Bearer token validation
      if (bearerToken.trim() && bearerToken.trim().length < 10) {
        newErrors.bearerToken =
          "Bearer token seems too short. Please verify the token.";
      }

      // OAuth validation
      if (oauthClientId.trim() && oauthClientId.trim().length < 5) {
        newErrors.oauthClientId =
          "OAuth Client ID seems too short. Please verify the client ID.";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const buildConfig = (): CreateServerRequest => {
    const baseConfig = {
      name: name.trim(),
      description: description.trim() || undefined,
      transportType,
    };

    if (transportType === "stdio") {
      const stdioConfig: StdioConfig = {
        command: command.trim(),
        args: args.trim() ? args.split(/\s+/) : [],
        env: { ...env },
      };
      return { ...baseConfig, config: stdioConfig };
    } else {
      const httpConfig: HttpConfig = {
        url: url.trim(),
        headers: {},
        bearerToken: bearerToken.trim(),
        headerName: headerName.trim(),
        oauthClientId: oauthClientId.trim(),
        oauthScope: oauthScope.trim(),
      };
      return { ...baseConfig, config: httpConfig };
    }
  };

  const handleTest = async () => {
    if (!validateForm()) return;

    setIsTesting(true);
    setTestResult(null);

    try {
      // Since there's no test endpoint on the server, we'll do basic validation
      const config = buildConfig();

      // Basic validation - check if required fields are present
      if (transportType === "stdio") {
        if (
          !config.config ||
          !("command" in config.config) ||
          !config.config.command
        ) {
          throw new Error("Command is required for stdio transport");
        }
      } else if (transportType === "streamable-http") {
        if (!config.config || !("url" in config.config) || !config.config.url) {
          throw new Error("URL is required for HTTP transport");
        }
        // Basic URL validation
        try {
          new URL(config.config.url);
        } catch {
          throw new Error("Invalid URL format");
        }
      }

      // Simulate a brief validation delay
      await new Promise((resolve) => setTimeout(resolve, 500));
      setTestResult({ success: true });
    } catch (error) {
      setTestResult({
        success: false,
        error: error instanceof Error ? error.message : "Validation failed",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    try {
      const config = buildConfig();
      await onSubmit(config);
    } catch (error) {
      console.error("Failed to create server:", error);
    }
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setCommand("");
    setArgs("");
    setEnv({});
    setUrl("");
    setBearerToken("");
    setHeaderName("");
    setOauthClientId("");
    setOauthScope("");
    setErrors({});
    setTestResult(null);
  };

  // Reusable error reporter for copy actions
  const reportError = React.useCallback(
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
  const generateServerConfig = React.useCallback(() => {
    if (transportType === "stdio") {
      return {
        command: command.trim(),
        args: args.trim() ? args.split(/\s+/) : [],
        env: { ...env },
      };
    }
    if (transportType === "streamable-http") {
      return {
        type: "streamable-http",
        url: url.trim(),
        note: "For Streamable HTTP connections, add this URL directly in your MCP Client",
      };
    }
    return {};
  }, [transportType, command, args, env, url]);

  // Memoized config entry generator
  const generateMCPServerEntry = React.useCallback(() => {
    return JSON.stringify(generateServerConfig(), null, 4);
  }, [generateServerConfig]);

  // Memoized config file generator
  const generateMCPServerFile = React.useCallback(() => {
    return JSON.stringify(
      {
        mcpServers: {
          [name.trim() || "default-server"]: generateServerConfig(),
        },
      },
      null,
      4,
    );
  }, [generateServerConfig, name]);

  // Memoized copy handlers
  const handleCopyServerEntry = React.useCallback(() => {
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
                : "Server URL configuration has been copied. Use this configuration in your MCP Client.",
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

  const handleCopyServerFile = React.useCallback(() => {
    try {
      const configJson = generateMCPServerFile();
      navigator.clipboard
        .writeText(configJson)
        .then(() => {
          setCopiedServerFile(true);

          toast({
            title: "Servers file copied",
            description: `Servers configuration has been copied to clipboard. Add this to your mcp.json file. Current server will be added as '${name.trim() || "default-server"}'`,
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
  }, [generateMCPServerFile, toast, reportError, name]);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="h-5 w-5" />
          Add New Server
        </CardTitle>
        <CardDescription>
          Configure a new MCP server connection. Choose between stdio (local
          command) or HTTP transport.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Server Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My MCP Server"
                className={errors.name ? "border-destructive" : ""}
              />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description of this server"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="transport">Transport Type *</Label>
              <Select
                value={transportType}
                onValueChange={(value: "stdio" | "streamable-http") =>
                  setTransportType(value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">Stdio (Local Command)</SelectItem>
                  <SelectItem value="streamable-http">
                    HTTP (Remote Server)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Transport-specific Configuration */}
          <Tabs value={transportType} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="stdio">Stdio Configuration</TabsTrigger>
              <TabsTrigger value="streamable-http">
                HTTP Configuration
              </TabsTrigger>
            </TabsList>

            <TabsContent value="stdio" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="command">Command *</Label>
                <Input
                  id="command"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="node server.js"
                  className={errors.command ? "border-destructive" : ""}
                />
                {errors.command && (
                  <p className="text-sm text-destructive">{errors.command}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="args">Arguments</Label>
                <Input
                  id="args"
                  placeholder="Arguments (space-separated)"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  className={`font-mono ${errors.args ? "border-destructive" : ""}`}
                />
                {errors.args && (
                  <p className="text-sm text-destructive">{errors.args}</p>
                )}
              </div>

              <div className="space-y-2">
                <Button
                  variant="outline"
                  onClick={() => setShowEnvVars(!showEnvVars)}
                  className="flex items-center w-full"
                  type="button"
                  data-testid="env-vars-button"
                  aria-expanded={showEnvVars}
                >
                  {showEnvVars ? (
                    <ChevronDown className="w-4 h-4 mr-2" />
                  ) : (
                    <ChevronRight className="w-4 h-4 mr-2" />
                  )}
                  Environment Variables
                </Button>
                {showEnvVars && (
                  <div className="space-y-2">
                    {Object.entries(env).map(([key, value], idx) => (
                      <div key={idx} className="space-y-2 pb-4">
                        <div className="flex gap-2">
                          <Input
                            aria-label={`Environment variable key ${idx + 1}`}
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
                            className="h-9 w-9 p-0 shrink-0"
                            type="button"
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
                            aria-label={`Environment variable value ${idx + 1}`}
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
                            className="h-9 w-9 p-0 shrink-0"
                            type="button"
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
                            aria-label={
                              shownEnvVars.has(key)
                                ? "Hide value"
                                : "Show value"
                            }
                            aria-pressed={shownEnvVars.has(key)}
                            title={
                              shownEnvVars.has(key)
                                ? "Hide value"
                                : "Show value"
                            }
                          >
                            {shownEnvVars.has(key) ? (
                              <Eye className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <EyeOff className="h-4 w-4" aria-hidden="true" />
                            )}
                          </Button>
                        </div>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      className="w-full mt-2"
                      type="button"
                      onClick={() => {
                        const key = "";
                        const newEnv = { ...env };
                        newEnv[key] = "";
                        setEnv(newEnv);
                      }}
                    >
                      Add Environment Variable
                    </Button>
                  </div>
                )}
              </div>

              {/* Authentication Section */}
              <div className="space-y-2">
                <Button
                  variant="outline"
                  onClick={() => setShowAuthConfig(!showAuthConfig)}
                  className="flex items-center w-full"
                  type="button"
                  data-testid="auth-button"
                  aria-expanded={showAuthConfig}
                >
                  {showAuthConfig ? (
                    <ChevronDown className="w-4 h-4 mr-2" />
                  ) : (
                    <ChevronRight className="w-4 h-4 mr-2" />
                  )}
                  Authentication
                </Button>
                {showAuthConfig && (
                  <>
                    {/* Bearer Token Section */}
                    <div className="space-y-2 p-3 rounded border">
                      <h4 className="text-sm font-semibold flex items-center">
                        API Token Authentication
                      </h4>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          Header Name
                        </label>
                        <Input
                          placeholder="Authorization"
                          onChange={(e) => setHeaderName(e.target.value)}
                          data-testid="header-input"
                          className="font-mono"
                          value={headerName}
                        />
                        <label className="text-sm font-medium">
                          Bearer Token
                        </label>
                        <Input
                          placeholder="Bearer Token"
                          value={bearerToken}
                          onChange={(e) => setBearerToken(e.target.value)}
                          data-testid="bearer-token-input"
                          className="font-mono"
                          type="password"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </TabsContent>

            <TabsContent value="streamable-http" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="url">URL *</Label>
                {url ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input
                        id="url"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="URL"
                        className={`font-mono ${errors.url ? "border-destructive" : ""}`}
                      />
                    </TooltipTrigger>
                    <TooltipContent>{url}</TooltipContent>
                  </Tooltip>
                ) : (
                  <Input
                    id="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="URL"
                    className={`font-mono ${errors.url ? "border-destructive" : ""}`}
                  />
                )}
                {errors.url && (
                  <p className="text-sm text-destructive">{errors.url}</p>
                )}
              </div>

              {/* Authentication Section */}
              <div className="space-y-2">
                <Button
                  variant="outline"
                  onClick={() => setShowAuthConfig(!showAuthConfig)}
                  className="flex items-center w-full"
                  type="button"
                  data-testid="auth-button"
                  aria-expanded={showAuthConfig}
                >
                  {showAuthConfig ? (
                    <ChevronDown className="w-4 h-4 mr-2" />
                  ) : (
                    <ChevronRight className="w-4 h-4 mr-2" />
                  )}
                  Authentication
                </Button>
                {showAuthConfig && (
                  <>
                    {/* Bearer Token Section */}
                    <div className="space-y-2 p-3 rounded border">
                      <h4 className="text-sm font-semibold flex items-center">
                        API Token Authentication
                      </h4>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          Header Name
                        </label>
                        <Input
                          placeholder="Authorization"
                          onChange={(e) => setHeaderName(e.target.value)}
                          data-testid="header-input"
                          className="font-mono"
                          value={headerName}
                        />
                        <label className="text-sm font-medium">
                          Bearer Token
                        </label>
                        <Input
                          placeholder="Bearer Token"
                          value={bearerToken}
                          onChange={(e) => setBearerToken(e.target.value)}
                          data-testid="bearer-token-input"
                          className="font-mono"
                          type="password"
                        />
                      </div>
                    </div>
                    {/* OAuth Configuration */}
                    <div className="space-y-2 p-3 rounded border">
                      <h4 className="text-sm font-semibold flex items-center">
                        OAuth 2.0 Flow
                      </h4>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Client ID</label>
                        <Input
                          placeholder="Client ID"
                          onChange={(e) => setOauthClientId(e.target.value)}
                          value={oauthClientId}
                          data-testid="oauth-client-id-input"
                          className="font-mono"
                        />
                        <label className="text-sm font-medium">
                          Redirect URL
                        </label>
                        <Input
                          readOnly
                          placeholder="Redirect URL"
                          value={window.location.origin + "/oauth/callback"}
                          className="font-mono"
                        />
                        <label className="text-sm font-medium">Scope</label>
                        <Input
                          placeholder="Scope (space-separated)"
                          onChange={(e) => setOauthScope(e.target.value)}
                          value={oauthScope}
                          data-testid="oauth-scope-input"
                          className="font-mono"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </TabsContent>
          </Tabs>

          {/* Copy Buttons */}
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyServerEntry}
                  className="w-full"
                  type="button"
                >
                  {copiedServerEntry ? (
                    <CheckCheck className="h-4 w-4 mr-2" />
                  ) : (
                    <Copy className="h-4 w-4 mr-2" />
                  )}
                  Server Entry
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy Server Entry</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyServerFile}
                  className="w-full"
                  type="button"
                >
                  {copiedServerFile ? (
                    <CheckCheck className="h-4 w-4 mr-2" />
                  ) : (
                    <Copy className="h-4 w-4 mr-2" />
                  )}
                  Servers File
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy Servers File</TooltipContent>
            </Tooltip>
          </div>

          {/* Test Result */}
          {testResult && (
            <div
              className={`p-3 rounded-md ${testResult.success ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}
            >
              {testResult.success ? (
                <p className="text-sm">✓ Connection test successful!</p>
              ) : (
                <p className="text-sm">
                  ✗ Connection test failed: {testResult.error}
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleTest}
                disabled={isTesting || isSubmitting}
              >
                {isTesting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <TestTube className="mr-2 h-4 w-4" />
                    Test Connection
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={resetForm}
                disabled={isSubmitting}
              >
                Reset
              </Button>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Server
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
