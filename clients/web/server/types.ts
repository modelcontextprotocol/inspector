/**
 * Shared types for the in-process web server runners (`server.ts` and
 * `start-vite-dev-server.ts`). Both expose the same start/close lifecycle
 * so the future v2 launcher (#1246) can treat them interchangeably.
 */

export interface WebServerHandle {
  close(): Promise<void>;
}
