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

export const levelColors: Record<string, string> = {
  debug: 'gray',
  info: 'blue',
  notice: 'cyan',
  warning: 'yellow',
  error: 'red',
  critical: 'red',
  alert: 'red',
  emergency: 'red',
};
