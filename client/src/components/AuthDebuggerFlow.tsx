/**
 * OAuth debug flow component that shows each HTTP request individually
 * with pause/continue functionality.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, ExternalLink, Loader2 } from "lucide-react";
import { createDebugFetch, DebugRequestResponse } from "@/lib/debug-middleware";
import { DebugOAuthProvider } from "@/lib/DebugOAuthProvider";
import {
  auth,
  extractWWWAuthenticateParams,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { validateRedirectUrl } from "@/utils/urlValidation";
import { useToast } from "@/lib/hooks/useToast";

interface AuthDebuggerFlowProps {
  serverUrl: string;
  onComplete: (tokens: OAuthTokens) => void;
  onCancel: () => void;
  onError: (error: Error) => void;
}

type FlowState = "running" | "waiting_continue" | "waiting_code" | "complete";

export function AuthDebuggerFlow({
  serverUrl,
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

  // Handler for middleware callback - pauses until Continue clicked
  const handleRequestComplete = useCallback(
    async (entry: DebugRequestResponse) => {
      setCurrentStep(entry);
      setFlowState("waiting_continue");
      await new Promise<void>((resolve) => {
        continueResolverRef.current = resolve;
      });
      setCompletedSteps((prev) => [...prev, entry]);
      setCurrentStep(null);
      setFlowState("running");
    },
    [],
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

    async function runDebugFlow() {
      const debugFetch = createDebugFetch(handleRequestComplete);
      const provider = new DebugOAuthProvider(serverUrl);
      provider.setAuthCodeHandler(handleAwaitAuthCode);

      try {
        // Step 1: Initialize to get 401
        let initResponse: Response;
        try {
          initResponse = await debugFetch(serverUrl, {
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
        } catch (fetchError) {
          // Network errors (CORS, connection refused, etc.)
          const message =
            fetchError instanceof TypeError
              ? `Network error connecting to ${serverUrl}. This could be a CORS issue or the server may not be reachable.`
              : fetchError instanceof Error
                ? fetchError.message
                : String(fetchError);
          onError(new Error(message));
          return;
        }

        if (initResponse.status !== 401) {
          // Server may not require auth, or something else happened
          if (initResponse.ok) {
            onError(
              new Error(
                `Server returned ${initResponse.status} - authentication may not be required`,
              ),
            );
          } else {
            onError(
              new Error(
                `Expected 401, got ${initResponse.status} ${initResponse.statusText}`,
              ),
            );
          }
          return;
        }

        const { resourceMetadataUrl, scope } =
          extractWWWAuthenticateParams(initResponse);

        // Step 2: Run auth() - middleware captures all requests
        let result = await auth(provider, {
          serverUrl,
          resourceMetadataUrl,
          scope,
          fetchFn: debugFetch,
        });

        // Step 3: If REDIRECT, we've already gotten the code via handleAwaitAuthCode
        if (result === "REDIRECT") {
          const authorizationCode = provider.getPendingAuthCode();
          if (!authorizationCode) {
            onError(new Error("No authorization code received"));
            return;
          }

          provider.clearPendingAuthCode();

          result = await auth(provider, {
            serverUrl,
            resourceMetadataUrl,
            scope,
            authorizationCode,
            fetchFn: debugFetch,
          });
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
        onError(error instanceof Error ? error : new Error(String(error)));
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

  const handleOpenAuthUrl = () => {
    if (authUrl) {
      try {
        validateRedirectUrl(authUrl.href);
        window.open(authUrl.href, "_blank", "noopener noreferrer");
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
  const [expanded, setExpanded] = useState(isCurrent);

  return (
    <div>
      <div
        className={`flex items-center p-2 rounded-md cursor-pointer hover:bg-accent/50 ${isCurrent ? "bg-accent" : ""}`}
        onClick={() => setExpanded(!expanded)}
      >
        {isComplete ? (
          <CheckCircle2 className="h-5 w-5 text-green-500 mr-2 shrink-0" />
        ) : (
          <Circle className="h-5 w-5 text-blue-500 mr-2 shrink-0" />
        )}
        <span className={`${isCurrent ? "font-medium" : ""}`}>
          {stepNumber}. {step.label}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {step.response.status} {step.response.statusText}
        </span>
      </div>

      {expanded && (
        <div className="ml-7 mt-2 space-y-3">
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
        </div>
      )}
    </div>
  );
}
