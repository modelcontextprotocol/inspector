/**
 * Test-only server control for orderly shutdown.
 * HTTP test server sets this when starting and clears it when stopping.
 * Progress-sending tools check isClosing() before sending and skip/break if closing.
 */
let current = null;
export function setTestServerControl(c) {
    current = c;
}
export function getTestServerControl() {
    return current;
}
//# sourceMappingURL=test-server-control.js.map