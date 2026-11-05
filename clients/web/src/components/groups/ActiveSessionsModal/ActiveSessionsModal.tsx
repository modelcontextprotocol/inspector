import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { MdRefresh } from "react-icons/md";
import type { RemoteSessionSummary } from "@inspector/core/mcp/remote/index.js";
import { TransportBadge } from "../../elements/TransportBadge/TransportBadge";
import { useTickingClock } from "../../../hooks/useTickingClock";
import { sessionAge } from "../../../utils/sessionAge";

/**
 * Every MCP session the web backend holds (#2831), so a session whose tab
 * went away — and the stdio child behind it — can be found and terminated
 * without restarting the Inspector. Presentational: the list, the in-flight
 * state and both actions come from `useActiveSessions`.
 */
export interface ActiveSessionsModalProps {
  opened: boolean;
  sessions: RemoteSessionSummary[];
  /** `Date.now()` when `sessions` was fetched; ages are measured from it. */
  capturedAt: number;
  loading: boolean;
  error?: string;
  /** The session a terminate is in flight for. */
  terminatingId?: string;
  /** This tab's own backend session, flagged so it is not ended by mistake. */
  currentSessionId?: string;
  onRefresh: () => void;
  onTerminate: (sessionId: string) => void;
  onClose: () => void;
}

const SessionsModal = Modal.withProps({
  size: "xl",
  centered: true,
  title: "Active Sessions",
});

const HeaderRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
  align: "flex-start",
});

const HintText = Text.withProps({ size: "sm", c: "dimmed" });

const RefreshIcon = ActionIcon.withProps({
  variant: "subtle",
  size: 36,
  "aria-label": "Refresh sessions",
});

const SessionsTable = Table.withProps({
  striped: true,
  highlightOnHover: true,
  verticalSpacing: "xs",
});

const ServerNameText = Text.withProps({ size: "sm", fw: 600 });
const SessionIdText = Text.withProps({
  size: "xs",
  c: "dimmed",
  ff: "monospace",
});
const StatusBadges = Group.withProps({ gap: 4, wrap: "nowrap" });
const SmallBadge = Badge.withProps({ size: "sm", variant: "light" });

const TerminateButton = Button.withProps({
  size: "xs",
  color: "red",
  variant: "light",
});

function SessionStatus({
  session,
  current,
}: {
  session: RemoteSessionSummary;
  current: boolean;
}) {
  return (
    <StatusBadges>
      {current && <SmallBadge color="blue">This tab</SmallBadge>}
      {session.transportDead ? (
        <SmallBadge color="red">Closed</SmallBadge>
      ) : session.consumerAttached ? (
        <SmallBadge color="green">Attached</SmallBadge>
      ) : (
        <SmallBadge color="yellow">Detached</SmallBadge>
      )}
    </StatusBadges>
  );
}

export function ActiveSessionsModal({
  opened,
  sessions,
  capturedAt,
  loading,
  error,
  terminatingId,
  currentSessionId,
  onRefresh,
  onTerminate,
  onClose,
}: ActiveSessionsModalProps) {
  // Ages keep moving while the modal is open; a closed one runs no timer.
  const now = useTickingClock(capturedAt, 1000, opened);

  return (
    <SessionsModal opened={opened} onClose={onClose}>
      <Stack gap="md">
        <HeaderRow>
          <HintText>
            Sessions the Inspector backend holds open, across every tab.
            Terminating one closes its connection and ends a STDIO server
            process.
          </HintText>
          <Tooltip label="Refresh">
            <RefreshIcon onClick={onRefresh} loading={loading}>
              <MdRefresh size={20} />
            </RefreshIcon>
          </Tooltip>
        </HeaderRow>
        {error && (
          <Alert color="red" title="Session list">
            {error}
          </Alert>
        )}
        {sessions.length === 0 ? (
          <HintText>{loading ? "Loading…" : "No active sessions."}</HintText>
        ) : (
          <SessionsTable>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Server</Table.Th>
                <Table.Th>Transport</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Created</Table.Th>
                <Table.Th>Last consumer</Table.Th>
                <Table.Th>Queued</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sessions.map((session) => (
                <Table.Tr key={session.sessionId}>
                  <Table.Td>
                    <ServerNameText>
                      {session.serverName ?? "Unnamed server"}
                    </ServerNameText>
                    <SessionIdText>{session.sessionId}</SessionIdText>
                  </Table.Td>
                  <Table.Td>
                    <TransportBadge transport={session.transport} />
                  </Table.Td>
                  <Table.Td>
                    <SessionStatus
                      session={session}
                      current={session.sessionId === currentSessionId}
                    />
                  </Table.Td>
                  <Table.Td>{sessionAge(session.createdAt, now)}</Table.Td>
                  <Table.Td>
                    {session.consumerAttached
                      ? "now"
                      : sessionAge(session.lastConsumerSeenAt, now)}
                  </Table.Td>
                  <Table.Td>{session.queuedEvents}</Table.Td>
                  <Table.Td>
                    <TerminateButton
                      aria-label={`Terminate session ${session.sessionId}`}
                      loading={terminatingId === session.sessionId}
                      disabled={
                        terminatingId !== undefined &&
                        terminatingId !== session.sessionId
                      }
                      onClick={() => onTerminate(session.sessionId)}
                    >
                      Terminate
                    </TerminateButton>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </SessionsTable>
        )}
      </Stack>
    </SessionsModal>
  );
}
