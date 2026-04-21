import {
  Badge,
  Blockquote,
  Code,
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

export interface OAuthDetails {
  authUrl?: string;
  scopes?: string[];
  accessToken?: string;
}

export interface ServerInfoContentProps {
  initializeResult: InitializeResult;
  clientCapabilities: ClientCapabilities;
  transport: ServerType;
  oauth?: OAuthDetails;
}

const ValueText = Text.withProps({
  size: "sm",
  fw: 600,
});

function formatScopes(scopes: string[]): string {
  return scopes.join(", ");
}

function getCapabilityEntries(
  capabilities: Record<string, unknown>,
): { capability: CapabilityKey; supported: boolean }[] {
  return Object.entries(capabilities).map(([key, value]) => ({
    capability: key as CapabilityKey,
    supported: value != null,
  }));
}

export function ServerInfoContent({
  initializeResult,
  clientCapabilities,
  transport,
  oauth,
}: ServerInfoContentProps) {
  const { serverInfo, protocolVersion, capabilities, instructions } =
    initializeResult;

  const serverCaps = getCapabilityEntries(capabilities);
  const clientCaps = getCapabilityEntries(clientCapabilities);

  return (
    <Stack gap="md">
      <Title order={3}>Server Information</Title>

      <SimpleGrid cols={2}>
        <Text size="sm">Name</Text>
        <ValueText>{serverInfo.name}</ValueText>

        <Text size="sm">Version</Text>
        <ValueText>{serverInfo.version}</ValueText>

        <Text size="sm">Protocol</Text>
        <ValueText>{protocolVersion}</ValueText>

        <Text size="sm">Transport</Text>
        <Badge variant="outline">{transport}</Badge>
      </SimpleGrid>

      <SimpleGrid cols={2}>
        <Stack gap="xs">
          <Title order={5}>Server Capabilities</Title>
          {serverCaps.map((cap) => (
            <CapabilityItem
              key={cap.capability}
              capability={cap.capability}
              supported={cap.supported}
            />
          ))}
        </Stack>
        <Stack gap="xs">
          <Title order={5}>Client Capabilities</Title>
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
          <Title order={5}>Server Instructions</Title>
          <Blockquote>{instructions}</Blockquote>
        </Stack>
      )}

      {oauth && (
        <Stack gap="xs">
          <Title order={5}>OAuth Details</Title>
          <Stack gap="xs">
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
              <SimpleGrid cols={2}>
                <Text size="sm">Access Token</Text>
                <Code>{oauth.accessToken}</Code>
              </SimpleGrid>
            )}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}
