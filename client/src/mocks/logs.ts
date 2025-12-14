// Mock log entries and configuration
export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  logger: string;
}

export const mockLogs: LogEntry[] = [
  { timestamp: '2025-11-30T14:23:01Z', level: 'info', message: 'Server connected', logger: 'connection' },
  { timestamp: '2025-11-30T14:23:05Z', level: 'debug', message: 'Sending tools/list request', logger: 'protocol' },
  { timestamp: '2025-11-30T14:23:05Z', level: 'debug', message: 'Received tools/list response: 4 tools', logger: 'protocol' },
  { timestamp: '2025-11-30T14:24:12Z', level: 'info', message: 'Tool echo executed successfully', logger: 'tools' },
  { timestamp: '2025-11-30T14:25:30Z', level: 'warning', message: 'Request timeout approaching', logger: 'connection' },
  { timestamp: '2025-11-30T14:26:00Z', level: 'error', message: 'Failed to fetch resource: 404', logger: 'resources' },
];

export const logLevels = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];

// RFC 5424 log levels with distinct colors per v2_ux.md spec
export const levelColors: Record<string, string> = {
  debug: 'text-gray-400',           // Gray - Normal
  info: 'text-blue-400',            // Blue - Normal
  notice: 'text-cyan-400',          // Cyan - Normal
  warning: 'text-yellow-400',       // Yellow - Normal
  error: 'text-red-400',            // Red - Normal
  critical: 'text-red-500 font-bold', // Red - Bold
  alert: 'text-fuchsia-500 font-bold', // Magenta - Bold
  emergency: 'bg-red-600 text-white px-1 rounded', // White on Red - Background
};

export const levelVariants: Record<string, 'default' | 'secondary' | 'warning' | 'error'> = {
  debug: 'secondary',
  info: 'default',
  notice: 'default',
  warning: 'warning',
  error: 'error',
  critical: 'error',
  alert: 'error',
  emergency: 'error',
};
