export type ClientLogLevels = "info" | "error" | "warn" | "debug";

export type RequestHistoryInfo = {
  request: string;
  response?: string;
  timestamp: string;
  latency?: number;
};

export type ClientLogInfo = {
  message: string;
  level: ClientLogLevels;
  timestamp: string;
};
