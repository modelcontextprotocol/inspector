import type { AuthGuidedState } from "@modelcontextprotocol/inspector-core/auth/types.js";
import type { OAuthStep } from "@modelcontextprotocol/inspector-core/auth/types.js";
import type { InspectorClient } from "@modelcontextprotocol/inspector-core/mcp/index.js";
import { CheckCircle2, Circle, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import { useEffect, useState } from "react";
import type { OAuthClientInformation } from "@modelcontextprotocol/sdk/shared/auth.js";
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
  oauthState: AuthGuidedState | undefined;
  proceedToNextStep: () => Promise<void>;
  ensureInspectorClient: () => InspectorClient | null;
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
  oauthState,
  proceedToNextStep,
  ensureInspectorClient,
}: OAuthFlowProgressProps) => {
  const { toast } = useToast();
  const [clientInfo, setClientInfo] = useState<OAuthClientInformation | null>(
    null,
  );
  // Local state for authorization code input (synced from oauthState but allows typing)
  const [localAuthCode, setLocalAuthCode] = useState<string>("");

  // Sync local state from oauthState when it changes
  useEffect(() => {
    if (oauthState?.authorizationCode) {
      setLocalAuthCode(oauthState.authorizationCode);
    } else {
      setLocalAuthCode("");
    }
  }, [oauthState?.authorizationCode]);

  const currentStepIdx = oauthState
    ? steps.findIndex((s) => s === oauthState.oauthStep)
    : -1;

  useEffect(() => {
    if (oauthState?.oauthClientInfo) {
      setClientInfo(oauthState.oauthClientInfo);
    }
  }, [oauthState]);

  // Helper to get step props
  const getStepProps = (stepName: OAuthStep) => ({
    isComplete:
      currentStepIdx > steps.indexOf(stepName) ||
      currentStepIdx === steps.length - 1, // last step is "complete"
    isCurrent: oauthState?.oauthStep === stepName,
    error: oauthState?.oauthStep === stepName ? oauthState.latestError : null,
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
          {oauthState?.oauthMetadata && (
            <details className="text-xs mt-2">
              <summary className="cursor-pointer text-muted-foreground font-medium">
                OAuth Metadata Sources
                {!oauthState.resourceMetadata && " ℹ️"}
              </summary>

              {oauthState.resourceMetadata && (
                <div className="mt-2">
                  <p className="font-medium">Resource Metadata:</p>
                  <pre className="mt-2 p-2 bg-muted rounded-md overflow-auto max-h-[300px]">
                    {JSON.stringify(oauthState.resourceMetadata, null, 2)}
                  </pre>
                </div>
              )}

              {oauthState.resourceMetadataError && (
                <div className="mt-2 p-3 border border-blue-300 bg-blue-50 rounded-md">
                  <p className="text-sm font-medium text-blue-700">
                    ℹ️ Problem with resource metadata
                  </p>
                  <p className="text-xs text-blue-600 mt-1">
                    Resource metadata was added in the{" "}
                    <a href="https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization#authorization-server-location">
                      2025-06-18 specification update
                    </a>
                    <br />
                    {oauthState.resourceMetadataError.message}
                    {oauthState.resourceMetadataError instanceof TypeError &&
                      " (This could indicate the endpoint doesn't exist or does not have CORS configured)"}
                  </p>
                </div>
              )}

              {oauthState.oauthMetadata && (
                <div className="mt-2">
                  <p className="font-medium">Authorization Server Metadata:</p>
                  {oauthState.authServerUrl && (
                    <p className="text-xs text-muted-foreground">
                      From{" "}
                      {
                        new URL(
                          "/.well-known/oauth-authorization-server",
                          oauthState.authServerUrl,
                        ).href
                      }
                    </p>
                  )}
                  <pre className="mt-2 p-2 bg-muted rounded-md overflow-auto max-h-[300px]">
                    {JSON.stringify(oauthState.oauthMetadata, null, 2)}
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
          {oauthState?.authorizationUrl && (
            <div className="mt-2 p-3 border rounded-md bg-muted">
              <p className="font-medium mb-2 text-sm">Authorization URL:</p>
              <div className="flex items-center gap-2">
                <p className="text-xs break-all">
                  {String(oauthState.authorizationUrl)}
                </p>
                <button
                  onClick={() => {
                    if (!oauthState.authorizationUrl) return;
                    try {
                      validateRedirectUrl(oauthState.authorizationUrl);
                      // Log redirect_uri from URL for debugging
                      const redirectUriParam =
                        oauthState.authorizationUrl.searchParams.get(
                          "redirect_uri",
                        );
                      console.log(
                        "[OAuthFlowProgress] Opening authorization URL:",
                        {
                          fullUrl: oauthState.authorizationUrl.href,
                          redirectUri: redirectUriParam,
                          expectedRedirectUri: `${window.location.origin}/oauth/callback`,
                        },
                      );
                      window.open(
                        oauthState.authorizationUrl,
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
              <p className="text-xs text-muted-foreground mt-1">
                Expected redirect URL:{" "}
                <code className="text-xs">
                  {oauthState.authorizationUrl.searchParams.get("redirect_uri")}
                </code>
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
                value={localAuthCode}
                onChange={(e) => {
                  setLocalAuthCode(e.target.value);
                }}
                onBlur={async () => {
                  const code = localAuthCode.trim();
                  if (!code) return;

                  const client = ensureInspectorClient();
                  if (!client) {
                    toast({
                      title: "Error",
                      description:
                        "InspectorClient is not available. Please ensure API token is set.",
                      variant: "destructive",
                    });
                    return;
                  }

                  try {
                    await client.setGuidedAuthorizationCode(code, false);
                  } catch (error) {
                    toast({
                      title: "Error",
                      description:
                        error instanceof Error
                          ? error.message
                          : "Failed to set authorization code",
                      variant: "destructive",
                    });
                  }
                }}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur(); // Trigger onBlur which sets the code
                  }
                }}
                placeholder="Enter the code from the authorization server"
                className={`flex h-9 w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  oauthState?.validationError
                    ? "border-red-500"
                    : "border-input"
                }`}
              />
            </div>
            {oauthState?.validationError && (
              <p className="text-xs text-red-600 mt-1">
                {oauthState.validationError}
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
          {oauthState?.oauthMetadata && (
            <details className="text-xs mt-2">
              <summary className="cursor-pointer text-muted-foreground font-medium">
                Token Request Details
              </summary>
              <div className="mt-2 p-2 bg-muted rounded-md">
                <p className="font-medium">Token Endpoint:</p>
                <code className="block mt-1 text-xs overflow-x-auto">
                  {oauthState.oauthMetadata.token_endpoint}
                </code>
              </div>
            </details>
          )}
        </OAuthStepDetails>

        <OAuthStepDetails
          label="Authentication Complete"
          {...getStepProps("complete")}
        >
          {oauthState?.oauthTokens && (
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
                {JSON.stringify(oauthState.oauthTokens, null, 2)}
              </pre>
            </details>
          )}
        </OAuthStepDetails>
      </div>

      <div className="flex gap-3 mt-4">
        {oauthState && oauthState.oauthStep !== "complete" && (
          <>
            <Button
              onClick={async () => {
                // If at authorization_code step and we have a code in input but not set yet, set it first
                if (
                  oauthState.oauthStep === "authorization_code" &&
                  localAuthCode.trim() &&
                  !oauthState.authorizationCode
                ) {
                  const client = ensureInspectorClient();
                  if (client) {
                    try {
                      await client.setGuidedAuthorizationCode(
                        localAuthCode.trim(),
                        false,
                      );
                    } catch (error) {
                      toast({
                        title: "Error",
                        description:
                          error instanceof Error
                            ? error.message
                            : "Failed to set authorization code",
                        variant: "destructive",
                      });
                      return;
                    }
                  }
                }
                await proceedToNextStep();
              }}
              disabled={oauthState.isInitiatingAuth}
            >
              {oauthState.isInitiatingAuth ? "Processing..." : "Continue"}
            </Button>
          </>
        )}

        {oauthState?.oauthStep === "authorization_redirect" &&
          oauthState.authorizationUrl && (
            <Button
              variant="outline"
              onClick={() => {
                try {
                  validateRedirectUrl(oauthState.authorizationUrl!);
                  window.open(oauthState.authorizationUrl!, "_blank");
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
