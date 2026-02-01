import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import { SelectableItem } from "./SelectableItem.js";
import type {
  MCPServerConfig,
  InspectorClient,
} from "@modelcontextprotocol/inspector-shared/mcp/index.js";
import type {
  AuthGuidedState,
  OAuthStep,
} from "@modelcontextprotocol/inspector-shared/auth";

const STEP_LABELS: Record<OAuthStep, string> = {
  metadata_discovery: "Metadata Discovery",
  client_registration: "Client Registration",
  authorization_redirect: "Preparing Authorization",
  authorization_code: "Request Authorization Code",
  token_request: "Token Request",
  complete: "Authentication Complete",
};

const STEP_ORDER: OAuthStep[] = [
  "metadata_discovery",
  "client_registration",
  "authorization_redirect",
  "authorization_code",
  "token_request",
  "complete",
];

function stepIndex(step: OAuthStep): number {
  const i = STEP_ORDER.indexOf(step);
  return i >= 0 ? i : 0;
}

interface AuthTabProps {
  serverName: string | null;
  serverConfig: MCPServerConfig | null;
  inspectorClient: InspectorClient | null;
  oauthStatus: "idle" | "authenticating" | "success" | "error";
  oauthMessage: string | null;
  width: number;
  height: number;
  focused?: boolean;
  selectedAction: "guided" | "quick" | "clear";
  onSelectedActionChange: (action: "guided" | "quick" | "clear") => void;
  onQuickAuth: () => Promise<void>;
  onGuidedStart: () => Promise<void>;
  onGuidedAdvance: () => Promise<void>;
  onRunGuidedToCompletion: () => Promise<void>;
  onClearOAuth: () => void;
  isOAuthCapable: boolean;
}

