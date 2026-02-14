import pino from "pino";
/**
 * Silent logger for use when no logger is injected. Satisfies pino.Logger,
 * does not output anything. InspectorClient uses this as the default.
 */
export const silentLogger = pino({ level: "silent" });
//# sourceMappingURL=logger.js.map