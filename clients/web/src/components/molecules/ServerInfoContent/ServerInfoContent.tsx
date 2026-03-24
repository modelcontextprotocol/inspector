import {
  Badge,
  Blockquote,
  Code,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { CapabilityItem } from "../../atoms/CapabilityItem/CapabilityItem";

export interface CapabilityInfo {
  name: string;
  supported: boolean;
  count?: number;
}

export interface ServerInfoContentProps {
  name: string;
  version: string;
  protocolVersion: string;
  transport: string;
  serverCapabilities: CapabilityInfo[];
  clientCapabilities: CapabilityInfo[];
  instructions?: string;
  oauthDetails?: { authUrl?: string; scopes?: string[]; accessToken?: string };
}

const ValueText = Text.withProps({
  size: "sm",
  fw: 600,
});

function formatScopes(scopes: string[]): string {
  return scopes.join(", ");
}

export function ServerInfoContent({
  name,
  version,
  protocolVersion,
  transport,
  serverCapabilities,
  clientCapabilities,
  instructions,
  oauthDetails,
}: ServerInfoContentProps) {
  return (
    <Stack gap="md">
      <Title order={3}>Server Information</Title>

      <SimpleGrid cols={2}>
        <Text size="sm">Name</Text>
        <ValueText>{name}</ValueText>

        <Text size="sm">Version</Text>
        <ValueText>{version}</ValueText>

        <Text size="sm">Protocol</Text>
        <ValueText>{protocolVersion}</ValueText>

        <Text size="sm">Transport</Text>
        <Badge variant="outline">{transport}</Badge>
      </SimpleGrid>

      <SimpleGrid cols={2}>
        <Stack gap="xs">
          <Title order={5}>Server Capabilities</Title>
          {serverCapabilities.map((cap) => (
            <CapabilityItem
              key={cap.name}
              name={cap.name}
              supported={cap.supported}
              count={cap.count}
            />
          ))}
        </Stack>
        <Stack gap="xs">
          <Title order={5}>Client Capabilities</Title>
          {clientCapabilities.map((cap) => (
            <CapabilityItem
              key={cap.name}
              name={cap.name}
              supported={cap.supported}
              count={cap.count}
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

      {oauthDetails && (
        <Stack gap="xs">
          <Title order={5}>OAuth Details</Title>
          <Stack gap="xs">
            {oauthDetails.authUrl && (
              <SimpleGrid cols={2}>
                <Text size="sm">Auth URL</Text>
                <Code>{oauthDetails.authUrl}</Code>
              </SimpleGrid>
            )}
            {oauthDetails.scopes && oauthDetails.scopes.length > 0 && (
              <SimpleGrid cols={2}>
                <Text size="sm">Scopes</Text>
                <ValueText>{formatScopes(oauthDetails.scopes)}</ValueText>
              </SimpleGrid>
            )}
            {oauthDetails.accessToken && (
              <SimpleGrid cols={2}>
                <Text size="sm">Access Token</Text>
                <Code>{oauthDetails.accessToken}</Code>
              </SimpleGrid>
            )}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}
