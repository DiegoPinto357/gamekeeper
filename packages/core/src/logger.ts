/**
 * Core logging — no console.* in packages/core.
 * Defaults to silent; callers (CLI, server) install a real logger via setLogger.
 */
export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export const consoleLogger: Logger = {
  debug: (...args) => console.debug(...args),
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

let currentLogger: Logger = silentLogger;

export const getLogger = (): Logger => currentLogger;

export const setLogger = (logger: Logger): void => {
  currentLogger = logger;
};

/**
 * Convenience proxy that always delegates to the active logger.
 * Import `log` and call `log.info(...)` instead of `console.log(...)`.
 */
export const log: Logger = {
  debug: (...args) => currentLogger.debug(...args),
  info: (...args) => currentLogger.info(...args),
  warn: (...args) => currentLogger.warn(...args),
  error: (...args) => currentLogger.error(...args),
};
