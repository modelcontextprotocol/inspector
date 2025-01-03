# MCP Inspector

The MCP inspector is a developer tool for testing and debugging MCP servers.

![MCP Inspector Screenshot](mcp-inspector.png)

## Running the Inspector

### From an MCP server repository

To inspect an MCP server implementation, there's no need to clone this repo. Instead, use `npx`. For example, if your server is built at `build/index.js`:

```bash
npx @modelcontextprotocol/inspector build/index.js
```
You can also pass arguments along which will get passed as arguments to your MCP server:

```bash
npx @modelcontextprotocol/inspector build/index.js arg1 arg2 ...
```

Environment variables can be passed to your MCP server using either the long form `--envVars` or short form `-e` flags:

```bash
# Long form
npx @modelcontextprotocol/inspector build/index.js --envVars API_KEY=abc123 --envVars DEBUG=true

# Short form
npx @modelcontextprotocol/inspector build/index.js -e API_KEY=abc123 -e DEBUG=true
```

Environment variables are merged with the following precedence:
- Base: process.env (system environment)
- Override: Command line envVars (using either --envVars or -e)
- Final Override: Query parameters
```

The inspector runs both a client UI (default port 5173) and an MCP proxy server (default port 3000). Open the client UI in your browser to use the inspector. You can customize the ports if needed:

```bash
CLIENT_PORT=8080 SERVER_PORT=9000 npx @modelcontextprotocol/inspector build/index.js
```

For more details on ways to use the inspector, see the [Inspector section of the MCP docs site](https://modelcontextprotocol.io/docs/tools/inspector). For help with debugging, see the [Debugging guide](https://modelcontextprotocol.io/docs/tools/debugging).

### From this repository

If you're working on the inspector itself:

Development mode:

```bash
npm run dev
```

Production mode:

```bash
npm run build
npm start
```

## Testing

The inspector includes a comprehensive test suite. To run the tests:

```bash
cd server
npm test
```

### Test Coverage

The test suite includes:
- Environment variable handling
  - Single variable with long flag (--envVars)
  - Single variable with short flag (-e)
  - Multiple environment variables
  - Empty environment variables list
  - Environment variable object merging

To add new tests, place them in the `server/src/__tests__` directory.

## License

This project is licensed under the MIT License—see the [LICENSE](LICENSE) file for details.
