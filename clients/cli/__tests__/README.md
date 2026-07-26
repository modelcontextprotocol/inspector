# CLI Tests

Tests live under `__tests__/` and run via Vitest.

- Most tests import `runCli()` **in-process** (see `helpers/cli-runner.ts`) so
  `clients/cli/src` is measured under the coverage gate. That helper mocks
  `open-url` so an armed interactive OAuth path cannot launch a real browser.
- `e2e.test.ts` (and root `scripts/smoke-cli.mjs`) spawn the built binary for
  shebang / `process.exit` paths — `pretest` builds `test-servers` + the CLI
  bundle first.

## Scripts (from `clients/cli/`)

```bash
npm test                  # pretest build + all tests
npm run test:cli          # subset: cli.test.ts
npm run test:cli-tools    # subset: tools.test.ts
npm run test:cli-headers  # subset: headers.test.ts
npm run test:cli-metadata # subset: metadata.test.ts
npm run test:coverage     # build + ≥90 per-file coverage gate
npm run validate          # format:check && lint && typecheck && test
```

## Test files

| File                                    | Focus                                       |
| --------------------------------------- | ------------------------------------------- |
| `cli.test.ts`                           | Core connect / method / config matrix       |
| `tools.test.ts`                         | `tools/call` argument coercion              |
| `headers.test.ts`                       | `--header` merging                          |
| `metadata.test.ts`                      | `--metadata` / `--tool-metadata`            |
| `methods.test.ts`                       | Method allow-list / rejection               |
| `app-info.test.ts`                      | `--app-info` probe paths                    |
| `format-json.test.ts`                   | `--format json` envelopes                   |
| `format-output.test.ts`                 | Text/json writers                           |
| `emit-result.test.ts`                   | Result emission helpers                     |
| `method-types.test.ts`                  | `ONE_SHOT_METHODS` / guards                 |
| `run-method.test.ts`                    | Handler dispatch against a real test server |
| `run-method-mocks.test.ts`              | Handler edge cases with mocks               |
| `servers-list.test.ts`                  | `servers/list` / `servers/show` + redaction |
| `cliOAuth.test.ts`                      | Connect / mid-RPC OAuth recovery            |
| `cli-oauth-navigation.test.ts`          | OSC 8, arm/disarm, `MCP_AUTO_OPEN_ENABLED`  |
| `open-url.test.ts`                      | `open` package wrapper                      |
| `oauth-runner.test.ts`                  | Runner client-config / CIMD flags           |
| `oauth-interactive.test.ts`             | Loopback callback OAuth (in-process)        |
| `stored-auth.test.ts`                   | `--use-stored-auth` / handoff / wait        |
| `clear-stored-auth-for-relogin.test.ts` | Dual-key `--relogin` clear                  |
| `programmatic-ergonomics.test.ts`       | Flag conflicts, timeouts, ergonomics        |
| `error-handler.test.ts`                 | Exit codes / error shaping                  |
| `style.test.ts`                         | ANSI / OSC 8 helpers                        |
| `e2e.test.ts`                           | Out-of-process binary smoke                 |
| `helpers/assertions.test.ts`            | Assertion helpers                           |

## Helpers

| Helper                  | Role                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| `helpers/cli-runner.ts` | In-process `runCli` with stdout/stderr capture + `open-url` mock |
| `helpers/assertions.ts` | `expectCliSuccess` / `expectCliFailure` / output matchers        |
| `helpers/fixtures.ts`   | Temp config / client.json factories                              |

OAuth interactive tests stub or drive the loopback callback in-process rather
than requiring a real browser.
