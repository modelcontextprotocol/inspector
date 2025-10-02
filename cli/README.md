# MCP Inspector CLI

CLI for the Model Context Protocol inspector.

## Development

For development and testing purposes, you can run the CLI locally after building:

```bash
# Build the CLI
npm run build

# Connect to a remote MCP server (with Streamable HTTP transport)
npm run dev -- --cli https://my-mcp-server.example.com --transport http --method tools/list

# Connect to a remote MCP server (with custom headers)
npm run dev -- --cli https://my-mcp-server.example.com --transport http --method tools/list --header "X-API-Key: your-api-key"

# Call a tool on a remote server
npm run dev -- --cli https://my-mcp-server.example.com --method tools/call --tool-name remotetool --tool-arg param=value

# List resources from a remote server
npm run dev -- --cli https://my-mcp-server.example.com --method resources/list
```

**Note:** The `npm run dev` command is only for development and testing. For production use, install the package globally or use `npx @modelcontextprotocol/inspector`.

## Production Usage

See the main [Inspector README](../README.md) for production usage instructions.