export function AuthTab({
  serverName,
  serverConfig,
  inspectorClient,
  oauthStatus,
  oauthMessage,
  width,
  height,
  focused = false,
  selectedAction,
  onSelectedActionChange,
  onQuickAuth,
  onGuidedStart,
  onGuidedAdvance,
  onRunGuidedToCompletion,
  onClearOAuth,
  isOAuthCapable,
}: AuthTabProps) {
  const scrollViewRef = useRef<ScrollViewRef>(null);
  const [oauthState, setOauthState] = useState<AuthGuidedState | undefined>(
    undefined,
  );
  const [guidedStarted, setGuidedStarted] = useState(false);
  const [clearedConfirmation, setClearedConfirmation] = useState(false);

  // Sync oauthState from InspectorClient
  useEffect(() => {
    if (!inspectorClient) {
      setOauthState(undefined);
      setGuidedStarted(false);
      return;
    }

    const update = () => setOauthState(inspectorClient.getOAuthState());
    update();

    const onStepChange = () => update();
    inspectorClient.addEventListener("oauthStepChange", onStepChange);
    inspectorClient.addEventListener("oauthComplete", onStepChange);
    return () => {
      inspectorClient.removeEventListener("oauthStepChange", onStepChange);
      inspectorClient.removeEventListener("oauthComplete", onStepChange);
    };
  }, [inspectorClient]);

  // Reset guided state when switching servers
  useEffect(() => {
    setGuidedStarted(false);
  }, [serverName]);

  // Clear confirmation when switching away from Clear menu item
  useEffect(() => {
    if (selectedAction !== "clear") {
      setClearedConfirmation(false);
    }
  }, [selectedAction]);

  const guidedFlowStarted = !!oauthState?.oauthStep;
  const currentStep = oauthState?.oauthStep ?? "metadata_discovery";
  const needsAuthCode =
    currentStep === "authorization_code" && oauthState?.authorizationUrl;
  const isComplete = currentStep === "complete";

  const handleContinue = useCallback(async () => {
    if (!guidedStarted) {
      await onGuidedStart();
      setGuidedStarted(true);
    } else if (!needsAuthCode && !isComplete) {
      await onGuidedAdvance();
    }
  }, [
    guidedStarted,
    needsAuthCode,
    isComplete,
    onGuidedStart,
    onGuidedAdvance,
  ]);

  // Keyboard: G/Q/S select menu item (handled by App when not focused),
  // left/right select, Enter run, up/down scroll
  useInput(
    (input: string, key: Key) => {
      if (!focused || !isOAuthCapable) return;

      const lower = input.toLowerCase();
      if (lower === "g") {
        onSelectedActionChange("guided");
        return;
      }
      if (lower === "q") {
        onSelectedActionChange("quick");
        return;
      }
      if (lower === "s") {
        onSelectedActionChange("clear");
        return;
      }

      if (key.leftArrow) {
        onSelectedActionChange(
          selectedAction === "guided"
            ? "clear"
            : selectedAction === "quick"
              ? "guided"
              : "quick",
        );
      } else if (key.rightArrow) {
        onSelectedActionChange(
          selectedAction === "guided"
            ? "quick"
            : selectedAction === "quick"
              ? "clear"
              : "guided",
        );
      } else if (key.upArrow && scrollViewRef.current) {
        scrollViewRef.current.scrollBy(-1);
      } else if (key.downArrow && scrollViewRef.current) {
        scrollViewRef.current.scrollBy(1);
      } else if (key.pageUp && scrollViewRef.current) {
        const h = scrollViewRef.current.getViewportHeight() || 1;
        scrollViewRef.current.scrollBy(-h);
      } else if (key.pageDown && scrollViewRef.current) {
        const h = scrollViewRef.current.getViewportHeight() || 1;
        scrollViewRef.current.scrollBy(h);
      } else if (key.return) {
        if (selectedAction === "guided") onRunGuidedToCompletion();
        else if (selectedAction === "quick") onQuickAuth();
        else if (selectedAction === "clear") {
          onClearOAuth();
          setClearedConfirmation(true);
        }
      } else if (input === " " && selectedAction === "guided") {
        handleContinue();
      }
    },
    {
      isActive: focused,
    },
  );

  if (!serverName || !isOAuthCapable) {
    return (
      <Box width={width} height={height} paddingX={1} paddingY={1}>
        <Text dimColor>
          Select an OAuth-capable server (SSE or Streamable HTTP) to configure
          authentication.
        </Text>
      </Box>
    );
  }

  return (
    <Box width={width} height={height} flexDirection="column" paddingX={1}>
      <Box paddingY={1} flexShrink={0}>
        <Text bold backgroundColor={focused ? "yellow" : undefined}>
          Authentication
        </Text>
      </Box>
      <Box
        flexGrow={0}
        overflow="hidden"
        flexDirection="column"
        gap={0}
        paddingY={0}
      >
        {/* Action bar and hint - single container for tight spacing */}
        <Box flexShrink={0} flexDirection="column" gap={0} paddingBottom={1}>
          <Box flexDirection="row" gap={2}>
            <SelectableItem
              isSelected={selectedAction === "guided"}
              bold={selectedAction === "guided"}
            >
              <Text underline>G</Text>uided Auth
            </SelectableItem>
            <SelectableItem
              isSelected={selectedAction === "quick"}
              bold={selectedAction === "quick"}
            >
              <Text underline>Q</Text>uick Auth
            </SelectableItem>
            <SelectableItem
              isSelected={selectedAction === "clear"}
              bold={selectedAction === "clear"}
            >
              Clear OAuth <Text underline>S</Text>tate
            </SelectableItem>
          </Box>
          <Box flexDirection="column">
            {selectedAction === "guided" && (
              <>
                <Text dimColor>
                  Press [Space] to advance one step through guided auth.
                </Text>
                <Text dimColor>
                  Press [Enter] to run guided auth to completion.
                </Text>
              </>
            )}
            {selectedAction === "quick" && (
              <Text dimColor>Press [Enter] to run quick auth.</Text>
            )}
            {selectedAction === "clear" && (
              <Text dimColor>Press [Enter] to clear OAuth state.</Text>
            )}
          </Box>
        </Box>
        <ScrollView ref={scrollViewRef} height={height - 10}>
          {selectedAction === "guided" && (
            <Box key="guided" flexShrink={0} flexDirection="column">
              <Text bold>Guided OAuth Flow Progress</Text>
              {STEP_ORDER.map((step) => {
                const stepIdx = stepIndex(step);
                const currentIdx = stepIndex(currentStep);
                const completed =
                  guidedFlowStarted &&
                  (stepIdx < currentIdx ||
                    (step === currentStep && isComplete));
                const inProgress =
                  guidedFlowStarted && step === currentStep && !isComplete;
                const details = oauthState
                  ? getStepDetails(oauthState, step)
                  : null;

                const icon = completed ? "✓" : inProgress ? "→" : "○";
                const color = completed
                  ? "green"
                  : inProgress
                    ? "cyan"
                    : "gray";

                return (
                  <Box
                    key={step}
                    marginTop={1}
                    flexDirection="column"
                    paddingLeft={2}
                  >
                    <Text color={color}>
                      {icon} {STEP_LABELS[step]}
                      {inProgress && " (in progress)"}
                    </Text>
                    {completed && details && (
                      <Box marginTop={1} paddingLeft={2} flexDirection="column">
                        <Text dimColor>{details}</Text>
                      </Box>
                    )}
                    {inProgress && details && (
                      <Box marginTop={1} paddingLeft={2} flexDirection="column">
                        <Text dimColor>{details}</Text>
                      </Box>
                    )}
                  </Box>
                );
              })}

              {/* Waiting for auth - URL was opened when we reached this step */}
              {oauthState && needsAuthCode && oauthState?.authorizationUrl && (
                <Box marginTop={2} flexDirection="column">
                  <Text bold>Authorization URL opened in browser</Text>
                  <Box marginTop={1}>
                    <Text dimColor>
                      {oauthState.authorizationUrl.toString()}
                    </Text>
                  </Box>
                  <Box marginTop={1}>
                    <Text dimColor>
                      Complete authorization in the browser. You will be
                      redirected and the flow will complete automatically.
                    </Text>
                  </Box>
                </Box>
              )}
            </Box>
          )}

          {selectedAction === "quick" && (
            <Box key="quick" flexShrink={0} flexDirection="column">
              {oauthStatus === "authenticating" && (
                <Text dimColor>Authenticating...</Text>
              )}
              {oauthStatus === "error" && oauthMessage && (
                <Text color="red">{oauthMessage}</Text>
              )}
              {oauthStatus === "success" &&
                oauthState &&
                oauthState.authType === "normal" &&
                (oauthState.oauthTokens || oauthState.oauthClientInfo) && (
                  <>
                    <Text bold>Quick Auth Results</Text>
                    {oauthState.oauthClientInfo && (
                      <Box marginTop={1} flexDirection="column" paddingLeft={2}>
                        <Text dimColor>
                          Client:{" "}
                          {JSON.stringify(oauthState.oauthClientInfo, null, 2)}
                        </Text>
                      </Box>
                    )}
                    {oauthState.oauthTokens && (
                      <Box marginTop={1} flexDirection="column" paddingLeft={2}>
                        <Text dimColor>
                          Access Token:{" "}
                          {oauthState.oauthTokens.access_token?.slice(0, 20)}...
                        </Text>
                      </Box>
                    )}
                  </>
                )}
            </Box>
          )}

          {selectedAction === "clear" && clearedConfirmation && (
            <Box key="clear" flexShrink={0} flexDirection="column">
              <Text color="green">OAuth state cleared.</Text>
            </Box>
          )}
        </ScrollView>
      </Box>

      {focused && (
        <Box
          flexShrink={0}
          height={1}
          justifyContent="center"
          backgroundColor="gray"
        >
          <Text bold color="white">
            ←/→ select, G/Q/S or Enter run, ↑/↓ scroll
          </Text>
        </Box>
      )}
    </Box>
  );
}

