import { useState } from 'react';
import { Stack, Group, Text, Button, Alert, ScrollArea } from '@mantine/core';
import { IconAlertCircle, IconX } from '@tabler/icons-react';
import type { PendingClientRequest } from '@/context/ExecutionContext';
import type {
  SamplingRequest,
  ElicitationRequest,
  TestingProfile,
} from '@modelcontextprotocol/inspector-core';
import { SamplingRequestCard, type SamplingResponse } from './SamplingRequestCard';
import { ElicitationRequestCard } from './ElicitationRequestCard';
import { SamplingModal } from './SamplingModal';

interface PendingClientRequestsPanelProps {
  requests: PendingClientRequest[];
  activeProfile: TestingProfile | undefined;
  profiles: TestingProfile[];
  onProfileChange: (profileId: string) => void;
  onResolveSampling: (requestId: string, response: SamplingResponse) => void;
  onResolveElicitation: (requestId: string, data: Record<string, unknown>) => void;
  onReject: (requestId: string) => void;
  onCancelTool: () => void;
}

export function PendingClientRequestsPanel({
  requests,
  activeProfile,
  profiles,
  onProfileChange,
  onResolveSampling,
  onResolveElicitation,
  onReject,
  onCancelTool,
}: PendingClientRequestsPanelProps) {
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);

  // Get pending requests only (not completed/rejected)
  const pendingRequests = requests.filter((r) => r.status === 'pending');
  const currentRequest = pendingRequests[0];
  const currentIndex = currentRequest
    ? requests.findIndex((r) => r.id === currentRequest.id) + 1
    : 0;

  if (!currentRequest) {
    return null;
  }

  const position = { current: currentIndex, total: requests.length };

  return (
    <Stack gap="md" p="md" h="100%">
      {/* Header */}
      <Alert
        icon={<IconAlertCircle size={18} />}
        color="yellow"
        title={`Pending Client Requests (${pendingRequests.length})`}
        p="sm"
      >
        <Text size="xs">
          Tool execution is waiting for your response to continue.
        </Text>
      </Alert>

      {/* Current Request */}
      <ScrollArea flex={1} offsetScrollbars>
        {currentRequest.type === 'sampling' ? (
          <SamplingRequestCard
            request={currentRequest.request as SamplingRequest}
            requestId={currentRequest.id}
            position={position}
            activeProfile={activeProfile}
            profiles={profiles}
            onProfileChange={onProfileChange}
            onAutoRespond={(response) =>
              onResolveSampling(currentRequest.id, response)
            }
            onEditAndSend={(response) =>
              onResolveSampling(currentRequest.id, response)
            }
            onReject={() => onReject(currentRequest.id)}
            onViewDetails={() => setDetailsModalOpen(true)}
          />
        ) : (
          <ElicitationRequestCard
            request={currentRequest.request as ElicitationRequest}
            requestId={currentRequest.id}
            position={position}
            onSubmit={(data) =>
              onResolveElicitation(currentRequest.id, data)
            }
            onCancel={() => onReject(currentRequest.id)}
          />
        )}
      </ScrollArea>

      {/* Cancel Tool Button */}
      <Group justify="center">
        <Button
          variant="outline"
          color="red"
          size="sm"
          leftSection={<IconX size={16} />}
          onClick={onCancelTool}
        >
          Cancel Tool Execution
        </Button>
      </Group>

      {/* Details Modal for Sampling */}
      <SamplingModal
        open={detailsModalOpen}
        onOpenChange={setDetailsModalOpen}
      />
    </Stack>
  );
}
