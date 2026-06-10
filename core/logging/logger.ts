import type { Bindings, LevelWithSilentOrString, LogFn } from "pino";

/**
 * Logging surface InspectorClient uses. Real pino loggers satisfy this;
 * the default silent logger implements it without opening a stream.
 */
export interface InspectorLogger {
  level: LevelWithSilentOrString;
  fatal: LogFn;
  error: LogFn;
  warn: LogFn;
  info: LogFn;
  debug: LogFn;
  trace: LogFn;
  silent: LogFn;
  child(bindings?: Bindings): InspectorLogger;
}

const noop: LogFn = () => {};

function createSilentLogger(): InspectorLogger {
  const logger: InspectorLogger = {
    level: "silent",
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    silent: noop,
    child: () => logger,
  };
  return logger;
}

/**
 * Default logger when none is injected. No-op at all levels; no SonicBoom stream.
 */
export const silentLogger: InspectorLogger = createSilentLogger();
