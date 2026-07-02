import React, { useState, useEffect, useRef, useCallback } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import { SelectableItem } from "./SelectableItem.js";
import type {
  MCPServerConfig,
  InspectorClient,
  ConnectionStatus,
} from "@inspector/core/mcp/index.js";
import type { OAuthConnectionState } from "@inspector/core/auth/types.js";
import type { AuthChallenge } from "@inspector/core/auth/challenge.js";
import {
  formatAuthProtocol,
  formatClientRegistrationKind,
  formatIdpSession,
  formatScopes,
} from "../utils/oauthDisplay.js";
import {
  stepUpAuthorizeActionLabel,
  stepUpConfirmMessage,
  stepUpFollowUpMessage,
  stepUpModalTitle,
} from "../utils/tuiOAuth.js";

interface AuthTabProps {
  serverName: string | null;
  serverConfig: MCPServerConfig | null;
  inspectorClient: InspectorClient | null;
  oauthStatus: "idle" | "authenticating" | "error";
  oauthMessage: string | null;
  oauthRevision: number;
  pendingStepUp?: {
    challenge: AuthChallenge;
    authorizationScopes?: string[];
    enterpriseManaged?: boolean;
  } | null;
  onAuthorizeStepUp?: () => void;
  onCancelStepUp?: () => void;
  width: number;
  height: number;
  focused?: boolean;
  onClearOAuth: () => void;
  connectionStatus: ConnectionStatus;
}

function OAuthDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Box flexDirection="row" gap={1}>
      <Text dimColor>{label}:</Text>
      <Text>{value}</Text>
    </Box>
  );
}

