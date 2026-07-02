# CLI Tests

## Running Tests

```bash
# Run all tests (pretest builds test-servers + the CLI binary)
npm test

# Run all tests under the per-file coverage gate
npm run test:coverage

# Run in watch mode (useful for test file changes)
npm run test:watch

# Run specific test file
npm run test:cli          # cli.test.ts
npm run test:cli-tools   # tools.test.ts
npm run test:cli-headers # headers.test.ts
npm run test:cli-metadata # metadata.test.ts
npx vitest run oauth-interactive.test.ts cliOAuth.test.ts  # OAuth interactive smoke parity
```

## How the CLI is exercised

Most tests run the CLI **in-process**: `helpers/cli-runner.ts` imports `runCli()`
from `../src/cli.ts` and invokes it directly, capturing `process.stdout`/`stderr`
and mapping thrown errors to an exit code. This is what lets vitest's v8 coverage
instrument `clients/cli/src` (#1484). Because `commander` uses `.exitOverride()`,
a parse/usage error throws instead of calling `process.exit` and tearing down the
worker.

`e2e.test.ts` is the deliberately thin **out-of-process** layer: it spawns the
**built** `build/index.js` as a real subprocess to cover the shebang, the
`index.ts` `isMain` bootstrap, and the actual `process.exit` codes — the only
parts the in-process runner can't reach. (`scripts/smoke-cli.mjs` at the repo
root provides a further end-to-end check of the binary.)

## Test Files

- `cli.test.ts` - Basic CLI functionality: CLI mode, environment variables, config files, resources, prompts, logging, transport types
- `tools.test.ts` - Tool-related tests: Tool discovery, JSON argument parsing, error handling, prompts
- `headers.test.ts` - Header parsing and validation
- `metadata.test.ts` - Metadata functionality: General metadata, tool-specific metadata, parsing, merging, validation
- `methods.test.ts` - Method/option-validation paths not covered elsewhere (resource templates, missing/invalid options, the `--` target separator)
- `error-handler.test.ts` - The binary's `handleError` error sink, exercised in-process with `process.exit` stubbed
- `oauth-runner.test.ts` - OAuth flag wiring (`--client-config`, `--callback-url`, CIMD overrides)
- `cliOAuth.test.ts` - Unit tests for `cliOAuth.ts` (step-up confirm, helper wiring, retry)
- `oauth-interactive.test.ts` - **Integration** smoke parity for CLI interactive OAuth: connect-time callback server + step-up **y/N** against composable `TestServerHttp` (auto-completes authorize URL programmatically; not a subprocess binary e2e)
- `e2e.test.ts` - Out-of-process spawn of the built binary (exit codes + boot; no OAuth)

## Helpers

The `helpers/` directory contains shared utilities:

- `cli-runner.ts` - Invokes `runCli()` in-process and captures stdout/stderr + exit code
- `assertions.ts` - Custom assertion helpers for CLI output validation
- `fixtures.ts` - Test config/catalog file generators and temporary directory management

HTTP/SSE test servers (for transport tests) come from the
`@modelcontextprotocol/inspector-test-server` package (`createTestServerHttp`),
and the bundled stdio server is launched via `getTestMcpServerCommand()`.

## Notes

- Test files run in separate forked processes (`pool: 'forks'`), so the in-process
  runner's `process.std*.write` patching never overlaps across files; tests within
  a file run sequentially
- Config files use `crypto.randomUUID()` for uniqueness
- HTTP/SSE servers use dynamic port allocation to avoid conflicts
- Coverage is enforced per-file (lines ≥ 90, statements ≥ 85, functions ≥ 80,
  branches ≥ 50). `src/index.ts` (the binary bootstrap) is excluded because it
  only runs in the spawned binary, which coverage can't instrument
- All tests use the built-in MCP test servers — no external/registry dependencies
