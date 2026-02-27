# TypeScript MCP Client Example

This is an example TypeScript client that demonstrates how to implement a test client for the MCP Authorization Compliance Checker.

## Requirements

The client must:
1. Accept a single command-line argument: the MCP server URL
2. Connect to the provided MCP server
3. Exit with code 0 on success, 1 on failure

## Usage

```bash
# Install dependencies
npm install

# Run the test client
npm run test-client <server-url>

# Or run directly with tsx
npx tsx test-client.ts <server-url>
```
