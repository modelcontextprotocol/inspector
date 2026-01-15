# CLI Tests

## Running Tests

```bash
# Run all tests
npm test

# Run in watch mode (useful for test file changes; won't work on CLI source changes without rebuild)
npm run test:watch

# Run specific test file
npm run test:cli          # cli.test.ts
npm run test:cli-tools   # tools.test.ts
npm run test:cli-headers # headers.test.ts
npm run test:cli-metadata # metadata.test.ts
```

## Test Files

- `cli.test.ts` - Basic CLI functionality: CLI mode, environment variables, config files, resources, prompts, logging, transport types
- `tools.test.ts` - Tool-related tests: Tool discovery, JSON argument parsing, error handling, prompts
- `headers.test.ts` - Header parsing and validation
- `metadata.test.ts` - Metadata functionality: General metadata, tool-specific metadata, parsing, merging, validation

## Helpers

The `helpers/` directory contains shared utilities:

- `cli-runner.ts` - Spawns CLI as subprocess and captures output
- `test-server.ts` - Manages external MCP test servers (HTTP/SSE) with dynamic port allocation
- `assertions.ts` - Custom assertion helpers for CLI output validation
- `fixtures.ts` - Test config file generators and temporary directory management

## Notes

- Tests run in parallel across files (Vitest default)
- Tests within a file run sequentially (we have isolated config files and ports, so we could get more aggressive if desired)
- Config files use `crypto.randomUUID()` for uniqueness in parallel execution
- HTTP/SSE servers use dynamic port allocation to avoid conflicts
- Coverage is not used because the code that we want to measure is run by a spawned process, so it can't be tracked by Vi

## Future

"Dependence on the everything server is not really a super coupling. Simpler examples for each of the features, self-contained in the test suite would be a better approach." - Cliff Hall
