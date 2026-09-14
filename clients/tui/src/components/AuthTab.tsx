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
  /**
   * How to colour {@link oauthMessage} on the `idle` status. Defaults to
   * `"info"` (cyan). `"warning"` exists for the one message that reports a
   * *partial* success: the OAuth state really was cleared, so this is not an
   * error, but the grant may still be live at the authorization server and
   * cyan would understate that (#2144).
   */
  oauthMessageTone?: "info" | "warning";
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
  /**
   * Clears (and, unless opted out, revokes) this server's OAuth state.
   *
   * Returns a promise so the confirmation below can wait for it. The RFC 7009
   * revocation leg is a network request with a five-second bound (#2144), so
   * this is no longer instantaneous, and announcing "cleared" on the keypress
   * would say it while the work was still in flight.
   */
  onClearOAuth: () => void | Promise<void>;
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
  oauthMessageTone = "info",
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
  const [clearState, setClearState] = useState<
    "idle" | "clearing" | "cleared" | "failed"
  >("idle");
  const [clearFailure, setClearFailure] = useState<string | null>(null);
  /**
   * The server a clear was started for, and a sequence number. The clear is a
   * bounded network request now, so it can settle after the user has moved on
   * — at which point server A's confirmation must not appear under server B.
   */
  const clearAttemptRef = useRef(0);
  /**
   * In-flight lock. A ref, not the `clearState` above: two `s` keypresses
   * delivered in the same input turn both read the state React last rendered,
   * so a state-based guard lets both start and race each other over the same
   * store entry. A ref is set before the call and seen by the second read.
   */
  const clearInFlightRef = useRef(false);
  /**
   * Set synchronously when a clear starts, and consumed by the reset effect
   * below. The clear itself bumps `oauthRevision` on its way out, so without
   * this the reset would race the confirmation it is meant to outlive — and
   * which of the two lands first is not something the ordering guarantees.
   */
  const ownClearRef = useRef(false);
  const serverNameRef = useRef(serverName);
  useEffect(() => {
    serverNameRef.current = serverName;
  }, [serverName]);
  // A new selection retires any in-flight clear and drops the previous one's
  // banner: neither belongs to the server now on screen.
  useEffect(() => {
    clearAttemptRef.current++;
    clearInFlightRef.current = false;
    // The retired clear returns before its `oauthRevision` bump, so the marker
    // has no bump to skip. Left set, it would swallow the first unrelated
    // revision on the server just selected and strand that server's banner.
    ownClearRef.current = false;
    setClearState("idle");
    setClearFailure(null);
    setLastClearDisconnected(false);
  }, [serverName]);
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
    // Skip exactly the revision bump our own clear caused; reset on the next.
    if (ownClearRef.current) {
      ownClearRef.current = false;
      return;
    }
    setClearState("idle");
    setClearFailure(null);
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
        // Ignore repeats while one is in flight: the second would race the
        // first over the same store entry, and the user cannot see that the
        // first is still running except by the pending line below.
        if (clearInFlightRef.current) return;
        clearInFlightRef.current = true;
        const attempt = ++clearAttemptRef.current;
        const attemptServer = serverName;
        setLastClearDisconnected(isLiveConnection);
        setClearFailure(null);
        ownClearRef.current = true;
        setClearState("clearing");
        // A completion is only ours if nothing has superseded it and the
        // selection has not moved on.
        const current = () =>
          clearAttemptRef.current === attempt &&
          serverNameRef.current === attemptServer;
        void Promise.resolve(onClearOAuth()).then(
          () => {
            // `current()` FIRST, before touching either shared ref. A stale
            // completion — server A settling after the user moved to B and
            // started a clear there — would otherwise drop B's lock and let a
            // second B clear run concurrently. A stale clear owns nothing.
            if (!current()) return;
            clearInFlightRef.current = false;
            setClearState("cleared");
          },
          (err: unknown) => {
            if (!current()) return;
            clearInFlightRef.current = false;
            // A rejection is NOT a revocation failure — those come back as
            // outcomes and are reported through the message line. This is the
            // local clear or the disconnect itself failing, so announcing
            // "OAuth state cleared" here would be a plain lie.
            //
            // It also means `handleClearOAuth` never reached its
            // `oauthRevision` bump, so the marker below has no bump to skip.
            // Left set, it would swallow the next *unrelated* revision change
            // and strand this banner after the OAuth state moved on.
            ownClearRef.current = false;
            setClearFailure(err instanceof Error ? err.message : String(err));
            setClearState("failed");
          },
        );
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
            <Text color={oauthMessageTone === "warning" ? "yellow" : "cyan"}>
              {oauthMessage}
            </Text>
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
            {clearState === "clearing" && (
              <Text color="yellow">Clearing OAuth state…</Text>
            )}
            {clearState === "cleared" && (
              <Text color="green">
                {lastClearDisconnected
                  ? "OAuth state cleared. Disconnected."
                  : "OAuth state cleared."}
              </Text>
            )}
            {clearState === "failed" && (
              <Text color="red">
                Could not clear OAuth state
                {clearFailure ? `: ${clearFailure}` : "."}
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
