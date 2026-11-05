/**
 * Terminal-output sanitization now lives in `core/cli/sanitize.ts` (#2838),
 * shared with the one-shot CLI, whose readable `--load` summary prints the
 * same server-controlled text. Re-exported so this client's imports stay.
 */
export {
  isSafeLinkTarget,
  sanitizeDeep,
  sanitizeText,
} from "@inspector/core/cli/sanitize.js";
