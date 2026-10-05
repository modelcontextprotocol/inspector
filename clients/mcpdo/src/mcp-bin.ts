#!/usr/bin/env node

import { realpathSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { handleError } from "@inspector/cli/error-handler.js";
import {
  disallowMemorySecretStoreFallback,
  setSecretStorageWarningsQuiet,
} from "@inspector/core/auth/node/secret-store-selection.js";
import { runMcp } from "./connection/mcp.js";

export { runMcp };

// mcpdo splits one logical session across processes (front-end, OAuth
// helper, daemon) — a per-process memory store can never serve it, so the
// keychain-less automatic fallback is always the secrets file here.
disallowMemorySecretStoreFallback();

// A fresh front-end process runs for every command and most touch a stored
// secret, so the automatic store-selection banner would print on every one.
// Quiet it here; `connect` re-surfaces it once (see connection/mcp.ts).
setSecretStorageWarningsQuiet(true);

const __filename = fileURLToPath(import.meta.url);

/** True when this file is the process entry (works through npm-link symlinks). */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(resolve(__filename));
  } catch {
    return resolve(entry) === resolve(__filename);
  }
}

if (isMainModule()) {
  runMcp(process.argv)
    .then(() => process.exit(0))
    .catch(handleError);
}
