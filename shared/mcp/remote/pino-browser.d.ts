/**
 * Type declaration for pino/browser (has transmit support).
 * The pino package provides a browser build at pino/browser.
 */
declare module "pino/browser" {
  import type { Logger, LoggerOptions } from "pino";
  function pino(options?: LoggerOptions): Logger;
  export = pino;
}
