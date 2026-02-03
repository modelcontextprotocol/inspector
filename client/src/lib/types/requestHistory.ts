export interface RequestHistoryEntry {
  request: string;
  response?: string;
  requestedAt: string; // ISO timestamp when request was sent
  respondedAt?: string; // ISO timestamp when response received
  durationMs?: number; // Calculated duration in ms
}
