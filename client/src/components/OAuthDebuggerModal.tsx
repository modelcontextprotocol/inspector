import { useState } from 'react';
import {
  IconCopy,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconRefresh,
  IconCircleX,
  IconExternalLink,
} from '@tabler/icons-react';
import {
  Modal,
  Button,
  Badge,
  Stack,
  Group,
  Text,
  Code,
  Paper,
  ActionIcon,
  Divider,
  Collapse,
  UnstyledButton,
  Box,
  SimpleGrid,
  CopyButton as MantineCopyButton,
} from '@mantine/core';
import { mockOAuthState } from '@/mocks';
import type { OAuthState } from '@modelcontextprotocol/inspector-core';

type StepStatus = 'pending' | 'completed' | 'active' | 'error';

interface OAuthStep {
  title: string;
  status: StepStatus;
  content?: string;
  details?: Record<string, string>;
}

interface OAuthDebuggerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverName: string;
  oauthState?: OAuthState;
  onRefreshToken?: () => void;
  onRevokeToken?: () => void;
  onStartNewFlow?: () => void;
}

const statusColors: Record<StepStatus, string> = {
  pending: 'gray',
  completed: 'green',
  active: 'blue',
  error: 'red',
};

const statusLabels: Record<StepStatus, string> = {
  pending: 'Pending',
  completed: 'Completed',
  active: 'Active',
  error: 'Error',
};

function StepCard({
  step,
  index,
  expanded,
  onToggle,
  children,
}: {
  step: OAuthStep;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Paper withBorder radius="md">
      <UnstyledButton
        onClick={onToggle}
        style={{ width: '100%' }}
        p="sm"
      >
        <Group justify="space-between">
          <Group gap="sm">
            {expanded ? (
              <IconChevronDown size={16} />
            ) : (
              <IconChevronRight size={16} />
            )}
            <Text fw={500} size="sm">Step {index + 1}: {step.title}</Text>
          </Group>
          <Badge color={statusColors[step.status]} variant="light">
            {statusLabels[step.status]}
          </Badge>
        </Group>
      </UnstyledButton>
      <Collapse in={expanded}>
        <Box p="sm" pt={0} style={{ borderTop: '1px solid var(--mantine-color-dark-4)' }}>
          {children}
        </Box>
      </Collapse>
    </Paper>
  );
}

function CopyButton({ text }: { text: string }) {
  return (
    <MantineCopyButton value={text}>
      {({ copied, copy }) => (
        <ActionIcon variant="subtle" onClick={copy} size="sm">
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        </ActionIcon>
      )}
    </MantineCopyButton>
  );
}

function CodeBlock({ children, copyable }: { children: string; copyable?: boolean }) {
  return (
    <Box pos="relative">
      <Code
        block
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          fontSize: '0.75rem',
        }}
      >
        {children}
      </Code>
      {copyable && (
        <Box pos="absolute" top={4} right={4}>
          <CopyButton text={children} />
        </Box>
      )}
    </Box>
  );
}

