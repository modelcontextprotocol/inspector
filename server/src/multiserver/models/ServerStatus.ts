// Server status and connection state models
export interface ServerStatus {
  id: string;
  status: "disconnected" | "connecting" | "connected" | "error";
  lastConnected?: Date;
  lastError?: string;
  sessionId?: string;
}
