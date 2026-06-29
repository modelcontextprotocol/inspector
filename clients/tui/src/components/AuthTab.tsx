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
import {
  formatAuthProtocol,
  formatClientRegistrationKind,
  formatIdpSession,
  formatScopes,
} from "../utils/oauthDisplay.js";

interface AuthTabProps {
  serverName: string | null;
  serverConfig: MCPServerConfig | null;
  inspectorClient: InspectorClient | null;
  oauthStatus: "idle" | "authenticating" | "error";
  oauthMessage: string | null;
  oauthRevision: number;
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
  }, [refreshOAuthState, oauthRevision]);

  useEffect(() => {
    setClearedConfirmation(false);
    setLastClearDisconnected(false);
  }, [oauthRevision]);

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
            S {isLiveConnection ? "clear+disconnect" : "clear"}, ↑/↓ scroll
          </Text>
        </Box>
      )}
    </Box>
  );
}