export function OAuthDebuggerModal({
  open,
  onOpenChange,
  serverName,
  oauthState = mockOAuthState,
  onRefreshToken,
  onRevokeToken,
  onStartNewFlow,
}: OAuthDebuggerModalProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set([0, 1, 2, 3]));

  const toggleStep = (index: number) => {
    const newExpanded = new Set(expandedSteps);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedSteps(newExpanded);
  };

  const steps: OAuthStep[] = [
    {
      title: 'Authorization Request',
      status: oauthState.authorizationUrl ? 'completed' : 'pending',
    },
    {
      title: 'Authorization Code',
      status: oauthState.authorizationCode ? 'completed' : 'pending',
    },
    {
      title: 'Token Exchange',
      status: oauthState.accessToken ? 'completed' : 'pending',
    },
    {
      title: 'Access Token',
      status: oauthState.accessToken ? 'active' : 'pending',
    },
  ];

  const formatExpiration = () => {
    if (!oauthState.expiresAt) return 'Unknown';
    const now = new Date();
    const diff = oauthState.expiresAt.getTime() - now.getTime();
    if (diff <= 0) return 'Expired';
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}m ${seconds}s remaining`;
  };

  return (
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      title={`OAuth Debugger: ${serverName}`}
      size="lg"
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">OAuth Flow Status</Text>

        {/* Step 1: Authorization Request */}
        <StepCard
          step={steps[0]}
          index={0}
          expanded={expandedSteps.has(0)}
          onToggle={() => toggleStep(0)}
        >
          {oauthState.authorizationUrl ? (
            <Stack gap="xs" mt="xs">
              <Text size="xs" c="dimmed">Authorization URL:</Text>
              <CodeBlock copyable>
                {oauthState.authorizationUrl}
              </CodeBlock>
              <Group justify="flex-end">
                <Button
                  variant="outline"
                  size="xs"
                  component="a"
                  href={oauthState.authorizationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  rightSection={<IconExternalLink size={12} />}
                >
                  Open URL
                </Button>
              </Group>
            </Stack>
          ) : (
            <Text size="sm" c="dimmed" mt="xs">
              No authorization request initiated yet.
            </Text>
          )}
        </StepCard>

        {/* Step 2: Authorization Code */}
        <StepCard
          step={steps[1]}
          index={1}
          expanded={expandedSteps.has(1)}
          onToggle={() => toggleStep(1)}
        >
          {oauthState.authorizationCode ? (
            <SimpleGrid cols={2} mt="xs">
              <div>
                <Text size="sm" c="dimmed" component="span">code: </Text>
                <Code>{oauthState.authorizationCode.slice(0, 20)}...</Code>
              </div>
              <div>
                <Text size="sm" c="dimmed" component="span">state: </Text>
                <Code>{oauthState.state}</Code>
                {oauthState.stateVerified && (
                  <Badge variant="outline" size="xs" ml="xs">verified</Badge>
                )}
              </div>
            </SimpleGrid>
          ) : (
            <Text size="sm" c="dimmed" mt="xs">
              Waiting for authorization code...
            </Text>
          )}
        </StepCard>

        {/* Step 3: Token Exchange */}
        <StepCard
          step={steps[2]}
          index={2}
          expanded={expandedSteps.has(2)}
          onToggle={() => toggleStep(2)}
        >
          {oauthState.tokenEndpoint ? (
            <Stack gap="xs" mt="xs">
              <Text size="xs" c="dimmed">Token Endpoint:</Text>
              <CodeBlock>
                {`POST ${oauthState.tokenEndpoint}\ngrant_type=authorization_code&code=${oauthState.authorizationCode?.slice(0, 10) || ''}...`}
              </CodeBlock>
            </Stack>
          ) : (
            <Text size="sm" c="dimmed" mt="xs">
              Token exchange not performed yet.
            </Text>
          )}
        </StepCard>

        {/* Step 4: Access Token */}
        <StepCard
          step={steps[3]}
          index={3}
          expanded={expandedSteps.has(3)}
          onToggle={() => toggleStep(3)}
        >
          {oauthState.accessToken ? (
            <Stack gap="sm" mt="xs">
              <div>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">access_token:</Text>
                  <CopyButton text={oauthState.accessToken} />
                </Group>
                <Code block style={{ fontSize: '0.75rem' }}>
                  {oauthState.accessToken.slice(0, 50)}...
                </Code>
              </div>
              <SimpleGrid cols={2}>
                <div>
                  <Text size="sm" c="dimmed" component="span">token_type: </Text>
                  <Text size="sm" component="span">{oauthState.tokenType}</Text>
                </div>
                <div>
                  <Text size="sm" c="dimmed" component="span">expires_in: </Text>
                  <Text size="sm" component="span">{oauthState.expiresIn}s</Text>
                  <Text size="xs" c="dimmed" ml="xs" component="span">({formatExpiration()})</Text>
                </div>
              </SimpleGrid>
              {oauthState.scopes && (
                <div>
                  <Text size="sm" c="dimmed" component="span">scope: </Text>
                  {oauthState.scopes.map((scope) => (
                    <Badge key={scope} variant="light" size="xs" mr="xs">
                      {scope}
                    </Badge>
                  ))}
                </div>
              )}
            </Stack>
          ) : (
            <Text size="sm" c="dimmed" mt="xs">
              No access token received yet.
            </Text>
          )}
        </StepCard>

        {/* Refresh Token Section */}
        {oauthState.refreshToken && (
          <Paper withBorder p="sm" radius="md">
            <Group justify="space-between" mb="xs">
              <Text fw={500} size="sm">Refresh Token</Text>
              <Button
                variant="outline"
                size="xs"
                onClick={onRefreshToken}
                leftSection={<IconRefresh size={14} />}
              >
                Test Refresh Now
              </Button>
            </Group>
            <Group gap="xs">
              <Code style={{ flex: 1, fontSize: '0.75rem' }}>
                {oauthState.refreshToken.slice(0, 30)}...
              </Code>
              <CopyButton text={oauthState.refreshToken} />
            </Group>
          </Paper>
        )}

        <Divider />

        {/* Decoded JWT */}
        {oauthState.decodedToken && (
          <Stack gap="sm">
            <Text fw={500} size="sm">Decoded Access Token (JWT)</Text>
            <div>
              <Text size="xs" c="dimmed" mb="xs">Header:</Text>
              <CodeBlock copyable>
                {JSON.stringify(oauthState.decodedToken.header, null, 2)}
              </CodeBlock>
            </div>
            <div>
              <Text size="xs" c="dimmed" mb="xs">Payload:</Text>
              <CodeBlock copyable>
                {JSON.stringify(oauthState.decodedToken.payload, null, 2)}
              </CodeBlock>
            </div>
          </Stack>
        )}

        {/* Footer */}
        <Group justify="space-between" mt="md">
          <Group gap="xs">
            <Button
              variant="outline"
              color="red"
              onClick={onRevokeToken}
              leftSection={<IconCircleX size={16} />}
            >
              Revoke Token
            </Button>
            <Button variant="outline" onClick={onStartNewFlow}>
              Start New Flow
            </Button>
          </Group>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
