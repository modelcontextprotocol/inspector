/**
 * Keeps the CLI suite off the developer's real OAuth state (#2719).
 *
 * Any CLI path that reaches the default `NodeOAuthStorage` with no override —
 * `oauth-runner.test.ts` and `programmatic-ergonomics.test.ts` both do —
 * resolves to `~/.mcp-inspector/storage/oauth.json`, so a `local:gate` run
 * rewrote the stored OAuth state of whoever ran it, and every concurrent
 * worktree's gate raced on that one file. This is the CLI twin of the web
 * integration project's `integrationStorageSetup.ts` (#2670).
 *
 * `MCP_INSPECTOR_OAUTH_STATE_PATH` is the override `getStateFilePath()` reads
 * at call time, ahead of `MCP_STORAGE_DIR` and the default. It is set
 * unconditionally: a value inherited from the developer's shell is exactly the
 * real file this exists to keep tests away from. A setup file runs once per
 * test file, so each file gets its own directory. Child processes the suite
 * spawns inherit it through `process.env`.
 *
 * The `beforeEach` guard fails a test whose state path resolves outside
 * `os.tmpdir()` — the shape a test leaves behind when its cleanup deletes the
 * variable instead of restoring it. A test that points the variable elsewhere
 * on purpose does so inside its own body or hooks, which run after this one.
 */

import { afterAll, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getStateFilePath } from "@inspector/core/auth/node/storage-node.js";

const tmpRoot = fs.realpathSync(os.tmpdir());
const isolatedStorageDir = fs.mkdtempSync(
  path.join(tmpRoot, "mcp-inspector-cli-oauth-"),
);

process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = path.join(
  isolatedStorageDir,
  "oauth.json",
);

beforeEach(() => {
  const resolved = path.resolve(getStateFilePath());
  if (!resolved.startsWith(tmpRoot + path.sep)) {
    throw new Error(
      `OAuth state path resolves outside ${tmpRoot}: ${resolved}. ` +
        "A previous test deleted MCP_INSPECTOR_OAUTH_STATE_PATH instead of " +
        "restoring it (#2719).",
    );
  }
});

afterAll(() => {
  fs.rmSync(isolatedStorageDir, { recursive: true, force: true });
});
