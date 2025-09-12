import { AuthDebuggerState, OAuthStep } from "@/lib/auth-types";
import { CheckCircle2, Circle, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import { DebugInspectorOAuthClientProvider } from "@/lib/auth";
import { useEffect, useMemo, useState } from "react";
import { OAuthClientInformation } from "@modelcontextprotocol/sdk/shared/auth.js";
import { validateRedirectUrl } from "@/utils/urlValidation";
import { useToast } from "@/lib/hooks/useToast";

interface OAuthStepProps {
  label: string;
  isComplete: boolean;
  isCurrent: boolean;
  error?: Error | null;
  children?: React.ReactNode;
}

const OAuthStepDetails = ({
  label,
  isComplete,
  isCurrent,
  error,
  children,
}: OAuthStepProps) => {
  return (
    <div>
      <div
        className={`flex items-center p-2 rounded-md ${isCurrent ? "bg-accent" : ""}`}
      >
        {isComplete ? (
          <CheckCircle2 className="h-5 w-5 text-green-500 mr-2" />
        ) : (
          <Circle className="h-5 w-5 text-muted-foreground mr-2" />
        )}
        <span className={`${isCurrent ? "font-medium" : ""}`}>{label}</span>
      </div>

      {/* Show children if current step or complete and children exist */}
      {(isCurrent || isComplete) && children && (
        <div className="ml-7 mt-1">{children}</div>
      )}

      {/* Display error if current step and an error exists */}
      {isCurrent && error && (
        <div className="ml-7 mt-2 p-3 border border-red-300 bg-red-50 rounded-md">
          <p className="text-sm font-medium text-red-700">Error:</p>
          <p className="text-xs text-red-600 mt-1">{error.message}</p>
        </div>
      )}
    </div>
  );
};

interface OAuthFlowProgressProps {
  serverUrl: string;
  authState: AuthDebuggerState;
  updateAuthState: (updates: Partial<AuthDebuggerState>) => void;
  proceedToNextStep: () => Promise<void>;
}

const steps: Array<OAuthStep> = [
  "metadata_discovery",
  "client_registration",
  "authorization_redirect",
  "authorization_code",
  "token_request",
  "complete",
];

export const OAuthFlowProgress = ({
  serverUrl,
  authState,
  updateAuthState,
  proceedToNextStep,
}: OAuthFlowProgressProps) => {
  const { toast } = useToast();
  const provider = useMemo(
    () => new DebugInspectorOAuthClientProvider(serverUrl),
    [serverUrl],
  );
  const [clientInfo, setClientInfo] = useState<OAuthClientInformation | null>(
    null,
  );

  const currentStepIdx = steps.findIndex((s) => s === authState.oauthStep);

  useEffect(() => {
    const fetchClientInfo = async () => {
      if (authState.oauthClientInfo) {
        setClientInfo(authState.oauthClientInfo);
      } else {
        try {
          const info = await provider.clientInformation();
          if (info) {
            setClientInfo(info);
          }
        } catch (error) {
          console.error("Failed to fetch client information:", error);
        }
      }
    };

    if (currentStepIdx > steps.indexOf("client_registration")) {
      fetchClientInfo();
    }
  }, [
    provider,
    authState.oauthStep,
    authState.oauthClientInfo,
    currentStepIdx,
  ]);

  // Helper to get step props
  const getStepProps = (stepName: OAuthStep) => ({
    isComplete:
      currentStepIdx > steps.indexOf(stepName) ||
      currentStepIdx === steps.length - 1, // last step is "complete"
    isCurrent: authState.oauthStep === stepName,
    error: authState.oauthStep === stepName ? authState.latestError : null,
  });

  return (
    <div className="rounded-md border p-6 space-y-4 mt-4">
      <h3 className="text-lg font-medium">OAuth Flow Progress</h3>
      <p className="text-sm text-muted-foreground">
        Follow these steps to complete OAuth authentication with the server.
      </p>

      <div className="space-y-3">
        <OAuthStepDetails
          label="Metadata Discovery"
          {...getStepProps("metadata_discovery")}
        >
          {authState.oauthMetadata && (
            <details className="text-xs mt-2">
              <summary className="cursor-pointer text-muted-foreground font-medium">
                OAuth Metadata Sources
                {!authState.resourceMetadata && " ℹ️"}
              </summary>

              {authState.resourceMetadata && (
                <div className="mt-2">
                  <p className="font-medium">Resource Metadata:</p>
                  <p className="text-xs text-muted-foreground">
                    From{" "}
                    {
                      new URL(
                        "/.well-known/oauth-protected-resource",
                        serverUrl,
                      ).href
                    }
                  </p>
                  <pre className="mt-2 p-2 bg-muted rounded-md overflow-auto max-h-[300px]">
                    {JSON.stringify(authState.resourceMetadata, null, 2)}
                  </pre>
                </div>
              )}

              {authState.resourceMetadataError && (
                <div className="mt-2 p-3 border border-blue-300 bg-blue-50 rounded-md">
                  <p className="text-sm font-medium text-blue-700">
                    ℹ️ Problem with resource metadata from{" "}
                    <a
                      href={
                        new URL(
                          "/.well-known/oauth-protected-resource",
                          serverUrl,
                        ).href
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:text-blue-700"
                    >
                      {
                        new URL(
                          "/.well-known/oauth-protected-resource",
                          serverUrl,
                        ).href
                      }
                    </a>
                  </p>
                  <p className="text-xs text-blue-600 mt-1">
                    Resource metadata was added in the{" "}
                    <a href="https://modelcontextprotocol.io/specification/draft/basic/authorization#2-3-1-authorization-server-location">
                      2025-DRAFT-v2 specification update
                    </a>
                    <br />
                    {authState.resourceMetadataError.message}
                    {authState.resourceMetadataError instanceof TypeError &&
                      " (This could indicate the endpoint doesn't exist or does not have CORS configured)"}
                  </p>
                </div>
              )}

              {authState.oauthMetadata && (
                <div className="mt-2">
                  <p className="font-medium">Authorization Server Metadata:</p>
                  {authState.authServerUrl && (
                    <p className="text-xs text-muted-foreground">
                      From{" "}
                      {
                        new URL(
                          "/.well-known/oauth-authorization-server",
                          authState.authServerUrl,
                        ).href
                      }
                    </p>
                  )}
                  <pre className="mt-2 p-2 bg-muted rounded-md overflow-auto max-h-[300px]">
                    {JSON.stringify(authState.oauthMetadata, null, 2)}
                  </pre>
                </div>
              )}
            </details>
          )}
        </OAuthStepDetails>

        <OAuthStepDetails
          label="Client Registration"
          {...getStepProps("client_registration")}
        >
          {clientInfo && (
            <details className="text-xs mt-2">
              <summary className="cursor-pointer text-muted-foreground font-medium">
                Registered Client Information
              </summary>
              <pre className="mt-2 p-2 bg-muted rounded-md overflow-auto max-h-[300px]">
                {JSON.stringify(clientInfo, null, 2)}
              </pre>
            </details>
          )}
        </OAuthStepDetails>

        <OAuthStepDetails
          label="Preparing Authorization"
          {...getStepProps("authorization_redirect")}
        >
          {authState.authorizationUrl && (
            <div className="mt-2 p-3 border rounded-md bg-muted">
              <p className="font-medium mb-2 text-sm">Authorization URL:</p>
              <div className="flex items-center gap-2">
                <p className="text-xs break-all">
                  {String(authState.authorizationUrl)}
                </p>
                <button
                  onClick={() => {
                    try {
                      validateRedirectUrl(authState.authorizationUrl!);
                      window.open(
                        authState.authorizationUrl!,
                        "_blank",
                        "noopener noreferrer",
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
                  }}
                  className="flex items-center text-blue-500 hover:text-blue-700"
                  aria-label="Open authorization URL in new tab"
                  title="Open authorization URL"
                >
                  <ExternalLink className="h-4 w-4" />
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Click the link to authorize in your browser. After
                authorization, you'll be redirected back to continue the flow.
              </p>
            </div>
          )}
        </OAuthStepDetails>

        <OAuthStepDetails
          label="Request Authorization and acquire authorization code"
          {...getStepProps("authorization_code")}
        >
          <div className="mt-3">
            <label
              htmlFor="authCode"
              className="block text-sm font-medium mb-1"
            >
              Authorization Code
            </label>
            <div className="flex gap-2">
              <input
                id="authCode"
                value={authState.authorizationCode}
                onChange={(e) => {
                  updateAuthState({
                    authorizationCode: e.target.value,
                    validationError: null,
                  });
                }}
                placeholder="Enter the code from the authorization server"
                className={`flex h-9 w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  authState.validationError ? "border-red-500" : "border-input"
                }`}
              />
            </div>
            {authState.validationError && (
              <p className="text-xs text-red-600 mt-1">
                {authState.validationError}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Once you've completed authorization in the link, paste the code
              here.
            </p>
          </div>
        </OAuthStepDetails>

        <OAuthStepDetails
          label="Token Request"
          {...getStepProps("token_request")}
        >
          {authState.oauthMetadata && (
            <details className="text-xs mt-2">
              <summary className="cursor-pointer text-muted-foreground font-medium">
                Token Request Details
              </summary>
              <div className="mt-2 p-2 bg-muted rounded-md">
                <p className="font-medium">Token Endpoint:</p>
                <code className="block mt-1 text-xs overflow-x-auto">
                  {authState.oauthMetadata.token_endpoint}
                </code>
              </div>
            </details>
          )}
        </OAuthStepDetails>

        <OAuthStepDetails
          label="Authentication Complete"
          {...getStepProps("complete")}
        >
          {authState.oauthTokens && (
            <details className="text-xs mt-2">
              <summary className="cursor-pointer text-muted-foreground font-medium">
                Access Tokens
              </summary>
              <p className="mt-1 text-sm">
                Authentication successful! You can now use the authenticated
                connection. These tokens will be used automatically for server
                requests.
              </p>
              <pre className="mt-2 p-2 bg-muted rounded-md overflow-auto max-h-[300px]">
                {JSON.stringify(authState.oauthTokens, null, 2)}
              </pre>
            </details>
          )}
        </OAuthStepDetails>
      </div>

      <div className="flex gap-3 mt-4">
        {authState.oauthStep !== "complete" && (
          <>
            <Button
              onClick={proceedToNextStep}
              disabled={authState.isInitiatingAuth}
            >
              {authState.isInitiatingAuth ? "Processing..." : "Continue"}
            </Button>
          </>
        )}

        {authState.oauthStep === "authorization_redirect" &&
          authState.authorizationUrl && (
            <Button
              variant="outline"
              onClick={() => {
                try {
                  validateRedirectUrl(authState.authorizationUrl!);
                  window.open(authState.authorizationUrl!, "_blank");
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
              }}
            >
              Open in New Tab
            </Button>
          )}
      </div>
    </div>
  );
};
