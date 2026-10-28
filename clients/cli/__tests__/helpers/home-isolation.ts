/**
 * Keeps the CLI suite off the developer's real server catalog (#2765).
 *
 * A CLI run with no `--catalog`, no `--config` and no ad-hoc target falls back
 * to the writable default catalog, `~/.mcp-inspector/mcp.json`, and seeds it
 * with `{"mcpServers": {}}` when it is missing. `cli.test.ts` and
 * `completion.test.ts` both reach that path, so a test run on a fresh machine
 * left a stray catalog in the real home directory, and concurrent worktree runs
 * shared the one file. This is the catalog twin of `oauth-state-isolation.ts`
 * (#2719).
 *
 * The redirect is `HOME`, not `MCP_CATALOG_PATH`. `getDefaultMcpConfigPath()`
 * resolves the default from `HOME` (then `USERPROFILE`) at call time, so
 * pointing `HOME` at a temp dir moves only the fallback. `MCP_CATALOG_PATH`
 * would move more than that: an env catalog outranks `--config`, so every
 * test passing a read-only `--config` file would silently run against the
 * empty temp catalog instead. `HOME` is set unconditionally, once per test
 * file (a setup file runs per file), and child processes the suite spawns
 * inherit it through `process.env`.
 *
 * The `beforeEach` guard fails a test whose default catalog path resolves
 * outside `os.tmpdir()` — the shape a test leaves behind when its cleanup
 * deletes `HOME` instead of restoring it.
 */

import { afterAll, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getDefaultMcpConfigPath } from "@inspector/core/storage/store-io.js";

const tmpRoot = fs.realpathSync(os.tmpdir());
const isolatedHome = fs.mkdtempSync(
  path.join(tmpRoot, "mcp-inspector-cli-home-"),
);

process.env.HOME = isolatedHome;

beforeEach(() => {
  const resolved = path.resolve(getDefaultMcpConfigPath());
  if (!resolved.startsWith(tmpRoot + path.sep)) {
    throw new Error(
      `Default catalog path resolves outside ${tmpRoot}: ${resolved}. ` +
        "A previous test deleted HOME instead of restoring it (#2765).",
    );
  }
});

afterAll(() => {
  fs.rmSync(isolatedHome, { recursive: true, force: true });
});