function getStepDetails(
  state: AuthGuidedState,
  step: OAuthStep,
): string | null {
  switch (step) {
    case "metadata_discovery":
      if (state.resourceMetadata || state.oauthMetadata) {
        const parts: string[] = [];
        if (state.resourceMetadata) {
          parts.push(
            `Resource: ${JSON.stringify(state.resourceMetadata, null, 2)}`,
          );
        }
        if (state.oauthMetadata) {
          parts.push(`OAuth: ${JSON.stringify(state.oauthMetadata, null, 2)}`);
        }
        return parts.join("\n");
      }
      return null;
    case "client_registration":
      if (state.oauthClientInfo) {
        return JSON.stringify(state.oauthClientInfo, null, 2);
      }
      return null;
    case "authorization_redirect":
      if (state.authorizationUrl) {
        return `URL: ${state.authorizationUrl.toString()}`;
      }
      return null;
    case "authorization_code":
      return state.authorizationCode
        ? `Code received: ${state.authorizationCode.slice(0, 10)}...`
        : null;
    case "token_request":
      return "Exchanging code for tokens...";
    case "complete":
      if (state.oauthTokens) {
        return `Tokens: access_token=${state.oauthTokens.access_token?.slice(0, 15)}...`;
      }
      return null;
    default:
      return null;
  }
}
