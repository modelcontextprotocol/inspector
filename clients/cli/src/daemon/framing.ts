import type { DaemonRequest, DaemonResponse } from "./protocol.js";

/**
 * Parse one NDJSON line into a daemon request. Returns null for blank lines.
 */
export function parseRequestLine(line: string): DaemonRequest | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const value: unknown = JSON.parse(trimmed);
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as DaemonRequest).id !== "string" ||
    typeof (value as DaemonRequest).op !== "string"
  ) {
    throw new Error("Invalid daemon request: expected { id, op, params? }");
  }
  return value as DaemonRequest;
}

export function encodeResponse(response: DaemonResponse): string {
  return JSON.stringify(response) + "\n";
}

export function encodeRequest(request: DaemonRequest): string {
  return JSON.stringify(request) + "\n";
}