export function AuthTab({
  serverName,
  inspectorClient,
  oauthStatus,
  oauthMessage,
  oauthRevision,
  pendingStepUp,
  onAuthorizeStepUp,
  onCancelStepUp,
  width,
  height,
  focused = false,
  onClearOAuth,
  connectionStatus,
}: AuthTabProps) {
  const isLiveConnection =
    connectionStatus === "connected" || connectionStatus === "connecting";
  const scrollViewRef = useRef<ScrollViewRef>(null);
  const [oauthState, setOauthState] = useState<
    OAuthConnectionState | undefined
  >(undefined);
  const [clearedConfirmation, setClearedConfirmation] = useState(false);
  const [lastClearDisconnected, setLastClearDisconnected] = useState(false);
  const [stepUpChoiceIndex, setStepUpChoiceIndex] = useState(0);

  const refreshOAuthState = useCallback(async () => {
    if (!inspectorClient) {
      setOauthState(undefined);
      return;
    }
    const state = await inspectorClient.getOAuthState();
    setOauthState(state);
  }, [inspectorClient]);

  useEffect(() => {
    void refreshOAuthState();
  }, [refreshOAuthState, oauthRevision, connectionStatus]);

  useEffect(() => {
    setClearedConfirmation(false);
    setLastClearDisconnected(false);
  }, [oauthRevision]);

  useEffect(() => {
    setStepUpChoiceIndex(0);
  }, [pendingStepUp]);

  useEffect(() => {
    if (!inspectorClient) return;

    const update = () => {
      void refreshOAuthState();
    };
    inspectorClient.addEventListener("oauthComplete", update);
    return () => {
      inspectorClient.removeEventListener("oauthComplete", update);
    };
  }, [inspectorClient, refreshOAuthState]);

  useInput(
    (input: string, key: Key) => {
      if (!focused) return;

      if (pendingStepUp) {
        if (key.upArrow) {
          setStepUpChoiceIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow) {
          setStepUpChoiceIndex((i) => Math.min(1, i + 1));
          return;
        }
        if (key.return) {
          if (stepUpChoiceIndex === 0) {
            onAuthorizeStepUp?.();
          } else {
            onCancelStepUp?.();
          }
          return;
        }
        if (input.toLowerCase() === "a") {
          onAuthorizeStepUp?.();
          return;
        }
        if (input.toLowerCase() === "c") {
          onCancelStepUp?.();
          return;
        }
        return;
      }

      if (key.upArrow && scrollViewRef.current) {
        scrollViewRef.current.scrollBy(-1);
      } else if (key.downArrow && scrollViewRef.current) {
        scrollViewRef.current.scrollBy(1);
      } else if (key.pageUp && scrollViewRef.current) {
        const h = scrollViewRef.current.getViewportHeight() || 1;
        scrollViewRef.current.scrollBy(-h);
      } else if (key.pageDown && scrollViewRef.current) {
        const h = scrollViewRef.current.getViewportHeight() || 1;
        scrollViewRef.current.scrollBy(h);
      } else if (input.toLowerCase() === "s") {
        setLastClearDisconnected(isLiveConnection);
        onClearOAuth();
        setClearedConfirmation(true);
      }
    },
    { isActive: focused },
  );

  if (!serverName) {
    return (
      <Box width={width} height={height} paddingX={1} paddingY={1}>
        <Text dimColor>Select a server to view authentication.</Text>
      </Box>
    );
  }

  const scopes = oauthState ? formatScopes(oauthState) : undefined;
  const accessToken = oauthState?.tokens?.access_token;

  return (
    <Box width={width} height={height} flexDirection="column" paddingX={1}>
      <Box paddingY={1} flexShrink={0}>
        <Text bold backgroundColor={focused ? "yellow" : undefined}>
          OAuth
        </Text>
      </Box>

      <ScrollView ref={scrollViewRef} height={height - 8}>
        <Box flexDirection="column" gap={0}>
          {oauthStatus === "authenticating" && (
            <Text color="yellow">Authenticating…</Text>
          )}
          {oauthStatus === "error" && oauthMessage && (
            <Text color="red">{oauthMessage}</Text>
          )}
          {oauthStatus === "idle" && oauthMessage && (
            <Text color="cyan">{oauthMessage}</Text>
          )}

          {pendingStepUp ? (
            <Box marginTop={1} flexDirection="column" gap={0}>
              <Text bold color="yellow">
                {stepUpModalTitle({
                  enterpriseManaged: pendingStepUp.enterpriseManaged,
                })}
              </Text>
              <Text>
                {stepUpConfirmMessage(pendingStepUp.challenge, {
                  enterpriseManaged: pendingStepUp.enterpriseManaged,
                })}{" "}
                {stepUpFollowUpMessage({
                  enterpriseManaged: pendingStepUp.enterpriseManaged,
                })}
              </Text>
              {(() => {
                const scopes =
                  pendingStepUp.authorizationScopes ??
                  pendingStepUp.challenge.requiredScopes;
                if (!scopes?.length) return null;
                return (
                  <Box marginTop={1} flexDirection="column">
                    <Text dimColor>
                      {pendingStepUp.enterpriseManaged
                        ? "Permissions requested:"
                        : "Scopes requested:"}
                    </Text>
                    {scopes.map((scope) => (
                      <Text key={scope} dimColor>
                        {" "}
                        • {scope}
                      </Text>
                    ))}
                  </Box>
                );
              })()}
              <Box marginTop={1} flexDirection="column">
                <SelectableItem isSelected={stepUpChoiceIndex === 0} bold>
                  {(() => {
                    const label = stepUpAuthorizeActionLabel({
                      enterpriseManaged: pendingStepUp.enterpriseManaged,
                    });
                    return (
                      <>
                        <Text underline>{label[0]}</Text>
                        {label.slice(1)}
                      </>
                    );
                  })()}
                </SelectableItem>
                <SelectableItem isSelected={stepUpChoiceIndex === 1}>
                  <Text underline>C</Text>ancel
                </SelectableItem>
              </Box>
            </Box>
          ) : null}

          {oauthState ? (
            <Box flexDirection="column" marginTop={1} gap={0}>
              <Text bold>OAuth Details</Text>
              <Box marginTop={1} flexDirection="column" paddingLeft={0} gap={0}>
                <OAuthDetailRow
                  label="Protocol"
                  value={formatAuthProtocol(oauthState.protocol)}
                />
                <OAuthDetailRow
                  label="Status"
                  value={
                    oauthState.authorized ? "Authorized" : "Not authorized"
                  }
                />
                {oauthState.client?.clientId && (
                  <OAuthDetailRow
                    label="Client ID"
                    value={oauthState.client.clientId}
                  />
                )}
                {oauthState.client?.registrationKind && (
                  <OAuthDetailRow
                    label="Client registration"
                    value={formatClientRegistrationKind(
                      oauthState.client.registrationKind,
                    )}
                  />
                )}
                {oauthState.protocol === "ema" &&
                  oauthState.ema?.idpSession && (
                    <OAuthDetailRow
                      label="IdP session"
                      value={formatIdpSession(oauthState.ema.idpSession)}
                    />
                  )}
                {oauthState.authorizationServerMetadata
                  ?.authorization_endpoint && (
                  <OAuthDetailRow
                    label="Auth URL"
                    value={
                      oauthState.authorizationServerMetadata
                        .authorization_endpoint
                    }
                  />
                )}
                {scopes && <OAuthDetailRow label="Scopes" value={scopes} />}
                {accessToken && (
                  <OAuthDetailRow
                    label="Access token"
                    value={`${accessToken.slice(0, 24)}…`}
                  />
                )}
              </Box>
            </Box>
          ) : (
            oauthStatus !== "authenticating" && (
              <Box marginTop={1} flexDirection="column" gap={0}>
                <Text dimColor>No OAuth information yet.</Text>
                <Text dimColor>
                  Connect (C) to authorize when this server requires it.
                </Text>
              </Box>
            )
          )}

          <Box marginTop={2} flexDirection="column" gap={0}>
            <SelectableItem isSelected bold>
              Clear OAuth <Text underline>S</Text>tate
              {isLiveConnection && " and disconnect"}
            </SelectableItem>
            {clearedConfirmation && (
              <Text color="green">
                {lastClearDisconnected
                  ? "OAuth state cleared. Disconnected."
                  : "OAuth state cleared."}
              </Text>
            )}
          </Box>
        </Box>
      </ScrollView>

      {focused && (
        <Box
          flexShrink={0}
          height={1}
          justifyContent="center"
          backgroundColor="gray"
        >
          <Text bold color="white">
            {pendingStepUp
              ? "↑/↓ select, Enter confirm, A authorize, C cancel"
              : `S ${isLiveConnection ? "clear+disconnect" : "clear"}, ↑/↓ scroll`}
          </Text>
        </Box>
      )}
    </Box>
  );
}
