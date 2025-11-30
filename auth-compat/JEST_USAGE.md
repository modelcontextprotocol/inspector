# Jest Test Suite Usage

## Running Tests with Jest

The MCP Auth Compliance tests are now available as Jest test suites, providing a standard testing experience with better IDE integration and reporting.

### Basic Usage

```bash
# Run all tests with default client
npm test

# Run specific test suite
npm run test:basic      # Basic MCP connection tests
npm run test:oauth      # OAuth compliance tests  
npm run test:metadata   # Metadata location tests
npm run test:behavior   # Client behavior validation tests

# Run with verbose output
npm run test:verbose

# Run with coverage report
npm run test:coverage

# Watch mode for development
npm run test:watch
```

### Using Custom Client Commands

By default, tests use the example TypeScript client. To test your own client implementation:

```bash
# Set CLIENT_COMMAND environment variable
CLIENT_COMMAND="node my-client.js" npm test

# Or use the test:with-client script
npm run test:with-client --client="python my-client.py"
```

### Environment Variables

- `CLIENT_COMMAND`: Command to execute your MCP client (receives server URL as last argument)
- `VERBOSE`: Set to `true` for detailed output including HTTP traces

### Test Structure

Each test suite corresponds to the original compliance test scenarios:

1. **basic-compliance.test.ts**: Tests basic MCP protocol compliance without authentication
2. **oauth-compliance.test.ts**: Tests OAuth2/OIDC authorization flow
3. **metadata-location.test.ts**: Tests different OAuth metadata discovery scenarios
4. **client-behavior.test.ts**: Validates specific client behaviors and error handling

### Jest Features

The Jest implementation provides:
- Parallel test execution for faster runs
- Built-in coverage reporting
- Better error messages and stack traces
- IDE integration for debugging
- Watch mode for test-driven development
- Custom matchers like `toHavePassedCompliance()`

### Comparison with CLI Runner

Both testing methods are maintained:
- **Jest**: Better for development, CI/CD integration, and detailed reporting
- **CLI Runner**: Better for standalone validation and specific scenario testing

```bash
# Jest approach
npm test

# CLI approach (still available)
npm run cli -- --command "node my-client.js" --suite all
```