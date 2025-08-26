// Unique ID generation utility
import { randomBytes } from "node:crypto";

/**
 * Generates a unique server ID using crypto.randomBytes
 * Format: server_<timestamp>_<random>
 */
export function generateServerId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = randomBytes(6).toString("hex");
  return `server_${timestamp}_${randomPart}`;
}

/**
 * Generates a unique session ID for server connections
 * Format: session_<timestamp>_<random>
 */
export function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = randomBytes(8).toString("hex");
  return `session_${timestamp}_${randomPart}`;
}

/**
 * Validates if a string is a valid server ID format
 */
export function isValidServerId(id: string): boolean {
  return /^server_[a-z0-9]+_[a-f0-9]{12}$/.test(id);
}

/**
 * Validates if a string is a valid session ID format
 */
export function isValidSessionId(id: string): boolean {
  return /^session_[a-z0-9]+_[a-f0-9]{16}$/.test(id);
}
