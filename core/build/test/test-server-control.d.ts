/**
 * Test-only server control for orderly shutdown.
 * HTTP test server sets this when starting and clears it when stopping.
 * Progress-sending tools check isClosing() before sending and skip/break if closing.
 */
export interface ServerControl {
    isClosing(): boolean;
}
export declare function setTestServerControl(c: ServerControl | null): void;
export declare function getTestServerControl(): ServerControl | null;
//# sourceMappingURL=test-server-control.d.ts.map