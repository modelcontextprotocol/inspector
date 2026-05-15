/**
 * Test-only server control for orderly shutdown.
 * HTTP test server sets this when starting and clears it when stopping.
 * Progress-sending tools check isClosing() before sending and skip/break if closing.
 */

export interface ServerControl {
  isClosing(): boolean;
}

let current: ServerControl | null = null;

export function setTestServerControl(c: ServerControl | null): void {
  current = c;
}

export function getTestServerControl(): ServerControl | null {
  return current;
}
