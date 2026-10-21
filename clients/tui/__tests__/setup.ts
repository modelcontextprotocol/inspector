// Shared vitest setup for the TUI renderer tests.
//
// Each ink-testing-library mount of a component that listens for terminal
// resizes (App.tsx and the test modals) registers a `process.stdout` "resize"
// listener for its lifetime. Across a file's many mount/unmount cycles the
// transient count briefly exceeds Node's default warning threshold of 10,
// printing a misleading "MaxListenersExceededWarning" (the listeners are
// removed on unmount — there is no real leak). Raising the cap here, in a
// setupFile that every test file inherits, silences the noise everywhere
// rather than per-file.
process.stdout.setMaxListeners(100);
process.stdin.setMaxListeners(100);

import { afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Keeps the suite off the developer's real `~/.mcp-inspector/auth.log` (#2723).
// `getTuiLogger()` resolves `MCP_INSPECTOR_LOG_DIR ?? HOME/.mcp-inspector` on
// first use, and any test that mounts `App` reaches it — so with no override a
// test run appended "TUI started" lines to the real log, and concurrent
// worktree gates interleaved into the same file. The #2677 shape, one
// directory over: set unconditionally (a value inherited from the shell may
// well be the real directory), one directory per test file since a setup file
// runs once per file. `logger.test.ts` saves, deletes and restores the
// variable around each case, which this does not constrain.
const isolatedLogDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "mcp-inspector-tui-log-"),
);
process.env.MCP_INSPECTOR_LOG_DIR = isolatedLogDir;

afterAll(() => {
  fs.rmSync(isolatedLogDir, { recursive: true, force: true });
});
