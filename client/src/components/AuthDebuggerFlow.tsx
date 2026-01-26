/**
 * OAuth debug flow component that shows each HTTP request individually
 * with pause/continue functionality.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  ExternalLink,
  Info,
  Loader2,
} from "lucide-react";
import { createDebugFetch, DebugRequestResponse } from "@/lib/debug-middleware";
import { DebugOAuthProvider } from "@/lib/DebugOAuthProvider";
import {
  auth,
  exchangeAuthorization,
  extractWWWAuthenticateParams,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthTokens,
  OAuthMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { validateRedirectUrl } from "@/utils/urlValidation";
import { useToast } from "@/lib/hooks/useToast";

interface AuthDebuggerFlowProps {
  serverUrl: string;
  quickMode?: boolean;
  onComplete: (tokens: OAuthTokens) => void;
  onCancel: () => void;
  onError: (error: Error) => void;
}

type FlowState =
  | "running"
  | "waiting_continue"
  | "waiting_code"
  | "complete"
  | "error";

export function AuthDebuggerFlow({
  serverUrl,
  quickMode = false,
  onComplete,
  onCancel,
  onError,
}: AuthDebuggerFlowProps) {
  const { toast } = useToast();
  const [completedSteps, setCompletedSteps] = useState<DebugRequestResponse[]>(
    [],
  );
  const [currentStep, setCurrentStep] = useState<DebugRequestResponse | null>(
    null,
  );
  const [flowState, setFlowState] = useState<FlowState>("running");
  const [authUrl, setAuthUrl] = useState<URL | null>(null);
  const [authCode, setAuthCode] = useState("");

  // Use refs to store resolvers so they persist across renders
  const continueResolverRef = useRef<(() => void) | null>(null);
  const authCodeResolverRef = useRef<((code: string) => void) | null>(null);
  const flowStartedRef = useRef(false);
  const popupRef = useRef<Window | null>(null);

  // Cache discovered metadata to avoid re-fetching during token exchange
  // TODO: The SDK's auth() function should accept pre-fetched metadata to avoid
  // redundant discovery requests. For now, we capture it from responses and use
  // exchangeAuthorization() directly for the token exchange step.
  const cachedMetadataRef = useRef<{
    authServerMetadata?: OAuthMetadata;
    authServerUrl?: string;
    resource?: URL;
  }>({});

  // Track discovery state to inject informational warnings
  const discoveryStateRef = useRef<{
    prmFailed: boolean;
    shownPrmWarning: boolean;
    oauthMetadataSuccess: boolean;
    shownNoMetadataWarning: boolean;
  }>({
    prmFailed: false,
    shownPrmWarning: false,
    oauthMetadataSuccess: false,
    shownNoMetadataWarning: false,
  });

  // Handler for middleware callback - pauses until Continue clicked (unless quickMode)
  const handleRequestComplete = useCallback(
    async (entry: DebugRequestResponse) => {
      if (quickMode) {
        // Quick mode: add directly to completed, don't pause
        setCompletedSteps((prev) => [...prev, entry]);
        return;
      }

      // Debug mode: show as current step, wait for Continue, then add to completed
      setCurrentStep(entry);
      setFlowState("waiting_continue");
      await new Promise<void>((resolve) => {
        continueResolverRef.current = resolve;
      });
      setCompletedSteps((prev) => [...prev, entry]);
      setCurrentStep(null);
      setFlowState("running");
    },
    [quickMode],
  );

  // Handler for auth URL - pauses until code entered
  const handleAwaitAuthCode = useCallback(async (url: URL): Promise<string> => {
    setAuthUrl(url);
    setFlowState("waiting_code");
    return new Promise((resolve) => {
      authCodeResolverRef.current = resolve;
    });
  }, []);

  const handleContinue = useCallback(() => {
    if (continueResolverRef.current) {
      continueResolverRef.current();
      continueResolverRef.current = null;
    }
  }, []);

  const handleSubmitCode = useCallback(() => {
    if (authCodeResolverRef.current && authCode.trim()) {
      authCodeResolverRef.current(authCode.trim());
      authCodeResolverRef.current = null;
      setAuthUrl(null);
      setAuthCode("");
      setFlowState("running");
    }
  }, [authCode]);

  // Start the flow
  useEffect(() => {
    if (flowStartedRef.current) return;
    flowStartedRef.current = true;

    // Helper to create error steps
    function createErrorStep(
      label: string,
      message: React.ReactNode,
    ): DebugRequestResponse {
      return {
        id: crypto.randomUUID(),
        label,
        request: { method: "ERROR", url: "", headers: {} },
        response: {
          status: 0,
          statusText: "Error",
          headers: {},
          body: { message },
        },
      };
    }

    async function runDebugFlow() {
      const baseDebugFetch = createDebugFetch(handleRequestComplete);

      // Wrap debugFetch to capture metadata and inject info/warning steps
      const debugFetch: typeof fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = init?.method || "GET";

        // Before OAuth metadata request - inject PRM warning if needed
        if (
          (url.includes(".well-known/oauth-authorization-server") ||
            url.includes(".well-known/openid-configuration")) &&
          discoveryStateRef.current.prmFailed &&
          !discoveryStateRef.current.shownPrmWarning
        ) {
          const errorEntry = createErrorStep(
            "Error: No PRM Found",
            <>
              Server does not have Protected Resource Metadata. Falling back to{" "}
              <a
                href="https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization#authorization-base-url"
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-red-600 hover:text-red-800"
              >
                2025-03-26 spec
              </a>{" "}
              authorization base URL discovery. This often is due to an
              incorrect server URL preventing PRM discovery. Please double-check
              the server URL is correct.
            </>,
          );
          await handleRequestComplete(errorEntry);
          discoveryStateRef.current.shownPrmWarning = true;
        }

        // Before POST /register - inject warning if no metadata found
        if (
          method === "POST" &&
          url.includes("/register") &&
          !discoveryStateRef.current.oauthMetadataSuccess &&
          !discoveryStateRef.current.shownNoMetadataWarning
        ) {
          const errorEntry = createErrorStep(
            "Error: No Metadata Found",
            <>
              Failed to discover OAuth authorization server metadata. Falling
              back to{" "}
              <a
                href="https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization#fallbacks-for-servers-without-metadata-discovery"
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-red-600 hover:text-red-800"
              >
                2025-03-26 spec
              </a>{" "}
              server-without-metadata mode. This is unlikely to work, and is
              often due to an incorrect server URL. Please check the MCP URL you
              entered is correct.
            </>,
          );
          await handleRequestComplete(errorEntry);
          discoveryStateRef.current.shownNoMetadataWarning = true;
        }

        // Make the actual request
        let response: Response;
        try {
          response = await baseDebugFetch(input, init);
        } catch (error) {
          // Track failures even when fetch throws (CORS, network errors)
          if (url.includes(".well-known/oauth-protected-resource")) {
            discoveryStateRef.current.prmFailed = true;
          }
          throw error;
        }

        // Track PRM discovery
        if (url.includes(".well-known/oauth-protected-resource")) {
          if (!response.ok) {
            discoveryStateRef.current.prmFailed = true;
          }
        }

        // Capture and track OAuth metadata
        if (
          url.includes(".well-known/oauth-authorization-server") ||
          url.includes(".well-known/openid-configuration")
        ) {
          if (response.ok) {
            discoveryStateRef.current.oauthMetadataSuccess = true;
            try {
              const cloned = response.clone();
              const metadata = await cloned.json();
              cachedMetadataRef.current.authServerMetadata = metadata;
              const authServerUrl = new URL(url);
              cachedMetadataRef.current.authServerUrl = authServerUrl.origin;
            } catch {
              // Ignore parse errors
            }
          }
        }

        return response;
      };

      const provider = new DebugOAuthProvider(serverUrl);
      provider.setAuthCodeHandler(handleAwaitAuthCode);

      try {
        // Step 1: Try to initialize to get 401 with WWW-Authenticate header
        let resourceMetadataUrl: URL | undefined;
        let scope: string | undefined;

        try {
          const initResponse = await debugFetch(serverUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "initialize",
              params: {
                protocolVersion: "2025-03-26",
                capabilities: {},
                clientInfo: { name: "mcp-inspector", version: "1.0.0" },
              },
              id: 1,
            }),
          });

          if (initResponse.status === 401) {
            const params = extractWWWAuthenticateParams(initResponse);
            resourceMetadataUrl = params.resourceMetadataUrl;
            scope = params.scope;
          } else if (initResponse.ok) {
            onError(
              new Error(
                `Server returned ${initResponse.status} - authentication may not be required`,
              ),
            );
            return;
          }
          // For other non-401 errors, we'll continue without the metadata
        } catch (fetchError) {
          // Network errors (CORS preflight failure, connection refused, etc.)
          // Record this as a failed step but continue with discovery
          const errorMessage =
            fetchError instanceof TypeError
              ? "CORS preflight failed - server may not allow cross-origin requests"
              : fetchError instanceof Error
                ? fetchError.message
                : String(fetchError);

          // Add a "failed" step to show what happened
          const failedEntry: DebugRequestResponse = {
            id: crypto.randomUUID(),
            label: `POST ${new URL(serverUrl).pathname || "/"}`,
            request: {
              method: "POST",
              url: serverUrl,
              headers: { "Content-Type": "application/json" },
              body: {
                jsonrpc: "2.0",
                method: "initialize",
                params: {
                  protocolVersion: "2025-03-26",
                  capabilities: {},
                  clientInfo: { name: "mcp-inspector", version: "1.0.0" },
                },
                id: 1,
              },
            },
            response: {
              status: 0,
              statusText: "Failed",
              headers: {},
              body: {
                error: errorMessage,
                note: "Continuing with OAuth discovery without WWW-Authenticate metadata",
              },
            },
          };

          if (quickMode) {
            // Quick mode: add directly to completed
            setCompletedSteps((prev) => [...prev, failedEntry]);
          } else {
            // Debug mode: show as current step, wait for continue, then add to completed
            setCurrentStep(failedEntry);
            setFlowState("waiting_continue");
            await new Promise<void>((resolve) => {
              continueResolverRef.current = resolve;
            });
            setCompletedSteps((prev) => [...prev, failedEntry]);
            setCurrentStep(null);
            setFlowState("running");
          }
        }

        // Step 2: Run auth() for discovery, registration, and authorization start
        // The debugFetch wrapper captures auth server metadata for later use
        const result = await auth(provider, {
          serverUrl,
          resourceMetadataUrl,
          scope,
          fetchFn: debugFetch,
        });

        // Step 3: If REDIRECT, use exchangeAuthorization directly with cached metadata
        // This avoids the redundant metadata discovery that auth() would do
        if (result === "REDIRECT") {
          const authorizationCode = provider.getPendingAuthCode();
          if (!authorizationCode) {
            onError(new Error("No authorization code received"));
            return;
          }

          provider.clearPendingAuthCode();

          const clientInfo = await provider.clientInformation();
          if (!clientInfo) {
            onError(new Error("No client information available"));
            return;
          }

          const codeVerifier = provider.codeVerifier();
          const { authServerMetadata, authServerUrl } =
            cachedMetadataRef.current;

          if (!authServerUrl) {
            onError(new Error("No auth server URL cached"));
            return;
          }

          // Use exchangeAuthorization directly instead of auth()
          const tokens = await exchangeAuthorization(authServerUrl, {
            metadata: authServerMetadata,
            clientInformation: clientInfo,
            authorizationCode,
            codeVerifier,
            redirectUri: provider.redirectUrl,
            resource: cachedMetadataRef.current.resource,
            fetchFn: debugFetch,
          });

          provider.saveTokens(tokens);
          setFlowState("complete");
          onComplete(tokens);
          return;
        }

        if (result === "AUTHORIZED") {
          const tokens = await provider.tokens();
          if (tokens) {
            setFlowState("complete");
            onComplete(tokens);
          } else {
            onError(new Error("No tokens received after authorization"));
          }
        }
      } catch (error) {
        console.error("OAuth debug flow error:", error);

        // Show the final error as a step instead of dismissing the flow
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const errorEntry = createErrorStep(
          "Flow Error",
          <>
            {errorMessage}
            <br />
            <span className="text-red-600/80 text-xs mt-1 block">
              The OAuth flow could not complete. This may be due to CORS
              restrictions or server configuration.
            </span>
          </>,
        );

        if (quickMode) {
          setCompletedSteps((prev) => [...prev, errorEntry]);
          setFlowState("error");
        } else {
          setCurrentStep(errorEntry);
          setFlowState("waiting_continue");
          await new Promise<void>((resolve) => {
            continueResolverRef.current = resolve;
          });
          setCompletedSteps((prev) => [...prev, errorEntry]);
          setCurrentStep(null);
          setFlowState("error");
        }
      }
    }

    runDebugFlow();
  }, [
    serverUrl,
    handleRequestComplete,
    handleAwaitAuthCode,
    onComplete,
    onError,
  ]);

  // Listen for postMessage from popup (opener pattern)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Only accept messages from same origin
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "oauth-callback" && event.data?.code) {
        // Auto-fill the auth code from popup
        if (authCodeResolverRef.current) {
          authCodeResolverRef.current(event.data.code);
          authCodeResolverRef.current = null;
          setAuthUrl(null);
          setAuthCode("");
          setFlowState("running");
        }
        // Close popup if we opened it
        popupRef.current?.close();
        popupRef.current = null;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleOpenAuthUrl = () => {
    if (authUrl) {
      try {
        validateRedirectUrl(authUrl.href);
        // Open as popup and keep reference for message receiving
        popupRef.current = window.open(
          authUrl.href,
          "oauth-popup",
          "width=600,height=700",
        );
      } catch (error) {
        toast({
          title: "Invalid URL",
          description:
            error instanceof Error
              ? error.message
              : "The authorization URL is not valid",
          variant: "destructive",
        });
      }
    }
  };

  return (
    <div className="rounded-md border p-6 space-y-4 mt-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">OAuth Debug Flow</h3>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Step through the OAuth flow one request at a time.
      </p>

      <div className="space-y-3">
        {/* Completed steps */}
        {completedSteps.map((step, index) => (
          <StepDisplay
            key={step.id}
            step={step}
            stepNumber={index + 1}
            isComplete={true}
            isCurrent={false}
          />
        ))}

        {/* Current step waiting for continue */}
        {currentStep && flowState === "waiting_continue" && (
          <div>
            <StepDisplay
              step={currentStep}
              stepNumber={completedSteps.length + 1}
              isComplete={false}
              isCurrent={true}
            />
            <div className="ml-7 mt-3">
              <Button onClick={handleContinue}>Continue</Button>
            </div>
          </div>
        )}

        {/* Auth code entry */}
        {flowState === "waiting_code" && authUrl && (
          <div className="ml-7 p-4 border rounded-md bg-muted/50 space-y-4">
            <div>
              <p className="font-medium mb-2 text-sm">Authorization Required</p>
              <p className="text-xs text-muted-foreground mb-3">
                Open this URL in a new tab to authorize:
              </p>
              <div className="flex items-start gap-2 p-2 bg-background rounded border">
                <code className="text-xs break-all flex-1">{authUrl.href}</code>
                <button
                  onClick={handleOpenAuthUrl}
                  className="flex items-center text-blue-500 hover:text-blue-700 shrink-0"
                  aria-label="Open authorization URL in new tab"
                  title="Open in new tab"
                >
                  <ExternalLink className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="authCode"
                className="block text-sm font-medium mb-1"
              >
                Authorization Code
              </label>
              <div className="flex gap-2">
                <input
                  id="authCode"
                  value={authCode}
                  onChange={(e) => setAuthCode(e.target.value)}
                  placeholder="Paste the authorization code here"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && authCode.trim()) {
                      handleSubmitCode();
                    }
                  }}
                />
                <Button onClick={handleSubmitCode} disabled={!authCode.trim()}>
                  Continue
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                After authorizing in the opened window, paste the code here.
              </p>
            </div>
          </div>
        )}

        {/* Running indicator - show when running and no current step to display */}
        {flowState === "running" && !currentStep && (
          <div className="flex items-center gap-2 p-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">
              {completedSteps.length === 0
                ? "Connecting to server..."
                : "Processing..."}
            </span>
          </div>
        )}

        {/* Complete indicator */}
        {flowState === "complete" && (
          <div className="flex items-center gap-2 p-3 rounded-md bg-green-50 border border-green-200 text-green-700">
            <CheckCircle2 className="h-5 w-5" />
            <span className="text-sm font-medium">
              Authentication completed successfully
            </span>
          </div>
        )}

        {/* Error indicator */}
        {flowState === "error" && (
          <div className="flex items-center gap-2 p-3 rounded-md bg-red-50 border border-red-200 text-red-700">
            <AlertTriangle className="h-5 w-5" />
            <span className="text-sm font-medium">
              Authentication flow failed
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

interface StepDisplayProps {
  step: DebugRequestResponse;
  stepNumber: number;
  isComplete: boolean;
  isCurrent: boolean;
}

function StepDisplay({
  step,
  stepNumber,
  isComplete,
  isCurrent,
}: StepDisplayProps) {
  // Expand by default for current step, warnings, and errors
  const [expanded, setExpanded] = useState(
    isCurrent ||
      step.request.method === "WARNING" ||
      step.request.method === "ERROR",
  );

  return (
    <div>
      <div
        className={`flex items-center p-2 rounded-md cursor-pointer hover:bg-accent/50 ${isCurrent ? "bg-accent" : ""}`}
        onClick={() => setExpanded(!expanded)}
      >
        {isComplete ? (
          step.response.status === 0 ? (
            // Status 0 = special step (info, warning, or error)
            step.response.statusText === "Info" ? (
              <Info className="h-5 w-5 text-blue-500 mr-2 shrink-0" />
            ) : step.response.statusText === "Warning" ? (
              <AlertTriangle className="h-5 w-5 text-yellow-500 mr-2 shrink-0" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-red-500 mr-2 shrink-0" />
            )
          ) : step.response.status >= 400 ? (
            <AlertTriangle className="h-5 w-5 text-yellow-500 mr-2 shrink-0" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-green-500 mr-2 shrink-0" />
          )
        ) : (
          <Circle className="h-5 w-5 text-blue-500 mr-2 shrink-0" />
        )}
        <span className={`${isCurrent ? "font-medium" : ""}`}>
          {stepNumber}. {step.label}
        </span>
        {/* Hide status for info/warning/error steps, show for HTTP requests */}
        {step.request.method !== "INFO" &&
          step.request.method !== "WARNING" &&
          step.request.method !== "ERROR" && (
            <span className="ml-auto text-xs text-muted-foreground">
              {step.response.status} {step.response.statusText}
            </span>
          )}
      </div>

      {expanded && (
        <div className="ml-7 mt-2 space-y-3">
          {/* Info/Warning/Error steps: show message directly */}
          {(step.request.method === "INFO" ||
            step.request.method === "WARNING" ||
            step.request.method === "ERROR") && (
            <div
              className={`text-sm p-3 rounded-md ${
                step.request.method === "INFO"
                  ? "bg-blue-50 text-blue-800 border border-blue-200"
                  : step.request.method === "WARNING"
                    ? "bg-yellow-50 text-yellow-800 border border-yellow-200"
                    : "bg-red-50 text-red-800 border border-red-200"
              }`}
            >
              {typeof step.response.body === "object" &&
              step.response.body !== null &&
              "message" in step.response.body
                ? (step.response.body as { message: React.ReactNode }).message
                : JSON.stringify(step.response.body)}
            </div>
          )}

          {/* Regular HTTP requests: show Request/Response details */}
          {step.request.method !== "INFO" &&
            step.request.method !== "WARNING" &&
            step.request.method !== "ERROR" && (
              <>
                {/* Request details */}
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground font-medium">
                    Request
                  </summary>
                  <div className="mt-2 p-2 bg-muted rounded-md space-y-2">
                    <div>
                      <span className="font-medium">{step.request.method}</span>{" "}
                      <span className="break-all">{step.request.url}</span>
                    </div>
                    {Object.keys(step.request.headers).length > 0 && (
                      <div>
                        <p className="font-medium mb-1">Headers:</p>
                        <pre className="overflow-auto max-h-[100px] text-[10px]">
                          {JSON.stringify(step.request.headers, null, 2)}
                        </pre>
                      </div>
                    )}
                    {step.request.body !== undefined && (
                      <div>
                        <p className="font-medium mb-1">Body:</p>
                        <pre className="overflow-auto max-h-[150px] text-[10px]">
                          {typeof step.request.body === "string"
                            ? step.request.body
                            : JSON.stringify(step.request.body, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </details>

                {/* Response details */}
                <details className="text-xs" open={isCurrent}>
                  <summary className="cursor-pointer text-muted-foreground font-medium">
                    Response
                  </summary>
                  <div className="mt-2 p-2 bg-muted rounded-md space-y-2">
                    <div>
                      <span
                        className={`font-medium ${step.response.status >= 400 ? "text-red-600" : "text-green-600"}`}
                      >
                        {step.response.status}
                      </span>{" "}
                      {step.response.statusText}
                    </div>
                    {Object.keys(step.response.headers).length > 0 && (
                      <div>
                        <p className="font-medium mb-1">Headers:</p>
                        <pre className="overflow-auto max-h-[100px] text-[10px]">
                          {JSON.stringify(step.response.headers, null, 2)}
                        </pre>
                      </div>
                    )}
                    {step.response.body !== undefined && (
                      <div>
                        <p className="font-medium mb-1">Body:</p>
                        <pre className="overflow-auto max-h-[200px] text-[10px]">
                          {typeof step.response.body === "string"
                            ? step.response.body
                            : JSON.stringify(step.response.body, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </details>
              </>
            )}
        </div>
      )}
    </div>
  );
}
