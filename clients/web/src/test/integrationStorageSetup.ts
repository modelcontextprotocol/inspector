/**
 * Keeps the integration project off the developer's real OAuth state (#2670).
 *
 * Several suites construct `NodeOAuthStorage()` or call
 * `clearAllOAuthClientState()` with no path — `storage.test.ts`, the OAuth
 * e2e suites, and everything built on `helpers/oauth-client-fixtures.ts`. With
 * no override those resolve to `~/.mcp-inspector/storage/oauth.json`, so a
 * `local:gate` run rewrote — and `clearAllOAuthClientState()` emptied — the
 * stored OAuth state of whoever ran it. It also made every forks-pool worker,
 * every concurrent worktree's gate and any running Inspector share one file,
 * which is how "clears every server in the default store" flaked on #2630.
 *
 * `MCP_INSPECTOR_OAUTH_STATE_PATH` is the per-file override `getStateFilePath()`
 * reads at call time, ahead of `MCP_STORAGE_DIR` and the default. It is set
 * unconditionally rather than only when absent: a value inherited from the
 * developer's shell is exactly the real file this exists to keep tests away
 * from. A setup file runs once per test file, so each file gets its own
 * directory — isolation between files in one worker as well as between
 * workers. Suites that test resolution itself save, delete and restore the
 * variable around each case, which this does not constrain.
 *
 * `MCP_STORAGE_DIR` is deliberately left alone: tests that exercise it
 * (secret-store selection, web server config) set and restore it themselves,
 * and pinning it here would change what they observe.
 */

import { afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const isolatedStorageDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "mcp-inspector-it-oauth-"),
);

process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = path.join(
  isolatedStorageDir,
  "oauth.json",
);

afterAll(() => {
  fs.rmSync(isolatedStorageDir, { recursive: true, force: true });
});
