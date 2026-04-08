/**
 * Silent logger for browser contexts. Satisfies pino.Logger; does not output anything.
 * Use when no logger is passed (e.g. OAuth callback with no client). Web components
 * that need a fallback import from logging/browser so they don't pull in Node logging.
 */
// @ts-expect-error - pino/browser.js exists but TypeScript doesn't have types for the .js extension
import pino from "pino/browser.js";
import type { Logger } from "pino";

export const silentLogger: Logger = pino({ level: "silent" });
