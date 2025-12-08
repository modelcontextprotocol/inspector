# MCP Authorization Compliance Checker Design

## Overview

A compliance testing system for MCP (Model Context Protocol) clients to validate their authorization implementation against a reference server. The system runs client implementations against a validation server that tests compliance with MCP authorization specifications.

## System Architecture

### Core Components

1. **Test Runner** - Main orchestration script that:
   - Accepts a command to run the client implementation
   - Spawns the validation server
   - Executes the client with the validation server URL
   - Collects and reports test results

2. **Validation Server** - MCP server implementation that:
   - Implements test methods for all authorization endpoints
   - Tracks client interactions and validates behavior
   - Generates compliance reports

3. **Mock Authorization Server** - OAuth2/OIDC server that:
   - Returns static, predictable authorization responses
   - Validates PKCE parameters
   - Verifies client authorization flow compliance

## Client Requirements

Clients being tested must:
- Accept a single command-line argument: the MCP server URL
- Connect to the provided MCP server
- Execute authorization flow if required
- Exit with code 0 on success, 1 on failure

## Test Flow

1. Test runner starts validation server on a dynamic port
2. Test runner starts mock authorization server
3. Test runner executes client command with validation server URL
4. Client connects to validation server
5. Validation server presents authorization metadata
6. Client follows authorization flow with mock auth server
7. Client completes MCP initialization
8. Client exits with appropriate status code
9. Test runner collects results from validation server
10. Test runner generates compliance report


## Mock Authorization Server Design

### Static Responses
- Authorization endpoint: Always returns fixed authorization code
- Token endpoint: Returns predictable access/refresh tokens
- JWKS endpoint: Provides static signing keys

### Validation Features
- PKCE code verifier validation
- State parameter tracking
- Redirect URI validation
- Client ID verification

### Simplifications
- No persistent storage required
- No real user authentication
- Fixed token expiration times
- Static signing keys


### Error Details
- Specific validation failures
- Protocol violations
- Missing required parameters
- Timing information

## Directory Structure

```
auth-compat/
├── package.json              # Main package configuration
├── tsconfig.json             # TypeScript configuration
├── README.md                 # Project documentation
├── auth-compliance-design.md # This design document
│
├── src/
│   ├── cli/
│   │   ├── index.ts         # CLI entry point & test runner
│   │   ├── commands.ts      # CLI command handlers
│   │   ├── config.ts        # CLI configuration parser
│   │   └── reporter.ts      # Test report generator
│   │
│   ├── server/
│   │   ├── validation/
│   │   │   └── index.ts     # Validation server entry
│   │   │
│   │   └── auth/
│   │       └── index.ts     # Mock auth server entry
│   │
│   └── types.ts             # Shared type definitions
│
├── examples/
│   └── typescript-client/
│       ├── README.md        # Example documentation
│       ├── package.json     # Example dependencies
│       ├── test-client.ts   # Example TypeScript client
│       └── tsconfig.json    # Example TS config
│
└── reports/                 # Generated test reports
    └── ...
```

## Implementation Phases

### Phase 1: Basic Framework
- Test runner implementation
- Basic validation server
- Simple pass/fail reporting

### Phase 2: Authorization Testing
- Mock authorization server
- PKCE validation
- OAuth2 flow testing

### Phase 3: Advanced Scenarios
- Multiple test suites
- Comprehensive reporting
- Error scenario testing

### Phase 4: Extensions
- Token refresh testing
- Custom grant types
- Performance metrics


### Future todo

- Need to handle client info, e.g. what redirect url the client will expect responses on.
