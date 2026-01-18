/**
 * Log types for MCP protocol event logging
 *
 * Supports RFC 5424 log levels and request correlation
 * for filtering logs by request chain.
 */

/**
 * RFC 5424 log levels in order of severity
 */
export const LOG_LEVELS = [
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
  'alert',
  'emergency',
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Color mapping for log levels (Mantine color names)
 */
export const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'gray',
  info: 'blue',
  notice: 'cyan',
  warning: 'yellow',
  error: 'red',
  critical: 'red',
  alert: 'red',
  emergency: 'red',
};

/**
 * Logger categories for grouping logs
 */
export type LoggerCategory = 'connection' | 'protocol' | 'tools' | 'resources' | 'prompts' | 'sampling' | 'elicitation';

/**
 * A single log entry
 */
export interface LogEntry {
  /** ISO timestamp of when the log was created */
  timestamp: string;
  /** Log level (RFC 5424) */
  level: LogLevel;
  /** Log message */
  message: string;
  /** Logger category */
  logger: string;
  /** The request ID that generated this log (for correlation) */
  requestId?: string;
  /** For logs from client requests, links to parent request */
  parentRequestId?: string;
}

/**
 * Create a new log entry with automatic timestamp
 */
export function createLogEntry(
  level: LogLevel,
  message: string,
  logger: string,
  requestId?: string,
  parentRequestId?: string
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    logger,
    requestId,
    parentRequestId,
  };
}

/**
 * Maximum number of log entries to keep
 */
export const MAX_LOG_ENTRIES = 1000;
