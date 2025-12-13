import { notifications } from '@mantine/notifications';
import { Anchor, Group, Text } from '@mantine/core';
import { IconExternalLink, IconCheck, IconX, IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react';

// Map error types to MCP documentation URLs (UI-18)
const errorDocLinks: Record<string, string> = {
  // Connection errors
  connection_failed: 'https://modelcontextprotocol.io/docs/troubleshooting#connection-issues',
  connection_timeout: 'https://modelcontextprotocol.io/docs/troubleshooting#timeouts',
  connection_refused: 'https://modelcontextprotocol.io/docs/troubleshooting#connection-refused',

  // Protocol errors
  protocol_error: 'https://modelcontextprotocol.io/docs/troubleshooting#protocol-errors',
  invalid_request: 'https://modelcontextprotocol.io/docs/spec/basic/messages#error-handling',
  method_not_found: 'https://modelcontextprotocol.io/docs/spec/basic/lifecycle#capability-negotiation',
  invalid_params: 'https://modelcontextprotocol.io/docs/spec/basic/messages#request-parameters',

  // Resource errors
  resource_not_found: 'https://modelcontextprotocol.io/docs/spec/server/resources#reading-resources',
  resource_access_denied: 'https://modelcontextprotocol.io/docs/spec/server/resources#resource-permissions',

  // Tool errors
  tool_not_found: 'https://modelcontextprotocol.io/docs/spec/server/tools#tool-discovery',
  tool_execution_failed: 'https://modelcontextprotocol.io/docs/spec/server/tools#tool-errors',

  // Auth errors
  auth_required: 'https://modelcontextprotocol.io/docs/spec/basic/transports/streamable-http#authentication',
  oauth_error: 'https://modelcontextprotocol.io/docs/spec/basic/authorization',
  token_expired: 'https://modelcontextprotocol.io/docs/spec/basic/authorization#token-refresh',

  // General
  unknown: 'https://modelcontextprotocol.io/docs/troubleshooting',
};

export type ErrorType = keyof typeof errorDocLinks;

interface ToastErrorOptions {
  errorType?: ErrorType;
  description?: string;
  autoClose?: number;
}

/**
 * Show an error toast with optional documentation link (UI-17, UI-18)
 */
export function showErrorToast(
  message: string,
  options: ToastErrorOptions = {}
) {
  const { errorType = 'unknown', description, autoClose = 5000 } = options;
  const docUrl = errorDocLinks[errorType] || errorDocLinks.unknown;

  notifications.show({
    title: message,
    message: (
      <>
        {description && <Text size="sm">{description}</Text>}
        <Anchor
          href={docUrl}
          target="_blank"
          rel="noopener noreferrer"
          size="xs"
          mt={description ? 'xs' : undefined}
        >
          <Group gap={4}>
            View Documentation
            <IconExternalLink size={12} />
          </Group>
        </Anchor>
      </>
    ),
    color: 'red',
    icon: <IconX size={16} />,
    autoClose,
  });
}

/**
 * Show a success toast (UI-17)
 */
export function showSuccessToast(message: string, description?: string) {
  notifications.show({
    title: message,
    message: description,
    color: 'green',
    icon: <IconCheck size={16} />,
  });
}

/**
 * Show an info toast (UI-17)
 */
export function showInfoToast(message: string, description?: string) {
  notifications.show({
    title: message,
    message: description,
    color: 'blue',
    icon: <IconInfoCircle size={16} />,
  });
}

/**
 * Show a warning toast (UI-17)
 */
export function showWarningToast(message: string, description?: string) {
  notifications.show({
    title: message,
    message: description,
    color: 'yellow',
    icon: <IconAlertTriangle size={16} />,
  });
}

// Re-export notifications for custom usage
export { notifications };
