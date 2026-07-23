import {
  Badge,
  Button,
  Code,
  Flex,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type {
  ClientCapabilities,
  DiscoverResult,
  InitializeResult,
  ProtocolEra,
} from "@modelcontextprotocol/client";
import type { ServerType } from "@inspector/core/mcp/types.js";
import type { OAuthClientRegistrationKind } from "@inspector/core/auth/types.js";
import {
  CapabilityItem,
  type CapabilityKey,
} from "../../elements/CapabilityItem/CapabilityItem";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { EraBadge } from "../../elements/EraBadge/EraBadge";
import { isModernEra } from "../../elements/EraBadge/eraUtils";
import { OAuthAccessTokenField } from "./OAuthAccessTokenField";

export interface OAuthDetails {
  protocol: "standard" | "ema";
  authorized: boolean;
  clientId?: string;
  clientRegistrationKind?: OAuthClientRegistrationKind;
  authUrl?: string;
  scopes?: string[];
  accessToken?: string;
  /** EMA only — install-level IdP session for legs 1–2. */
  idpSession?: "none" | "logged_in" | "expired";
}

export interface ConnectionInfoContentProps {
  initializeResult: InitializeResult;
  clientCapabilities: ClientCapabilities;
  transport: ServerType;
  /**
   * Protocol era negotiated with the server (SEP §7.8). `"modern"` connections
   * are sessionless and learn capabilities from `server/discover`; `"legacy"`
   * (or undefined, on a plain legacy connect) use the initialize handshake.
   * (#1626)
   */
  protocolEra?: ProtocolEra;
  /**
   * The `server/discover` result on a modern connection — supported versions,
   * capabilities, and extensions learned up front. Undefined on legacy. (#1626)
   */
  discoverResult?: DiscoverResult;
  oauth?: OAuthDetails;
  onClearOAuth?: () => void;
}

const ValueText = Text.withProps({
  size: "sm",
  fw: 600,
});

const SectionHeading = Title.withProps({
  // `order: 3` (not 5) keeps the heading level one below the modal's `h2`
  // `Modal.Title`, so the outline doesn't skip a level (axe `heading-order`);
  // `size: "h5"` preserves the original small visual size.
  order: 3,
  size: "h5",
  variant: "section",
});

// Long OAuth values (client id, auth URL). The `wrapping` variant wraps the
// value onto multiple lines instead of leaving it in a horizontally-scrolling
// `Code` block — that keeps the whole value visible and removes a scroll region
// that would otherwise need its own keyboard access (axe
// `scrollable-region-focusable`).
const ValueCode = Code.withProps({ variant: "wrapping" });

function formatScopes(scopes: string[]): string {
  return scopes.join(", ");
}

function formatProtocol(protocol: OAuthDetails["protocol"]): string {
  return protocol === "ema" ? "Enterprise-managed" : "Standard";
}

function formatIdpSession(
  session: NonNullable<OAuthDetails["idpSession"]>,
): string {
  switch (session) {
    case "logged_in":
      return "Signed in";
    case "expired":
      return "Session expired";
    default:
      return "Not signed in";
  }
}

function formatClientRegistrationKind(
  kind: OAuthClientRegistrationKind,
): string {
  switch (kind) {
    case "static":
      return "Static (preregistered)";
    case "dcr":
      return "Dynamic (DCR)";
    case "cimd":
      return "Client ID Metadata (CIMD)";
  }
}

// `isModernEra` / `formatEra` are shared with the Protocol view via the
// EraBadge element (single source of truth for the legacy/modern distinction).

// The session concept is HTTP-only: modern HTTP connections are sessionless (no
// `Mcp-Session-Id`, nothing to DELETE on disconnect) while a legacy HTTP
// connection may carry a server session. stdio has no HTTP session at all, so
// the row is not applicable there.
function formatSession(
  era: ProtocolEra | undefined,
  transport: ServerType,
): string {
  if (transport === "stdio") return "N/A (stdio)";
  return isModernEra(era) ? "Sessionless" : "Session-based";
}

// Render an `extensions` capability map (SEP-2133) as a comma-separated list of
// its extension identifiers, or an em dash when none are present. Works for
// either side's map: the server's negotiated `capabilities.extensions` (present
// on both eras via `getServerCapabilities()`) or the Inspector's own advertised
// `clientCapabilities.extensions`. (#1740)
function formatExtensions(
  extensions: Record<string, unknown> | undefined,
): string {
  const keys = extensions ? Object.keys(extensions) : [];
  return keys.length > 0 ? keys.join(", ") : "—";
}

const SERVER_CAPABILITY_KEYS: CapabilityKey[] = [
  "tools",
  "resources",
  "prompts",
  "logging",
  "completions",
  "tasks",
  "experimental",
];

const CLIENT_CAPABILITY_KEYS: CapabilityKey[] = [
  "roots",
  "sampling",
  "elicitation",
  "experimental",
];

export const CLEAR_OAUTH_STATE_AND_DISCONNECT_LABEL =
  "Clear OAuth state and disconnect";

function getCapabilityEntries(
  capabilities: Record<string, unknown>,
  knownKeys: CapabilityKey[],
): { capability: CapabilityKey; supported: boolean }[] {
  return knownKeys.map((key) => ({
    capability: key,
    supported: key in capabilities && capabilities[key] != null,
  }));
}

export function ConnectionInfoContent({
  initializeResult,
  clientCapabilities,
  transport,
  protocolEra,
  discoverResult,
  oauth,
  onClearOAuth,
}: ConnectionInfoContentProps) {
  const { serverInfo, protocolVersion, capabilities, instructions } =
    initializeResult;

  const serverCaps = getCapabilityEntries(capabilities, SERVER_CAPABILITY_KEYS);
  const clientCaps = getCapabilityEntries(
    clientCapabilities,
    CLIENT_CAPABILITY_KEYS,
  );

  return (
    <Stack gap="md">
      <Stack gap="xs">
        <SectionHeading>Server Implementation</SectionHeading>
        <SimpleGrid cols={2}>
          <Text size="sm">Name</Text>
          <ValueText>{serverInfo.name}</ValueText>

          <Text size="sm">Version</Text>
          <ValueText>{serverInfo.version ?? "—"}</ValueText>

          <Text size="sm">Protocol</Text>
          <ValueText>{protocolVersion}</ValueText>

          <Text size="sm">Transport</Text>
          <Badge variant="outline">{transport}</Badge>

          <Text size="sm">Era</Text>
          <EraBadge era={protocolEra} />

          <Text size="sm">Session</Text>
          <ValueText>{formatSession(protocolEra, transport)}</ValueText>
        </SimpleGrid>
      </Stack>

      {discoverResult && (
        <Stack gap="xs">
          <SectionHeading>Discovery</SectionHeading>
          <SimpleGrid cols={2}>
            <Text size="sm">Supported versions</Text>
            <ValueText>
              {discoverResult.supportedVersions.length > 0
                ? discoverResult.supportedVersions.join(", ")
                : "—"}
            </ValueText>
          </SimpleGrid>
        </Stack>
      )}

      <SimpleGrid cols={2}>
        <Stack gap="xs">
          <SectionHeading>Server Capabilities</SectionHeading>
          {serverCaps.map((cap) => (
            <CapabilityItem
              key={cap.capability}
              capability={cap.capability}
              supported={cap.supported}
            />
          ))}
        </Stack>
        <Stack gap="xs">
          <SectionHeading>Client Capabilities</SectionHeading>
          {clientCaps.map((cap) => (
            <CapabilityItem
              key={cap.capability}
              capability={cap.capability}
              supported={cap.supported}
            />
          ))}
        </Stack>
      </SimpleGrid>

      {/* Extensions (SEP-2133) shown for both eras: the server's from its
          negotiated capabilities, the Inspector's from what it advertised
          (the Advertised Extensions setting). Mirrors the server/client
          capability columns above. (#1740) */}
      <SimpleGrid cols={2}>
        <Stack gap="xs">
          <SectionHeading>Server Extensions</SectionHeading>
          <ValueText>{formatExtensions(capabilities.extensions)}</ValueText>
        </Stack>
        <Stack gap="xs">
          <SectionHeading>Advertised Extensions</SectionHeading>
          <ValueText>
            {formatExtensions(clientCapabilities.extensions)}
          </ValueText>
        </Stack>
      </SimpleGrid>

      {instructions && (
        <Stack gap="xs">
          <SectionHeading>Server Instructions</SectionHeading>
          {/* Cap the instructions block so a long server prompt scrolls
              inside the section instead of pushing the OAuth section and
              modal chrome off-screen. */}
          <ScrollArea.Autosize mah={280}>
            <ContentViewer
              block={{ type: "text", text: instructions }}
              copyable
            />
          </ScrollArea.Autosize>
        </Stack>
      )}

      {oauth && (
        <Stack gap="xs">
          <SectionHeading>OAuth Details</SectionHeading>
          <Stack gap="xs">
            <SimpleGrid cols={2}>
              <Text size="sm">Protocol</Text>
              <ValueText>{formatProtocol(oauth.protocol)}</ValueText>

              <Text size="sm">Status</Text>
              <Badge
                variant="outline"
                color={oauth.authorized ? "green" : "gray"}
              >
                {oauth.authorized ? "Authorized" : "Not authorized"}
              </Badge>
            </SimpleGrid>
            {oauth.clientId && (
              <SimpleGrid cols={2}>
                <Text size="sm">Client ID</Text>
                <ValueCode>{oauth.clientId}</ValueCode>
              </SimpleGrid>
            )}
            {oauth.clientRegistrationKind && (
              <SimpleGrid cols={2}>
                <Text size="sm">Client registration</Text>
                <ValueText>
                  {formatClientRegistrationKind(oauth.clientRegistrationKind)}
                </ValueText>
              </SimpleGrid>
            )}
            {oauth.protocol === "ema" && oauth.idpSession && (
              <SimpleGrid cols={2}>
                <Text size="sm">IdP session</Text>
                <ValueText>{formatIdpSession(oauth.idpSession)}</ValueText>
              </SimpleGrid>
            )}
            {oauth.authUrl && (
              <SimpleGrid cols={2}>
                <Text size="sm">Auth URL</Text>
                <ValueCode>{oauth.authUrl}</ValueCode>
              </SimpleGrid>
            )}
            {oauth.scopes && oauth.scopes.length > 0 && (
              <SimpleGrid cols={2}>
                <Text size="sm">Scopes</Text>
                <ValueText>{formatScopes(oauth.scopes)}</ValueText>
              </SimpleGrid>
            )}
            {oauth.accessToken ? (
              <OAuthAccessTokenField
                accessToken={oauth.accessToken}
                onClear={onClearOAuth}
                clearLabel={CLEAR_OAUTH_STATE_AND_DISCONNECT_LABEL}
              />
            ) : (
              onClearOAuth && (
                <Flex justify="flex-end">
                  <Button
                    variant="subtle"
                    color="red"
                    size="compact-xs"
                    onClick={onClearOAuth}
                  >
                    {CLEAR_OAUTH_STATE_AND_DISCONNECT_LABEL}
                  </Button>
                </Flex>
              )
            )}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}
