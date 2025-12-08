import { toast } from 'sonner';
import { ExternalLink } from 'lucide-react';

// Map error types to MCP documentation URLs
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
  duration?: number;
}

/**
 * Show an error toast with optional documentation link
 */
export function showErrorToast(
  message: string,
  options: ToastErrorOptions = {}
) {
  const { errorType = 'unknown', description, duration = 5000 } = options;
  const docUrl = errorDocLinks[errorType] || errorDocLinks.unknown;

  toast.error(message, {
    description: description ? (
      <div className="space-y-2">
        <p>{description}</p>
        <a
          href={docUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 underline"
        >
          View Documentation
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    ) : (
      <a
        href={docUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 underline"
      >
        View Documentation
        <ExternalLink className="h-3 w-3" />
      </a>
    ),
    duration,
  });
}

/**
 * Show a success toast
 */
export function showSuccessToast(message: string, description?: string) {
  toast.success(message, { description });
}

/**
 * Show an info toast
 */
export function showInfoToast(message: string, description?: string) {
  toast.info(message, { description });
}

/**
 * Show a warning toast
 */
export function showWarningToast(message: string, description?: string) {
  toast.warning(message, { description });
}

// Re-export toast for custom usage
export { toast };
