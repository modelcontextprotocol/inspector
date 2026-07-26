# CLI Tests

Tests live next to the suite entrypoints under `__tests__/` and run via Vitest.

- Most tests import `runCli()` **in-process** (see `helpers/cli-runner.ts`) so
  `clients/cli/src` is measured under the coverage gate.
- `e2e.test.ts` (and root `scripts/smoke-cli.mjs`) spawn the built binary for
  shebang / `process.exit` paths — `pretest` builds `test-servers` + the CLI
  bundle first.

Useful scripts (from `clients/cli/`):

```bash
npm test                  # pretest build + all tests
npm run test:cli          # subset: cli.test.ts
npm run test:cli-tools    # subset: tools.test.ts
npm run test:coverage     # build + ≥90 per-file coverage gate
```

OAuth interactive tests may open a loopback callback; they stub or drive that
path in-process rather than requiring a real browser.
