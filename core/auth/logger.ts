import pino from "pino";

/**
 * Logger type for InspectorClient. Both sides use pino.Logger directly.
 * @deprecated Use pino.Logger directly; kept for backward compatibility.
 */
export type InspectorClientLogger = pino.Logger;

/**
 * Silent logger for use when no logger is injected. Satisfies pino.Logger,
 * does not output anything. InspectorClient uses this as the default.
 */
export const silentLogger = pino({ level: "silent" });
