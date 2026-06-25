import {
  Badge,
  Code,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type {
  ClientCapabilities,
  InitializeResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { ServerType } from "@inspector/core/mcp/types.js";
import {
  CapabilityItem,
  type CapabilityKey,
} from "../../elements/CapabilityItem/CapabilityItem";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { OAuthAccessTokenField } from "./OAuthAccessTokenField";

export interface OAuthDetails {
  protocol: "standard" | "ema";
  authorized: boolean;
  clientId?: string;
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
  oauth?: OAuthDetails;
}

const ValueText = Text.withProps({
  size: "sm",
  fw: 600,
});

const SectionHeading = Title.withProps({
  order: 5,
  variant: "section",
});

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
  oauth,
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
        </SimpleGrid>
      </Stack>

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
                <Code>{oauth.clientId}</Code>
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
                <Code>{oauth.authUrl}</Code>
              </SimpleGrid>
            )}
            {oauth.scopes && oauth.scopes.length > 0 && (
              <SimpleGrid cols={2}>
                <Text size="sm">Scopes</Text>
                <ValueText>{formatScopes(oauth.scopes)}</ValueText>
              </SimpleGrid>
            )}
            {oauth.accessToken && (
              <OAuthAccessTokenField accessToken={oauth.accessToken} />
            )}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}
