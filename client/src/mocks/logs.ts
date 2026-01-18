/**
 * Mock log data for testing
 */

import type { LogEntry } from '@/types/logs';

export const mockLogs: LogEntry[] = [
  { timestamp: '2025-11-30T14:23:01Z', level: 'info', message: 'Server connected', logger: 'connection' },
  { timestamp: '2025-11-30T14:23:05Z', level: 'debug', message: 'Sending tools/list request', logger: 'protocol', requestId: 'req-2' },
  { timestamp: '2025-11-30T14:23:05Z', level: 'debug', message: 'Received tools/list response: 4 tools', logger: 'protocol', requestId: 'req-2' },
  { timestamp: '2025-11-30T14:24:12Z', level: 'info', message: 'Tool echo executed successfully', logger: 'tools', requestId: 'req-1' },
  // Logs for hierarchical request (analyze_data with sampling/elicitation)
  { timestamp: '2025-11-30T14:25:00Z', level: 'info', message: 'Executing tool: analyze_data', logger: 'tools', requestId: 'req-0' },
  { timestamp: '2025-11-30T14:25:00.012Z', level: 'debug', message: 'Server requested sampling/createMessage', logger: 'protocol', requestId: 'req-0-sampling-1', parentRequestId: 'req-0' },
  { timestamp: '2025-11-30T14:25:00.212Z', level: 'debug', message: 'Sampling response sent', logger: 'protocol', requestId: 'req-0-sampling-1', parentRequestId: 'req-0' },
  { timestamp: '2025-11-30T14:25:00.250Z', level: 'debug', message: 'Server requested elicitation/create (form)', logger: 'protocol', requestId: 'req-0-elicit-1', parentRequestId: 'req-0' },
  { timestamp: '2025-11-30T14:25:01.750Z', level: 'debug', message: 'Elicitation form submitted', logger: 'protocol', requestId: 'req-0-elicit-1', parentRequestId: 'req-0' },
  { timestamp: '2025-11-30T14:25:02.500Z', level: 'info', message: 'Tool analyze_data completed successfully', logger: 'tools', requestId: 'req-0' },
  { timestamp: '2025-11-30T14:25:30Z', level: 'warning', message: 'Request timeout approaching', logger: 'connection' },
  { timestamp: '2025-11-30T14:26:00Z', level: 'error', message: 'Failed to fetch resource: 404', logger: 'resources' },
];
