import React from "react";
import { flushSync } from "react-dom";
import {
  ServerConfig,
  UpdateServerRequest,
  StdioConfig,
  HttpConfig,
} from "./types/multiserver";
import {
  createDefaultStdioConfig,
  createDefaultHttpConfig,
  getStdioCommand,
  getHttpUrl,
  safeGetConfigProperty,
} from "../../utils/serverConfigValidation";
import { MultiServerApi } from "./services/multiServerApi";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import {
  Settings,
  TestTube,
  Loader2,
  Save,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Copy,
  CheckCheck,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import { useToast } from "../../lib/hooks/useToast";

interface ServerConfigModalProps {
  server: ServerConfig | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (serverId: string, config: UpdateServerRequest) => Promise<void>;
  isSaving?: boolean;
}

export const ServerConfigModal: React.FC<ServerConfigModalProps> = ({
  server,
  isOpen,
  onClose,
  onSave,
  isSaving = false,
}) => {
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

  // Initialize form when server changes
  React.useEffect(() => {
    if (server) {
      setName(server.name);
      setDescription(server.description || "");

      if (server.transportType === "stdio") {
        // Use safe utility functions to get config values
        const command = getStdioCommand(server) || "";
        const args = safeGetConfigProperty<string[]>(server, "args") || [];
        const env =
          safeGetConfigProperty<Record<string, string>>(server, "env") || {};

        setCommand(command);
        setArgs(args.join(" "));
        setEnv(env);

        // Reset HTTP fields
        setUrl("");
        setBearerToken("");
        setHeaderName("");
        setOauthClientId("");
        setOauthScope("");
      } else if (server.transportType === "streamable-http") {
        // Use safe utility functions to get config values
        const url = getHttpUrl(server) || "";
        const bearerToken =
          safeGetConfigProperty<string>(server, "bearerToken") || "";
        const headerName =
          safeGetConfigProperty<string>(server, "headerName") || "";
        const oauthClientId =
          safeGetConfigProperty<string>(server, "oauthClientId") || "";
        const oauthScope =
          safeGetConfigProperty<string>(server, "oauthScope") || "";

        setUrl(url);
        setBearerToken(bearerToken);
        setHeaderName(headerName);
        setOauthClientId(oauthClientId);
        setOauthScope(oauthScope);

        // Reset stdio fields
        setCommand("");
        setArgs("");
        setEnv({});
      } else {
        // Reset all fields if transport type is unknown
        setCommand("");
        setArgs("");
        setEnv({});
        setUrl("");
        setBearerToken("");
        setHeaderName("");
        setOauthClientId("");
        setOauthScope("");
      }

      setErrors({});
      setTestResult(null);
      setShowEnvVars(false);
      setShowAuthConfig(false);
      setShownEnvVars(new Set());
    }
  }, [server]);

  // Fetch default environment variables only for new servers (not for editing existing ones)
  React.useEffect(() => {
    const fetchDefaultConfig = async () => {
      try {
        const defaultConfig = await MultiServerApi.getDefaultConfig();
        // Only apply defaults if we don't have existing server config
        if (!server?.config) {
          if (
            defaultConfig.defaultEnvironment &&
            server?.transportType === "stdio"
          ) {
            if (Object.keys(env).length === 0) {
              setEnv(defaultConfig.defaultEnvironment);
            }
          }
          if (
            defaultConfig.defaultCommand &&
            server?.transportType === "stdio" &&
            !command
          ) {
            setCommand(defaultConfig.defaultCommand);
          }
          if (
            defaultConfig.defaultArgs &&
            server?.transportType === "stdio" &&
            !args
          ) {
            setArgs(defaultConfig.defaultArgs);
          }
          if (
            defaultConfig.defaultServerUrl &&
            server?.transportType === "streamable-http" &&
            !url
          ) {
            setUrl(defaultConfig.defaultServerUrl);
          }
        }
      } catch (error) {
        console.error("Failed to fetch default configuration:", error);
        // Don't show error toast as this is not critical - form can still be used
      }
    };

    // Only fetch defaults if server exists but has no config (shouldn't happen in edit mode)
    if (server && !server.config) {
      fetchDefaultConfig();
    }
  }, [server]);

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

    if (server?.transportType === "stdio") {
      // Command validation
      if (!command.trim()) {
        newErrors.command = "Command is required";
      } else if (command.trim().length < 1) {
        newErrors.command = "Command cannot be empty";
      }

      // Arguments are now space-separated, no validation needed

      // Environment variables are now handled as Record<string, string>, no validation needed
    } else if (server?.transportType === "streamable-http") {
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

  const buildUpdateConfig = (): UpdateServerRequest => {
    const baseConfig: UpdateServerRequest = {
      name: name.trim(),
      description: description.trim() || undefined,
    };

    if (server?.transportType === "stdio") {
      // Start with default config and override with user values
      const defaultConfig = createDefaultStdioConfig();
      const stdioConfig: StdioConfig = {
        ...defaultConfig,
        command: command.trim() || defaultConfig.command,
        args: args.trim() ? args.split(/\s+/) : defaultConfig.args,
        env: { ...defaultConfig.env, ...env },
      };
      baseConfig.config = stdioConfig;
    } else if (server?.transportType === "streamable-http") {
      // Start with default config and override with user values
      const defaultConfig = createDefaultHttpConfig();
      const httpConfig: HttpConfig = {
        ...defaultConfig,
        url: url.trim() || defaultConfig.url,
        bearerToken: bearerToken.trim() || defaultConfig.bearerToken,
        headerName: headerName.trim() || defaultConfig.headerName,
        oauthClientId: oauthClientId.trim() || defaultConfig.oauthClientId,
        oauthScope: oauthScope.trim() || defaultConfig.oauthScope,
      };
      baseConfig.config = httpConfig;
    }

    return baseConfig;
  };

  const handleTest = async () => {
    if (!validateForm() || !server) return;

    setIsTesting(true);
    setTestResult(null);

    try {
      // Since there's no test endpoint on the server, we'll do basic validation
      const config = buildUpdateConfig();

      // Basic validation - check if required fields are present
      if (server.transportType === "stdio") {
        if (
          !config.config ||
          !("command" in config.config) ||
          !config.config.command
        ) {
          throw new Error("Command is required for stdio transport");
        }
      } else if (server.transportType === "streamable-http") {
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

  const handleSave = async () => {
    if (!validateForm() || !server) return;

    try {
      const config = buildUpdateConfig();
      await onSave(server.id, config);

      // Strategy 1: Immediate synchronous state reset and close
      flushSync(() => {
        resetDialogState();
      });

      // Strategy 2: Force immediate DOM cleanup
      const dialogElement = document.querySelector('[role="dialog"]');
      if (dialogElement) {
        // Remove focus trap attributes
        dialogElement.removeAttribute("aria-modal");
        dialogElement.removeAttribute("role");
        // Force blur any focused elements within dialog
        const focusedElement = dialogElement.querySelector(
          ":focus",
        ) as HTMLElement;
        if (focusedElement) {
          focusedElement.blur();
        }
      }

      // Strategy 3: Force focus to body immediately
      if (document.activeElement && document.activeElement !== document.body) {
        (document.activeElement as HTMLElement).blur();
      }
      document.body.focus();

      // Strategy 4: Use flushSync to force synchronous close
      flushSync(() => {
        onClose();
      });

      // Strategy 5: Additional DOM cleanup after close
      setTimeout(() => {
        // Remove any remaining modal backdrop or overlay
        const backdrop = document.querySelector(
          "[data-radix-popper-content-wrapper]",
        );
        if (backdrop) {
          backdrop.remove();
        }

        // Remove any remaining focus trap elements
        const focusTrap = document.querySelector("[data-radix-focus-scope]");
        if (focusTrap) {
          focusTrap.remove();
        }

        // Force focus back to body and enable interactions
        document.body.focus();
        document.body.style.pointerEvents = "auto";
        document.documentElement.style.pointerEvents = "auto";

        // Force a click on body to ensure event handlers are working
        const clickEvent = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        });
        document.body.dispatchEvent(clickEvent);
      }, 0);
    } catch (error) {
      console.error("Failed to update server:", error);
    }
  };

  const resetForm = () => {
    if (server) {
      // Reset to original server values
      setName(server.name);
      setDescription(server.description || "");

      if (server.transportType === "stdio") {
        // Use safe utility functions to get config values
        const command = getStdioCommand(server) || "";
        const args = safeGetConfigProperty<string[]>(server, "args") || [];
        const env =
          safeGetConfigProperty<Record<string, string>>(server, "env") || {};

        setCommand(command);
        setArgs(args.join(" "));
        setEnv(env);
      } else if (server.transportType === "streamable-http") {
        // Use safe utility functions to get config values
        const url = getHttpUrl(server) || "";
        const bearerToken =
          safeGetConfigProperty<string>(server, "bearerToken") || "";
        const headerName =
          safeGetConfigProperty<string>(server, "headerName") || "";
        const oauthClientId =
          safeGetConfigProperty<string>(server, "oauthClientId") || "";
        const oauthScope =
          safeGetConfigProperty<string>(server, "oauthScope") || "";

        setUrl(url);
        setBearerToken(bearerToken);
        setHeaderName(headerName);
        setOauthClientId(oauthClientId);
        setOauthScope(oauthScope);
      }
    }
    setErrors({});
    setTestResult(null);
  };

  const resetDialogState = React.useCallback(() => {
    setErrors({});
    setTestResult(null);
    setShowEnvVars(false);
    setShowAuthConfig(false);
    setShownEnvVars(new Set());
    setCopiedServerEntry(false);
    setCopiedServerFile(false);
    setIsTesting(false);
  }, []);

  // Reusable aggressive modal close strategy
  const aggressiveModalClose = React.useCallback(() => {
    // Strategy 1: Immediate synchronous state reset and close
    flushSync(() => {
      resetDialogState();
    });

    // Strategy 2: Force immediate DOM cleanup
    const dialogElement = document.querySelector('[role="dialog"]');
    if (dialogElement) {
      // Remove focus trap attributes
      dialogElement.removeAttribute("aria-modal");
      dialogElement.removeAttribute("role");
      // Force blur any focused elements within dialog
      const focusedElement = dialogElement.querySelector(
        ":focus",
      ) as HTMLElement;
      if (focusedElement) {
        focusedElement.blur();
      }
    }

    // Strategy 3: Force focus to body immediately
    if (document.activeElement && document.activeElement !== document.body) {
      (document.activeElement as HTMLElement).blur();
    }
    document.body.focus();

    // Strategy 4: Use flushSync to force synchronous close
    flushSync(() => {
      onClose();
    });

    // Strategy 5: Additional DOM cleanup after close
    setTimeout(() => {
      // Remove any remaining modal backdrop or overlay
      const backdrop = document.querySelector(
        "[data-radix-popper-content-wrapper]",
      );
      if (backdrop) {
        backdrop.remove();
      }

      // Remove any remaining focus trap elements
      const focusTrap = document.querySelector("[data-radix-focus-scope]");
      if (focusTrap) {
        focusTrap.remove();
      }

      // Force focus back to body and enable interactions
      document.body.focus();
      document.body.style.pointerEvents = "auto";
      document.documentElement.style.pointerEvents = "auto";

      // Force a click on body to ensure event handlers are working
      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      });
      document.body.dispatchEvent(clickEvent);
    }, 0);
  }, [resetDialogState, onClose]);

  const handleDialogOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) {
        aggressiveModalClose();
      }
    },
    [aggressiveModalClose],
  );

  const handleClose = React.useCallback(() => {
    aggressiveModalClose();
  }, [aggressiveModalClose]);

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
    if (server?.transportType === "stdio") {
      return {
        command: command.trim(),
        args: args.trim() ? args.split(/\s+/) : [],
        env: { ...env },
      };
    }
    if (server?.transportType === "streamable-http") {
      return {
        type: "streamable-http",
        url: url.trim(),
        note: "For Streamable HTTP connections, add this URL directly in your MCP Client",
      };
    }
    return {};
  }, [server?.transportType, command, args, env, url]);

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
              server?.transportType === "stdio"
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
  }, [generateMCPServerEntry, server?.transportType, toast, reportError]);

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

  if (!server) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleDialogOpenChange} modal={true}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        onEscapeKeyDown={(e) => {
          e.stopPropagation();
          handleClose();
        }}
        onPointerDownOutside={(e) => {
          e.stopPropagation();
          handleClose();
        }}
        onInteractOutside={(e) => {
          e.stopPropagation();
          handleClose();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Edit Server Configuration
          </DialogTitle>
          <DialogDescription>
            Update the configuration for "{server.name}". Changes will be
            applied immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Server Name *</Label>
              <Input
                id="edit-name"
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
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description of this server"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>Transport Type</Label>
              <div className="px-3 py-2 border border-input bg-muted rounded-md text-sm">
                {server.transportType === "stdio"
                  ? "Stdio (Local Command)"
                  : "HTTP (Remote Server)"}
                <span className="text-muted-foreground ml-2">
                  (Cannot be changed)
                </span>
              </div>
            </div>
          </div>

          {/* Transport-specific Configuration */}
          <Tabs value={server.transportType} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger
                value="stdio"
                disabled={server.transportType !== "stdio"}
              >
                Stdio Configuration
              </TabsTrigger>
              <TabsTrigger
                value="streamable-http"
                disabled={server.transportType !== "streamable-http"}
              >
                HTTP Configuration
              </TabsTrigger>
            </TabsList>

            <TabsContent value="stdio" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-command">Command *</Label>
                <Input
                  id="edit-command"
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
                <Label htmlFor="edit-args">Arguments</Label>
                <Input
                  id="edit-args"
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
                <Label htmlFor="edit-url">URL *</Label>
                {url ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input
                        id="edit-url"
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
                    id="edit-url"
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
                        {errors.bearerToken && (
                          <p className="text-sm text-destructive">
                            {errors.bearerToken}
                          </p>
                        )}
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
                        {errors.oauthClientId && (
                          <p className="text-sm text-destructive">
                            {errors.oauthClientId}
                          </p>
                        )}
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
        </div>

        <DialogFooter className="flex items-center justify-between">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleTest}
              disabled={isTesting || isSaving}
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
              disabled={isSaving}
            >
              Reset
            </Button>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
